import { z } from "zod";
import { buildClaimIndex, searchClaims } from "./library-search";
import { tagKey, type LibraryTags } from "./library-tags";
import { buildNoteIndex, searchNotes } from "./note-search";
import { groupNotes, type ReaderNote } from "./reader-notes";
import { studyStatus } from "./reading-order";
import type { ResearchProject } from "./schema";
import { foldForSearch } from "./search-text";
import type { StudyProgress } from "./study-path";

/**
 * MCP araçları: kütüphane, tek bir makale, iddia araması ve okuyucunun
 * notları. Okuma listesi ve günün özeti köprüde (yazma kilitleri orada).
 *
 * Bu dosya saf: veriyi `trace-mcp.mjs` diskteki kütüphaneden okuyup veriyor,
 * buradaki fonksiyonlar yalnızca seçip biçimlendiriyor. Model yok, ağ yok.
 * Araçların girdi şeması Zod'dan üretiliyor; doğrulama ve şema tek kaynakta.
 */

export type TraceLibraryData = {
  projects: readonly ResearchProject[];
  study: ReadonlyMap<string, StudyProgress>;
  notes: ReadonlyMap<string, readonly ReaderNote[]>;
  tags: LibraryTags;
};

const statusLabel = { new: "not started", started: "in progress", finished: "finished" } as const;
const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback).describe(`How many to return, at most ${max}.`);

export const libraryArgs = z
  .object({
    query: z.string().max(200).optional().describe("Words that must all appear in the title, authors, venue or tags."),
    tag: z.string().max(40).optional().describe("Only papers with this tag."),
    limit: limit(200, 50),
  })
  .strict();

export const paperArgs = z
  .object({
    id: z.string().max(200).optional().describe("The paper's library id, from the library tool."),
    title: z.string().max(300).optional().describe("Part of the title, when the id is not known."),
    include_claims: z.boolean().default(false).describe("Also list the claims, each with its page and quote."),
    claim_limit: limit(200, 40),
  })
  .strict();

export const claimSearchArgs = z
  .object({
    query: z.string().min(2).max(200).describe("Words that must all appear in a claim or its quote."),
    paper_id: z.string().max(200).optional().describe("Search only this paper."),
    tag: z.string().max(40).optional().describe("Search only the papers with this tag."),
    limit: limit(60, 20),
  })
  .strict();

export const notesArgs = z
  .object({
    query: z.string().max(200).optional().describe("Words that must all appear in the note, the highlighted text or where it is. Without it, the newest notes."),
    paper_id: z.string().max(200).optional().describe("Only the notes on this paper."),
    limit: limit(200, 30),
  })
  .strict();

