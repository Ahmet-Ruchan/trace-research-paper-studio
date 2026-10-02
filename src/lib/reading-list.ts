import { z } from "zod";
import { bareDoi, libraryPaperFor, normalizePhrase, paperKey } from "./concept-links";
import type { ReadingOrder, ReadingStep } from "./reading-order";
import type { ResearchProject } from "./schema";

/**
 * Okuma listesi: "sonra oku" denen, henüz kütüphanede olmayan çalışmalar.
 *
 * Bir çalışma iki yerden geliyor: bir makalenin atıf grafiği (dayandığı ya
 * da ona atıf yapan çalışmalar) ve kavram önerileri (makalenin varsaydığı bir
 * kavramı anlatan kaynak). Nereden geldiği saklanıyor; okuma sırasında bu
 * yüzden yeri belli: bir makalenin dayandığı ya da bir kavramını anlatan
 * çalışma o makaleden ÖNCE, ona atıf yapan çalışma SONRA okunur.
 *
 * Okuyucunun kaydı, makalenin değil: `~/.trace/library/reading-list.json`.
 */

export const READING_RELATIONS = ["reference", "cited-by", "concept"] as const;
export type ReadingRelation = (typeof READING_RELATIONS)[number];
export const MAX_READING_ITEMS = 500;

