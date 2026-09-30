import { z } from "zod";
import type { ResearchProject } from "./schema";

/**
 * Okuyucunun notları ve vurguları.
 *
 * Bir iddiaya ya da bir bölüme (hikâye ya da derin rapor) bağlı: bölümde
 * seçilen metin vurgulanıyor (`quote`), yanına bir not yazılabiliyor;
 * iddiaya not yazılıyor ya da iddia yalnızca işaretleniyor.
 *
 * Çalışma ilerlemesi gibi okuyucunun kaydı, makalenin değil: proje
 * dosyasına, dışa aktarımlara ve yayınlara girmiyor; kütüphanenin yanında
 * `notes.json` içinde duruyor. Markdown'a ya da Obsidian'a (ön bilgi,
 * etiketler ve callout'larla) buradan çıkıyor.
 */

export const NOTE_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const MAX_NOTES_PER_PAPER = 1000;
export const MAX_NOTE_TEXT = 4000;
export const MAX_NOTE_QUOTE = 1200;
const MAX_ID = 300;

export const noteTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("claim"), claimId: z.string().min(1).max(160) }),
  z.object({ kind: z.literal("section"), place: z.enum(["story", "report"]), sectionId: z.string().min(1).max(160) }),
]);
export type NoteTarget = z.infer<typeof noteTargetSchema>;

export const readerNoteSchema = z
  .object({
    id: z.string().min(1).max(80),
    target: noteTargetSchema,
    /** Vurgulanan metin, bölümde göründüğü gibi. */
    quote: z.string().trim().min(1).max(MAX_NOTE_QUOTE).optional(),
    text: z.string().trim().max(MAX_NOTE_TEXT).default(""),
    color: z.enum(NOTE_COLORS).default("yellow"),
    createdAt: z.string().max(40),
    updatedAt: z.string().max(40),
  })
  // Bölümde ne vurgu ne not varsa kayıt boş; iddiada boş kayıt "işaretlendi" demek.
  .refine((note) => note.target.kind === "claim" || note.quote || note.text, "A note on a section needs a highlight or some text.");
export type ReaderNote = z.infer<typeof readerNoteSchema>;

export const readerNotesSchema = z.array(readerNoteSchema).max(MAX_NOTES_PER_PAPER);

const notesFileSchema = z.object({ version: z.literal(1), projects: z.array(z.unknown()) });
const notesEntrySchema = z.object({ id: z.string().min(1).max(MAX_ID), notes: z.array(z.unknown()) });

export function isNotesFile(raw: unknown) {
  return notesFileSchema.safeParse(raw).success;
}

/** Proje kimliği → notlar. Bozuk bir not tek başına düşüyor, diğerleri kalıyor. */
export function parseNotesFile(raw: unknown): Map<string, ReaderNote[]> {
  const entries = new Map<string, ReaderNote[]>();
  const file = notesFileSchema.safeParse(raw);
  if (!file.success) return entries;
  for (const item of file.data.projects) {
    const entry = notesEntrySchema.safeParse(item);
    if (!entry.success) continue;
    const notes = entry.data.notes.flatMap((note) => {
      const parsed = readerNoteSchema.safeParse(note);
      return parsed.success ? [parsed.data] : [];
    });
    if (notes.length) entries.set(entry.data.id, notes.slice(0, MAX_NOTES_PER_PAPER));
  }
  return entries;
}

export function notesFileToJson(entries: ReadonlyMap<string, readonly ReaderNote[]>) {
  return { version: 1 as const, projects: [...entries].filter(([, notes]) => notes.length).map(([id, notes]) => ({ id, notes })) };
}

export const sameTarget = (left: NoteTarget, right: NoteTarget) =>
  left.kind === "claim" ? right.kind === "claim" && left.claimId === right.claimId : right.kind === "section" && left.place === right.place && left.sectionId === right.sectionId;

/** Bölümün sayfadaki işareti: vurgular bu öğenin içinde aranıyor. */
export const sectionMark = (place: "story" | "report", sectionId: string) => `${place}:${sectionId}`;

/** Seçimden gelen metin: satır sonları ve fazla boşluklar tek boşluk. */
export function cleanQuote(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_QUOTE);
}

export type NoteGroup = { target: NoteTarget; heading: string; place: "Story" | "Deep report" | "Claim"; page?: number; excerpt?: string; notes: ReaderNote[] };

