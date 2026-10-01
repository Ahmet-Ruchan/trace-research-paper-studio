import type { ResearchProject } from "./schema";

/**
 * Sesli okuma: hikâye ve derin rapor bölümleri tarayıcının kendi sesiyle
 * (Web Speech API). Model ya da sunucu yok; ses cihazda üretiliyor.
 *
 * Metin kısa parçalara bölünüyor: bazı tarayıcılar (Chrome) uzun bir
 * konuşmayı on beş saniye civarında kesiyor; parça parça okumak hem bunu
 * önlüyor hem duraklatıp sürdürmeyi ve bölüm atlamayı mümkün kılıyor.
 */

export type SpeechSection = { id: string; title: string; text: string };

export const READ_RATES = [0.8, 1, 1.2, 1.5] as const;
export const MAX_CHUNK = 220;

/** LaTeX ve işaretler sesli okunmuyor: `$\\sqrt{d_k}$` → "sqrt d k". */
export function speakable(text: string) {
  return text
    .replace(/\$\$?([^$]+)\$\$?/g, (_, math: string) => math.replace(/\\([a-zA-Z]+)/g, "$1").replace(/[{}_^\\]/g, " "))
    .replace(/[*#`>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:!?])/g, "$1")
    .trim();
}

const withStop = (text: string) => (/[.!?…:]$/.test(text) ? text : `${text}.`);

export function storySpeech(project: Pick<ResearchProject, "story">): SpeechSection[] {
  return project.story.sections.map((section) => ({ id: section.id, title: section.title, text: speakable(`${withStop(section.title)} ${section.body}`) }));
}

export function reportSpeech(project: Pick<ResearchProject, "deepReport">): SpeechSection[] {
  return (project.deepReport?.sections ?? []).map((section) => ({ id: section.id, title: section.title, text: speakable([withStop(section.title), withStop(section.summary), ...section.analysis].join(" ")) }));
}

/**
 * Cümlelere bölüp `max` karakteri geçmeyecek parçalarda birleştiriyor; tek
 * başına uzun bir cümle virgülden, o da yetmezse boşluktan bölünüyor.
 */
export function speechChunks(text: string, max = MAX_CHUNK): string[] {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)\s*/g)?.map((item) => item.trim()).filter(Boolean) ?? [];
  const pieces = sentences.flatMap((sentence) => (sentence.length <= max ? [sentence] : split(sentence, max)));
  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks.at(-1);
    if (last && last.length + 1 + piece.length <= max) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

function split(sentence: string, max: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const at = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    const cut = at > max / 3 ? at + 1 : window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Bir bölümden başlayıp sona kadar okunacak parçalar, hangi bölüme ait oldukları ile. */
export function readingQueue(sections: readonly SpeechSection[], fromId: string) {
  const start = Math.max(0, sections.findIndex((section) => section.id === fromId));
  return sections.slice(start).flatMap((section) => speechChunks(section.text).map((text) => ({ sectionId: section.id, text })));
}