function inputSchema(schema: z.ZodType) {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  void _ignored;
  return rest;
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Bu dosyanın araçları; okuma listesi ve gün özeti `trace-mcp.mjs` içinde ekleniyor. */
export const LIBRARY_MCP_TOOLS = [
  {
    name: "library",
    title: "Papers in the Trace library",
    description: "List the papers in the reader's Trace library: id, title, authors, year, venue, tags, how far the reader has studied it, and how many claims and notes it has. Filter by words or a tag.",
    inputSchema: inputSchema(libraryArgs),
    annotations: readOnly,
  },
  {
    name: "paper",
    title: "One paper in the library",
    description: "One paper of the Trace library by id (or part of its title): its thesis, summary, research question, methods, findings and limitations, its story and report sections, Primer concepts, glossary and measured results with pages, and the reader's study status and tags. Ask for the claims to get each with its page and quote.",
    inputSchema: inputSchema(paperArgs),
    annotations: readOnly,
  },
  {
    name: "search_claims",
    title: "Search the claims of every paper",
    description: "Search what the papers in the Trace library claim. Every word must appear in the claim or its quote. Each hit is the claim itself with its paper, page and quote, the model's confidence, whether the quote was found on its page, and a reviewer's decision if any. Rejected claims come last.",
    inputSchema: inputSchema(claimSearchArgs),
    annotations: readOnly,
  },
  {
    name: "notes",
    title: "The reader's notes and highlights",
    description: "The reader's own notes and highlights in Trace, with the paper and the place each belongs to (a story or report section, a Primer concept or a claim). Search them by words, or list the newest. These are the reader's, not the paper's: quote them as theirs.",
    inputSchema: inputSchema(notesArgs),
    annotations: readOnly,
  },
] as const;

const fold = (value: string) => foldForSearch(value).normalize("NFD").replace(/\p{M}/gu, "");
const words = (query: string | undefined) => fold(query ?? "").split(/\s+/).filter(Boolean);

function paperLine(project: ResearchProject, data: TraceLibraryData) {
  const { paper } = project.evidence;
  return {
    id: project.id,
    title: paper.title,
    authors: paper.authors.slice(0, 8),
    ...(paper.authors.length > 8 ? { moreAuthors: paper.authors.length - 8 } : {}),
    year: paper.year || null,
    venue: paper.venue || null,
    ...(paper.doi ? { doi: paper.doi } : {}),
    language: project.language,
    tags: [...(data.tags.get(project.id) ?? [])],
    study: statusLabel[studyStatus(data.study.get(project.id))],
    claims: project.evidence.claims.length,
    notes: (data.notes.get(project.id) ?? []).length,
    updatedAt: project.updatedAt,
  };
}

function withTag(data: TraceLibraryData, tag: string | undefined) {
  if (!tag?.trim()) return [...data.projects];
  const key = tagKey(tag);
  return data.projects.filter((project) => (data.tags.get(project.id) ?? []).some((item) => tagKey(item) === key));
}

export function libraryTool(data: TraceLibraryData, raw: unknown) {
  const args = libraryArgs.parse(raw ?? {});
  const terms = words(args.query);
  const matching = withTag(data, args.tag).filter((project) => {
    if (!terms.length) return true;
    const { paper } = project.evidence;
    const haystack = fold([paper.title, paper.authors.join(" "), paper.venue, paper.year, ...(data.tags.get(project.id) ?? [])].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
  const tagCounts = new Map<string, number>();
  for (const project of data.projects) for (const tag of data.tags.get(project.id) ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  return {
    papers: data.projects.length,
    matching: matching.length,
    shown: Math.min(matching.length, args.limit),
    tags: [...tagCounts].map(([tag, papers]) => ({ tag, papers })).sort((left, right) => right.papers - left.papers || left.tag.localeCompare(right.tag)),
    results: matching.slice(0, args.limit).map((project) => paperLine(project, data)),
    note: data.projects.length
      ? "The reader's library. Use the paper tool with an id for one paper, search_claims for what the papers say."
      : "The library is empty. A paper analysed in the studio or with the Trace skill appears here.",
  };
}

export class TraceToolError extends Error {}

function findPaper(data: TraceLibraryData, id: string | undefined, title: string | undefined) {
  if (id) {
    const found = data.projects.find((project) => project.id === id);
    if (!found) throw new TraceToolError(`No paper with the id "${id}" in the library. The library tool lists the ids.`);
    return found;
  }
  const terms = words(title);
  if (!terms.length) throw new TraceToolError("Give the paper's id or part of its title.");
  const matches = data.projects.filter((project) => terms.every((term) => fold(project.evidence.paper.title).includes(term)));
  if (!matches.length) throw new TraceToolError(`No paper in the library has "${title}" in its title.`);
  if (matches.length > 1) {
    const exact = matches.find((project) => fold(project.evidence.paper.title) === terms.join(" "));
    if (exact) return exact;
    throw new TraceToolError(`More than one paper matches "${title}": ${matches.slice(0, 8).map((project) => `${project.evidence.paper.title} (id ${project.id})`).join("; ")}. Ask again with the id.`);
  }
  return matches[0];
}

const page = (reference: { page?: number } | undefined) => reference?.page ?? null;

export function paperTool(data: TraceLibraryData, raw: unknown) {
  const args = paperArgs.parse(raw ?? {});
  const project = findPaper(data, args.id, args.title);
  const { evidence } = project;
  const unlocated = new Set((project.excerptCheck?.unlocated ?? []).filter((item) => item.owner === "claim").map((item) => item.id));
  const kinds = new Map<string, number>();
  for (const claim of evidence.claims) kinds.set(claim.kind, (kinds.get(claim.kind) ?? 0) + 1);
  return {
    ...paperLine(project, data),
    thesis: evidence.thesis,
    plainSummary: evidence.plainSummary,
    researchQuestion: evidence.researchQuestion,
    methods: evidence.methods,
    findings: evidence.findings,
    limitations: evidence.limitations,
    story: project.story.sections.map((section) => ({ id: section.id, title: section.title })),
    deepReport: project.deepReport?.sections.map((section) => ({ id: section.id, title: section.title })) ?? [],
    primer: project.primer?.concepts.map((concept) => ({ id: concept.id, term: concept.term, intuition: concept.intuition })) ?? [],
    glossary: evidence.glossary.map((item) => ({ term: item.term, definition: item.definition })),
    metrics: evidence.metrics.slice(0, 30).map((metric) => ({ label: metric.label, value: metric.displayValue, unit: metric.unit || null, context: metric.context, page: page(metric.sourceRef) })),
    claimsByKind: Object.fromEntries(kinds),
    ...(args.include_claims
      ? {
          claimList: evidence.claims.slice(0, args.claim_limit).map((claim) => ({
            id: claim.id,
            kind: claim.kind,
            statement: claim.statement,
            confidence: claim.confidence,
            page: page(claim.sourceRefs[0]),
            quote: claim.sourceRefs[0]?.excerpt ?? null,
            quoteCheck: project.excerptCheck ? (unlocated.has(claim.id) ? "not found on its page" : "found on its page") : "not checked",
            review: project.claimReviews?.[claim.id]?.status ?? null,
          })),
        }
      : {}),
    note: "From the paper's Trace analysis: every claim carries a page and a quote. Cite the page when you repeat a claim.",
  };
}

export function claimSearchTool(data: TraceLibraryData, raw: unknown) {
  const args = claimSearchArgs.parse(raw ?? {});
  let projects = withTag(data, args.tag);
  if (args.paper_id) {
    projects = projects.filter((project) => project.id === args.paper_id);
    if (!projects.length) throw new TraceToolError(`No paper with the id "${args.paper_id}"${args.tag ? ` and the tag "${args.tag}"` : ""} in the library.`);
  }
  const result = searchClaims(buildClaimIndex(projects), args.query, args.limit);
  return {
    terms: result.terms,
    total: result.total,
    papers: result.papers,
    shown: result.hits.length,
    hits: result.hits.map((hit) => ({
      paperId: hit.project.id,
      paper: hit.project.evidence.paper.title,
      claimId: hit.claim.id,
      kind: hit.claim.kind,
      statement: hit.claim.statement,
      confidence: hit.claim.confidence,
      page: hit.reference?.page ?? null,
      quote: hit.reference?.excerpt ?? null,
      quoteCheck: hit.project.excerptCheck ? (hit.quoteMissing ? "not found on its page" : "found on its page") : "not checked",
      review: hit.review?.status ?? null,
    })),
    note: result.total
      ? "The claims as the papers' Trace analyses record them, with page and quote. A claim marked rejected was turned down by a reviewer; say so if you use it."
      : result.terms.length
        ? "No claim in the library contains every one of these words. Try fewer or other words."
        : "Type at least one word of two letters or more.",
  };
}

export function notesTool(data: TraceLibraryData, raw: unknown) {
  const args = notesArgs.parse(raw ?? {});
  let projects = [...data.projects];
  if (args.paper_id) {
    projects = projects.filter((project) => project.id === args.paper_id);
    if (!projects.length) throw new TraceToolError(`No paper with the id "${args.paper_id}" in the library.`);
  }
  type Entry = { project: ResearchProject; note: ReaderNote; place: string; heading: string; page?: number };
  let entries: Entry[];
  let total: number;
  if (words(args.query).length) {
    const result = searchNotes(buildNoteIndex(projects, data.notes), args.query ?? "", args.limit);
    entries = result.hits;
    total = result.total;
  } else {
    const all = projects.flatMap((project) =>
      groupNotes(project, data.notes.get(project.id) ?? []).flatMap((group) => group.notes.map((note) => ({ project, note, place: group.place, heading: group.heading, page: group.page }))),
    );
    all.sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt));
    total = all.length;
    entries = all.slice(0, args.limit);
  }
  return {
    total,
    shown: entries.length,
    notes: entries.map((entry) => ({
      paperId: entry.project.id,
      paper: entry.project.evidence.paper.title,
      place: entry.place,
      heading: entry.heading,
      ...(entry.page ? { page: entry.page } : {}),
      ...(entry.note.quote ? { highlighted: entry.note.quote, color: entry.note.color } : {}),
      ...(entry.note.text ? { note: entry.note.text } : {}),
      ...(!entry.note.quote && !entry.note.text ? { marked: true } : {}),
      updatedAt: entry.note.updatedAt,
    })),
    note: total
      ? "The reader's own notes and highlights, kept in their library and never in a paper's file. Quote them as the reader's words."
      : "No notes found. In the studio, select text in a paper to highlight it or write a note.",
  };
}
