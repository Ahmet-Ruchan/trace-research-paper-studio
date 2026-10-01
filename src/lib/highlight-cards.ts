import type { ReaderNote } from "./reader-notes";
import { highlightCardId, scheduleFirst, type Cloze } from "./review-schedule";
import type { ResearchProject } from "./schema";
import { emptyStudyProgress, MAX_ENTRIES, type StudyProgress } from "./study-path";

/**
 * Vurgudan tekrar kartı: okuyucunun vurguladığı cümle boşluk doldurmalı bir
 * karta dönüşüyor ve Review'a, Lab'deki tekrara ve moladaki tekrara giriyor.
 *
 * Gizlenecek kelime öneriliyor, okuyucu değiştirebiliyor: önce makalenin
 * sözlüğündeki ya da Primer'deki bir terim (makalenin dili), sonra bir sayı
 * (bir sonuç, bir boyut), sonra cümlenin en uzun içerik kelimeleri. Model
 * yok; kart okuyucunun kendi seçtiği metinden.
 *
 * Kart çalışma kaydında (`h:<not kimliği>`), metniyle birlikte: not silinince
 * kart da siliniyor (`removeHighlightCard`).
 */

export type ClozeCandidate = { answer: string; at: number; kind: "term" | "number" | "word" };

export const MAX_CLOZE_CANDIDATES = 8;

const STOPWORDS = new Set(
  "about above after again against among because before being below between both cannot could doing during each either every further having however itself might other others ought rather shall should since still their theirs them themselves then there these they those through under until upon very were what when where whereas whether which while whose with within without would your yours also into only same such than that this from have more most much many some will been does using used uses based thus hence".split(" "),
);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const boundary = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu");

/** Sözlük terimleri ve Primer kavramları; parantezli kısaltmasız hâliyle de. */
function termsOf(project: Pick<ResearchProject, "evidence" | "primer">) {
  const terms = new Set<string>();
  for (const term of [...project.evidence.glossary.map((item) => item.term), ...(project.primer?.concepts ?? []).map((concept) => concept.term)]) {
    const clean = term.trim();
    if (clean.length >= 2) terms.add(clean);
    const bare = clean.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (bare.length >= 2 && bare !== clean) terms.add(bare);
  }
  return [...terms].sort((left, right) => right.length - left.length);
}

export function clozeCandidates(quote: string, project: Pick<ResearchProject, "evidence" | "primer">): ClozeCandidate[] {
  const found: ClozeCandidate[] = [];
  const taken: Array<[number, number]> = [];
  const free = (at: number, length: number) => !taken.some(([from, to]) => at < to && at + length > from);
  const add = (answer: string, at: number, kind: ClozeCandidate["kind"]) => {
    if (found.some((item) => item.answer.toLowerCase() === answer.toLowerCase()) || !free(at, answer.length)) return;
    found.push({ answer, at, kind });
    taken.push([at, at + answer.length]);
  };
  for (const term of termsOf(project)) {
    const match = boundary(escape(term)).exec(quote);
    if (match) add(match[0], match.index, "term");
  }
  for (const match of quote.matchAll(boundary("\\d+(?:[.,]\\d+)*(?:\\s?%)?"))) {
    if (match[0].length >= 2) add(match[0], match.index, "number");
  }
  const words = [...quote.matchAll(/\p{L}[\p{L}\p{N}'’-]*\p{L}|\p{L}/gu)]
    .filter((match) => [...match[0]].length >= 5 && !STOPWORDS.has(match[0].toLowerCase()))
    .sort((left, right) => [...right[0]].length - [...left[0]].length || left.index - right.index);
  for (const match of words) add(match[0], match.index, "word");
  return found.slice(0, MAX_CLOZE_CANDIDATES);
}

/** Yazılan yanıt gizlenen kelime mi: büyük-küçük harf, aksan ve noktalama önemsiz. */
export function clozeMatches(typed: string, answer: string) {
  const plain = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return Boolean(plain(typed)) && plain(typed) === plain(answer);
}

/**
 * Kartı kurar ya da gizlenen kelimeyi değiştirir. Kelime değişince kart
 * baştan başlıyor (yarın): eski aralıklar başka bir kelimeyi hatırlamaktan.
 */
export function addHighlightCard(progress: StudyProgress | undefined, note: Pick<ReaderNote, "id" | "quote">, candidate: Pick<ClozeCandidate, "answer" | "at">, where: string, now: string): StudyProgress {
  const base = progress ?? emptyStudyProgress(now);
  const text = note.quote ?? "";
  const cloze: Cloze = { text, answer: candidate.answer, at: candidate.at, where: where.slice(0, 300) };
  const id = highlightCardId(note.id);
  const existing = base.reviews?.find((item) => item.id === id);
  if (existing?.cloze && existing.cloze.answer === cloze.answer && existing.cloze.at === cloze.at) return base;
  const card = { ...scheduleFirst(id, 0, now), cloze };
  return { ...base, updatedAt: now, reviews: [...(base.reviews ?? []).filter((item) => item.id !== id), card].slice(-MAX_ENTRIES) };
}

export function removeHighlightCard(progress: StudyProgress | undefined, noteId: string, now: string): StudyProgress | undefined {
  const id = highlightCardId(noteId);
  if (!progress?.reviews?.some((item) => item.id === id)) return progress;
  return { ...progress, updatedAt: now, reviews: progress.reviews.filter((item) => item.id !== id) };
}

export const highlightCardOf = (progress: StudyProgress | undefined, noteId: string) => progress?.reviews?.find((item) => item.id === highlightCardId(noteId) && item.cloze);
