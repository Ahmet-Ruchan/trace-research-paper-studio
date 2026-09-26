import { foldForSearch } from "./search-text";
import type { ResearchProject } from "./schema";

/**
 * Metnin içinde açılan terimler.
 *
 * Sözlük ve ön bilgi ayrı sayfalarda duruyordu: hikâyede "öz-dikkat" geçtiğinde
 * okuyucu tanımı bulmak için Lab'e gitmek zorundaydı. Burada her terimin
 * anlatıda ve raporda ilk geçtiği yer bulunuyor; arayüz orada tanımı açıyor.
 * Model gerekmiyor: her şey projenin kendi sözlüğünden ve ön bilgisinden.
 */
export type TermEntry = {
  /** Katlanmış terim; aynı kavramın iki kaynaktaki kaydını birleştiriyor. */
  key: string;
  term: string;
  /** Sözlük tanımı ya da ön bilginin sezgisel açıklaması. */
  definition: string;
  /** Ön bilgiden: bu makalenin buna neden ihtiyaç duyduğu. */
  whyItMatters?: string;
  conceptId?: string;
  claimIds: readonly string[];
};

/** Metinde aranan biçimler: "Ad (KISALTMA)" iki ayrı biçim. */
function spellings(term: string) {
  const match = term.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  return (match ? [match[1], match[2]] : [term]).map((spelling) => spelling.trim()).filter((spelling) => foldForSearch(spelling).length >= 3);
}

export function termIndex(project: Pick<ResearchProject, "evidence" | "primer">): TermEntry[] {
  const entries = new Map<string, TermEntry>();
  for (const concept of project.primer?.concepts ?? []) {
    const key = foldForSearch(concept.term.trim());
    entries.set(key, { key, term: concept.term, definition: concept.intuition, whyItMatters: concept.whyItMatters, conceptId: concept.id, claimIds: concept.claimIds });
  }
  for (const item of project.evidence.glossary) {
    const key = foldForSearch(item.term.trim());
    const existing = entries.get(key);
    // Aynı terim iki yerdeyse sözlüğün kısa tanımı, ön bilginin "neden"i kalıyor.
    entries.set(key, existing ? { ...existing, definition: item.definition } : { key, term: item.term, definition: item.definition, claimIds: [] });
  }
  return [...entries.values()].filter((entry) => spellings(entry.term).length > 0);
}

export type TermSegment = { text: string; entry?: TermEntry };

const WORD = /[\p{L}\p{N}_-]/u;

/**
 * Terimden sonra kelimeyi tamamlayan ek; kelime orada bitmiyorsa -1.
 * İngilizcede yalnızca çoğul ve iyelik ("products", "model's"): "attentional"
 * "attention" değil. Diğer dillerde kısa bir çekim eki de ("dikkatin",
 * "Softmax'ın", "Modelle"); üç harften uzun bir devam başka bir kelimedir.
 */
function suffixLength(text: string, end: number, language: string) {
  const rest = text.slice(end, end + 6);
  const pattern = /^en\b/i.test(language) ? /^(?:['’]s|es|s)?/u : /^(?:['’]\p{L}{1,4}|\p{L}{0,3})/u;
  const suffix = rest.match(pattern)?.[0] ?? "";
  const after = text[end + suffix.length];
  return after === undefined || !WORD.test(after) ? suffix.length : -1;
}

/**
 * Paragrafları terimlerin İLK geçtiği yerden böler. Bir terim bölüm başına
 * bir kez işaretleniyor: "attention" her paragrafta düğme olsaydı metin
 * okunmaz hâle gelirdi. Uzun terimler önce aranıyor ("multi-head attention"
 * içindeki "attention" ayrıca işaretlenmiyor).
 */
export function markTerms(paragraphs: readonly string[], entries: readonly TermEntry[], language = ""): TermSegment[][] {
  const candidates = entries
    .flatMap((entry) => spellings(entry.term).map((spelling) => ({ entry, folded: foldForSearch(spelling) })))
    .sort((left, right) => right.folded.length - left.folded.length);
  const used = new Set<string>();
  return paragraphs.map((text) => {
    const folded = foldForSearch(text);
    // Katlama harf sayısını değiştirmiyor (I ailesi tek harfe iniyor), konumlar ortak.
    const aligned = folded.length === text.length;
    const taken: Array<{ start: number; end: number; entry: TermEntry }> = [];
    for (const { entry, folded: needle } of candidates) {
      if (used.has(entry.key) || !aligned) continue;
      for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + 1)) {
        if (at > 0 && WORD.test(text[at - 1])) continue;
        const suffix = suffixLength(text, at + needle.length, language);
        if (suffix < 0) continue;
        const end = at + needle.length + suffix;
        if (taken.some((span) => at < span.end && end > span.start)) continue;
        taken.push({ start: at, end, entry });
        used.add(entry.key);
        break;
      }
    }
    taken.sort((left, right) => left.start - right.start);
    const segments: TermSegment[] = [];
    let cursor = 0;
    for (const span of taken) {
      if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start) });
      segments.push({ text: text.slice(span.start, span.end), entry: span.entry });
      cursor = span.end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return segments;
  });
}

/**
 * Bir hikâye bölümünden önce bilinmesi gerekenler: bölümle ortak iddiaya
 * dayanan ya da bölümde adı geçen ön bilgi kavramları, ön bilgideki sırayla.
 */
export function sectionPrerequisites(
  section: { title: string; body: string; claimIds: readonly string[] },
  entries: readonly TermEntry[],
  language = "",
  limit = 3,
) {
  const claims = new Set(section.claimIds);
  const mentioned = new Set(
    markTerms([section.title, section.body], entries, language).flat().flatMap((segment) => (segment.entry ? [segment.entry.key] : [])),
  );
  return entries
    .filter((entry) => entry.conceptId && (entry.claimIds.some((id) => claims.has(id)) || mentioned.has(entry.key)))
    .slice(0, limit);
}