/**
 * Notlar makaledeki sıraya göre: hikâye bölümleri, rapor bölümleri, sonra
 * iddialar. Artık projede olmayan bir hedefe bağlı notlar kaybolmuyor, sonda
 * "no longer in the paper" başlığıyla kalıyor.
 */
export function groupNotes(project: ResearchProject, notes: readonly ReaderNote[]): NoteGroup[] {
  const groups: NoteGroup[] = [];
  const used = new Set<string>();
  const take = (target: NoteTarget, heading: string, place: NoteGroup["place"], extra: Partial<NoteGroup> = {}) => {
    const matched = notes.filter((note) => sameTarget(note.target, target)).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    if (!matched.length) return;
    matched.forEach((note) => used.add(note.id));
    groups.push({ target, heading, place, notes: matched, ...extra });
  };
  for (const section of project.story.sections) take({ kind: "section", place: "story", sectionId: section.id }, section.title, "Story");
  for (const section of project.deepReport?.sections ?? []) take({ kind: "section", place: "report", sectionId: section.id }, section.title, "Deep report");
  for (const claim of project.evidence.claims) {
    const reference = claim.sourceRefs[0];
    take({ kind: "claim", claimId: claim.id }, claim.statement, "Claim", { ...(reference?.page ? { page: reference.page } : {}), ...(reference?.excerpt ? { excerpt: reference.excerpt } : {}) });
  }
  const orphans = notes.filter((note) => !used.has(note.id));
  if (orphans.length) groups.push({ target: orphans[0].target, heading: "No longer in the paper", place: orphans[0].target.kind === "claim" ? "Claim" : "Story", notes: orphans });
  return groups;
}

const quoted = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");
const yamlString = (value: string) => JSON.stringify(value);

/**
 * Markdown dışa aktarımı. `obsidian`: YAML ön bilgisi (başlık, yazarlar, yıl,
 * DOI, etiketler), vurgular `[!quote]`, iddianın kaynağı `[!cite]` callout'u.
 * Düz Markdown'da aynı içerik alıntı bloklarıyla.
 */
export function notesMarkdown(project: ResearchProject, notes: readonly ReaderNote[], options: { obsidian?: boolean; exportedAt: string }) {
  const { paper } = project.evidence;
  const lines: string[] = [];
  if (options.obsidian) {
    lines.push(
      "---",
      `title: ${yamlString(paper.title)}`,
      `authors: [${paper.authors.map(yamlString).join(", ")}]`,
      ...(paper.year ? [`year: ${yamlString(paper.year)}`] : []),
      ...(paper.venue ? [`venue: ${yamlString(paper.venue)}`] : []),
      ...(paper.doi ? [`doi: ${yamlString(paper.doi)}`] : []),
      "tags: [trace, paper-notes]",
      `exported: ${options.exportedAt.slice(0, 10)}`,
      "---",
      "",
    );
  }
  lines.push(`# ${paper.title}: notes`, "");
  if (!options.obsidian) {
    const byline = [paper.authors.join(", "), paper.venue, paper.year].filter(Boolean).join(" · ");
    if (byline) lines.push(`*${byline}*`, "");
    if (paper.doi) lines.push(`DOI: ${paper.doi}`, "");
  }
  const groups = groupNotes(project, notes);
  if (!groups.length) lines.push("No notes or highlights yet.", "");
  for (const group of groups) {
    lines.push(`## ${group.place === "Claim" ? "Claim" : group.place}: ${group.heading}${group.page ? ` (p. ${group.page})` : ""}`, "");
    if (group.excerpt) {
      lines.push(options.obsidian ? `> [!cite] The paper, p. ${group.page ?? "?"}\n${quoted(`“${group.excerpt}”`)}` : quoted(`“${group.excerpt}” (p. ${group.page ?? "?"})`), "");
    }
    for (const note of group.notes) {
      if (note.quote) lines.push(options.obsidian ? `> [!quote] Highlight\n${quoted(note.quote)}` : quoted(note.quote), "");
      if (note.text) lines.push(note.text, "");
      if (!note.quote && !note.text) lines.push(options.obsidian ? "#highlighted" : "*Marked as important.*", "");
    }
  }
  if (!options.obsidian) lines.push(`Exported from Trace on ${options.exportedAt.slice(0, 10)}.`);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Dosya adı: başlıktan, güvenli karakterlerle. */
export function notesFileName(project: ResearchProject) {
  const slug = project.evidence.paper.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "trace-paper";
  return `${slug}-notes.md`;
}