const webAddress = z.string().trim().max(2000).refine((value) => /^https?:\/\//i.test(value), "Only a web address.");

export const readingSourceSchema = z.object({
  projectId: z.string().min(1).max(300),
  relation: z.enum(READING_RELATIONS),
  /** Kavram önerisinde kavramın adı. */
  concept: z.string().trim().max(200).optional(),
});
export type ReadingSource = z.infer<typeof readingSourceSchema>;

export const readingItemSchema = z.object({
  id: z.string().min(1).max(600),
  title: z.string().trim().min(1).max(500),
  authors: z.array(z.string().trim().max(200)).max(12).default([]),
  year: z.number().int().min(1000).max(3000).optional(),
  venue: z.string().trim().max(300).optional(),
  /** Analiz için: `arxiv:…`, DOI ya da başlık (`GraphNode.identifier`). */
  identifier: z.string().trim().max(600).optional(),
  url: webAddress.optional(),
  pdfAvailable: z.boolean().optional(),
  citationCount: z.number().int().min(0).optional(),
  from: z.array(readingSourceSchema).max(20).default([]),
  addedAt: z.string().max(40),
});
export type ReadingItem = z.infer<typeof readingItemSchema>;
export const readingListSchema = z.array(readingItemSchema).max(MAX_READING_ITEMS);

const fileSchema = z.object({ version: z.literal(1), items: z.array(z.unknown()) });

export function isReadingListFile(raw: unknown) {
  return fileSchema.safeParse(raw).success;
}

export function parseReadingList(raw: unknown): ReadingItem[] {
  const file = fileSchema.safeParse(raw);
  if (!file.success) return [];
  return file.data.items.flatMap((item) => {
    const parsed = readingItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, MAX_READING_ITEMS);
}

export function readingListToJson(items: readonly ReadingItem[]) {
  return { version: 1 as const, items };
}

/** Bir çalışmanın kimliği: DOI, arXiv numarası ya da katlanmış başlık. Aynı çalışma iki yerden kaydedilirse tek kayıt. */
export function workKey(work: { identifier?: string; doi?: string; title: string }) {
  // Önce `identifier`: atıf grafiği ve kavram önerileri onu aynı kuralla kuruyor (arXiv varsa arXiv).
  const identifier = work.identifier?.trim();
  const arxiv = identifier?.match(/^arxiv:(.+)$/i)?.[1];
  if (arxiv) return `arxiv:${arxiv.toLowerCase().replace(/v\d+$/, "")}`;
  const doi = (identifier && /^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\//i.test(identifier) ? bareDoi(identifier) : undefined) ?? bareDoi(work.doi);
  if (doi) return `doi:${doi}`;
  return `title:${normalizePhrase(work.title)}`;
}

const sameSource = (left: ReadingSource, right: ReadingSource) => left.projectId === right.projectId && left.relation === right.relation && (left.concept ?? "") === (right.concept ?? "");

/** Liste dolu: rota bunu mesajından değil türünden tanıyabilsin (mesaj dile göre değişebiliyor). */
export class ReadingListFullError extends Error {}

/** Listenin sınır hataları; Türkçesi arayüz sözlüğünde (`learning`). */
export type ReadingListLimitWords = { full: (max: number) => string; tooMany: (max: number, room: number) => string };
export const READING_LIST_LIMIT_WORDS: ReadingListLimitWords = {
  full: (max) => `The reading list holds at most ${max} papers.`,
  tooMany: (max, room) => `The reading list holds at most ${max} papers; ${room} more fit.`,
};

/**
 * Listeye ekler; çalışma zaten listedeyse nereden geldiği birleşiyor ve
 * bilgileri tazeleniyor, eklenme zamanı ve sırası korunuyor.
 */
export function addToReadingList(list: readonly ReadingItem[], incoming: ReadingItem, words: ReadingListLimitWords = READING_LIST_LIMIT_WORDS): ReadingItem[] {
  const existing = list.find((item) => item.id === incoming.id);
  if (!existing) {
    if (list.length >= MAX_READING_ITEMS) throw new ReadingListFullError(words.full(MAX_READING_ITEMS));
    return [...list, incoming];
  }
  const from = [...existing.from, ...incoming.from.filter((source) => !existing.from.some((item) => sameSource(item, source)))].slice(0, 20);
  const merged: ReadingItem = { ...existing, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined && value !== "")), from, addedAt: existing.addedAt, id: existing.id };
  return list.map((item) => (item.id === existing.id ? merged : item));
}

/**
 * Birçok çalışmayı birden (Zotero ya da .bib içe aktarımı): ya hepsi sığıyor
 * ya hiçbiri eklenmiyor; yarısı eklenmiş bir içe aktarma kafa karıştırırdı.
 */
export function addAllToReadingList(list: readonly ReadingItem[], incoming: readonly ReadingItem[], words: ReadingListLimitWords = READING_LIST_LIMIT_WORDS): ReadingItem[] {
  const fresh = new Set(incoming.map((item) => item.id).filter((id) => !list.some((item) => item.id === id)));
  if (list.length + fresh.size > MAX_READING_ITEMS) {
    throw new ReadingListFullError(words.tooMany(MAX_READING_ITEMS, MAX_READING_ITEMS - list.length));
  }
  return incoming.reduce<ReadingItem[]>((current, item) => addToReadingList(current, item, words), [...list]);
}

export function removeFromReadingList(list: readonly ReadingItem[], id: string) {
  return list.filter((item) => item.id !== id);
}

export type SavedPlace = {
  item: ReadingItem;
  /** Çalışma artık kütüphanede: analiz edilmiş. */
  owned?: ResearchProject;
  /** Okuma sırasındaki yeri ve nedeni. */
  why?: { relation: ReadingRelation; project: ResearchProject; concept?: string };
};
export type MergedEntry = { kind: "paper"; step: ReadingStep } | { kind: "saved"; place: SavedPlace };

/**
 * Okuma sırası ile listeyi birleştirir. Bir makalenin dayandığı ya da bir
 * kavramını anlatan çalışma o makalenin hemen önüne (sırada en erken gelen
 * makalenin önüne), ona atıf yapan çalışma arkasına giriyor. Sırada yeri
 * olmayanlar (kaynağı sırada değil ya da kütüphaneden çıkmış) `others`'ta;
 * kütüphaneye girmiş olanlar da orada, "açılabilir" olarak.
 */
export function mergeReadingOrder(order: ReadingOrder, list: readonly ReadingItem[], library: readonly ResearchProject[]) {
  const byId = new Map(library.map((project) => [project.id, project]));
  const stepIndex = new Map(order.steps.map((step, index) => [paperKey(step.project), index]));
  const before = new Map<number, SavedPlace[]>();
  const after = new Map<number, SavedPlace[]>();
  const others: SavedPlace[] = [];
  for (const item of list) {
    const owned = libraryPaperFor({ title: item.title, identifier: item.identifier }, library);
    if (owned) {
      others.push({ item, owned });
      continue;
    }
    const placed = item.from.flatMap((source) => {
      const project = byId.get(source.projectId);
      const index = project ? stepIndex.get(paperKey(project)) : undefined;
      return project && index !== undefined ? [{ source, project, index }] : [];
    });
    const earlier = placed.filter((entry) => entry.source.relation !== "cited-by").sort((left, right) => left.index - right.index)[0];
    const later = placed.filter((entry) => entry.source.relation === "cited-by").sort((left, right) => right.index - left.index)[0];
    const chosen = earlier ?? later;
    if (!chosen) {
      const source = item.from.map((entry) => ({ entry, project: byId.get(entry.projectId) })).find((entry) => entry.project);
      others.push({ item, ...(source ? { why: { relation: source.entry.relation, project: source.project!, ...(source.entry.concept ? { concept: source.entry.concept } : {}) } } : {}) });
      continue;
    }
    const place: SavedPlace = { item, why: { relation: chosen.source.relation, project: chosen.project, ...(chosen.source.concept ? { concept: chosen.source.concept } : {}) } };
    const bucket = earlier ? before : after;
    bucket.set(chosen.index, [...(bucket.get(chosen.index) ?? []), place]);
  }
  const entries: MergedEntry[] = [];
  order.steps.forEach((step, index) => {
    for (const place of before.get(index) ?? []) entries.push({ kind: "saved", place });
    entries.push({ kind: "paper", step });
    for (const place of after.get(index) ?? []) entries.push({ kind: "saved", place });
  });
  return { entries, others };
}

/**
 * `savedReason` ve `savedFrom` cümleleri; Türkçesi arayüz sözlüğünde
 * (`learning`). Kavramın adı yoksa (`concept` tanımsız) cümle "a concept" diyor.
 */
export type SavedReasonWords = {
  beforeConcept: (title: string, concept: string | undefined) => string;
  beforeReference: (title: string) => string;
  afterCitedBy: (title: string) => string;
  explainsConcept: (title: string, concept: string | undefined) => string;
  buildsOn: (title: string) => string;
  cites: (title: string) => string;
};
export const SAVED_REASON_WORDS: SavedReasonWords = {
  beforeConcept: (title, concept) => `Before ${title}: it explains ${concept ?? "a concept"}, which that paper assumes.`,
  beforeReference: (title) => `Before ${title}: that paper builds on it.`,
  afterCitedBy: (title) => `After ${title}: it cites that paper.`,
  explainsConcept: (title, concept) => `It explains ${concept ?? "a concept"}, which ${title} assumes.`,
  buildsOn: (title) => `${title} builds on it.`,
  cites: (title) => `It cites ${title}.`,
};

/** Okuyucuya "neden burada": kavramı anlatıyor, makale ona dayanıyor ya da ona atıf yapıyor. */
export function savedReason(why: NonNullable<SavedPlace["why"]>, words: SavedReasonWords = SAVED_REASON_WORDS) {
  const title = why.project.evidence.paper.title;
  if (why.relation === "concept") return words.beforeConcept(title, why.concept);
  if (why.relation === "reference") return words.beforeReference(title);
  return words.afterCitedBy(title);
}

/** Sırada yeri olmayan bir çalışma için: nereden kaydedildiği. */
export function savedFrom(why: NonNullable<SavedPlace["why"]>, words: SavedReasonWords = SAVED_REASON_WORDS) {
  const title = why.project.evidence.paper.title;
  if (why.relation === "concept") return words.explainsConcept(title, why.concept);
  if (why.relation === "reference") return words.buildsOn(title);
  return words.cites(title);
}
