import { searchTerms } from "./library-search";
import { groupNotes, type NotePlace, type ReaderNote } from "./reader-notes";
import type { ResearchProject } from "./schema";
import { foldForSearch } from "./search-text";

/**
 * Tek makalenin içinde arama: iddialar, hikâye ve derin rapor bölümleri,
 * Primer kavramları, sözlük ve okuyucunun notları birlikte.
 *
 * Kütüphane araması makaleler arasında iddiayı buluyor; bu arama bir
 * makalenin içinde "softmax nerede geçiyordu?" sorusunu cevaplıyor. Model
 * yok; her sonuç olduğu yere götürüyor. Başlıkta geçen kelime metinde
 * geçenden ağır basıyor; bütün kelimeler başlıkta ya da metinde geçmeli.
 */

export const PAPER_SEARCH_KINDS = ["claim", "story", "report", "concept", "term", "note"] as const;
export type PaperHitKind = (typeof PAPER_SEARCH_KINDS)[number];
export const PAPER_HIT_LABELS: Record<PaperHitKind, string> = { claim: "Claim", story: "Story", report: "Deep report", concept: "Primer", term: "Glossary", note: "Your note" };
export const DEFAULT_PAPER_HITS = 40;

export type PaperHit = {
  kind: PaperHitKind;
  /** İddia, bölüm, kavram kimliği; sözlükte terimin kendisi; notta not kimliği. */
  id: string;
  title: string;
  text: string;
  /** Notun hedefi: notlardan olduğu yere gitmek için. */
  target?: { kind: "claim"; claimId: string } | { kind: "section"; place: NotePlace; sectionId: string };
};

type Entry = PaperHit & { foldedTitle: string; foldedText: string; order: number };

function entries(project: ResearchProject, notes: readonly ReaderNote[]): Entry[] {
  const items: PaperHit[] = [
    ...project.evidence.claims.map((claim) => ({ kind: "claim" as const, id: claim.id, title: claim.statement, text: claim.sourceRefs.map((reference) => reference.excerpt).join(" … ") })),
    ...project.story.sections.map((section) => ({ kind: "story" as const, id: section.id, title: section.title, text: [section.kicker, section.body].filter(Boolean).join(" ") })),
    ...(project.deepReport?.sections ?? []).map((section) => ({ kind: "report" as const, id: section.id, title: section.title, text: [section.summary, ...section.analysis].join(" ") })),
    ...(project.primer?.concepts ?? []).map((concept) => ({ kind: "concept" as const, id: concept.id, title: concept.term, text: [concept.intuition, concept.whyItMatters, concept.formal].filter(Boolean).join(" ") })),
    ...project.evidence.glossary.map((item) => ({ kind: "term" as const, id: item.term, title: item.term, text: item.definition })),
    ...groupNotes(project, notes).flatMap((group) =>
      group.notes
        .filter((note) => note.text || note.quote)
        .map((note) => ({ kind: "note" as const, id: note.id, title: group.heading, text: [note.quote ? `“${note.quote}”` : "", note.text].filter(Boolean).join(" "), target: note.target })),
    ),
  ];
  return items.map((item, order) => ({ ...item, order, foldedTitle: foldForSearch(item.title), foldedText: foldForSearch(item.text) }));
}

export function searchPaper(project: ResearchProject, notes: readonly ReaderNote[], query: string, limit = DEFAULT_PAPER_HITS) {
  const terms = searchTerms(query);
  const counts = Object.fromEntries(PAPER_SEARCH_KINDS.map((kind) => [kind, 0])) as Record<PaperHitKind, number>;
  if (!terms.length) return { terms, hits: [] as PaperHit[], total: 0, counts };
  const phrase = terms.join(" ");
  const scored = entries(project, notes).flatMap((entry) => {
    let score = 0;
    for (const term of terms) {
      if (entry.foldedTitle.includes(term)) score += 3;
      else if (entry.foldedText.includes(term)) score += 1;
      else return [];
    }
    if (terms.length > 1 && (entry.foldedTitle.includes(phrase) || entry.foldedText.includes(phrase))) score += 2;
    // Başlığı aranan şeyin kendisi olan (kavram, terim) en başa.
    if (entry.foldedTitle.trim() === phrase) score += 3;
    return [{ entry, score }];
  });
  scored.sort((left, right) => right.score - left.score || left.entry.order - right.entry.order);
  for (const { entry } of scored) counts[entry.kind] += 1;
  return {
    terms,
    total: scored.length,
    counts,
    hits: scored.slice(0, limit).map(({ entry }) => ({ kind: entry.kind, id: entry.id, title: entry.title, text: entry.text, ...(entry.target ? { target: entry.target } : {}) })),
  };
}
