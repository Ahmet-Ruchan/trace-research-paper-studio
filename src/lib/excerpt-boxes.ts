import { normalizeForMatch } from "./paper-text";

/**
 * Bir alıntının sayfadaki YERİ — kelime kutularından.
 *
 * `pdftotext -bbox` her kelimeyi sayfa koordinatlarıyla veriyor. Alıntı,
 * `excerptIsOnPage` ile aynı kuralla aranıyor (yalnızca harf ve rakamlar,
 * sıra korunarak); eşleşen kelimeler satır satır dikdörtgenlere birleştiriliyor.
 * Böylece kanıt çekmecesi "12. sayfada bir yerde" demek yerine cümleyi
 * sayfanın üstünde gösterebiliyor.
 */

export type WordBox = { text: string; xMin: number; yMin: number; xMax: number; yMax: number };
export type BoxPage = { width: number; height: number; words: WordBox[] };
/** Sayfa boyutuna göre 0–1 arası; görüntü hangi çözünürlükte çizilirse çizilsin oturur. */
export type HighlightRect = { x: number; y: number; width: number; height: number };

const decodeEntities = (value: string) =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll("&amp;", "&");

export function parseBboxPages(xhtml: string): BoxPage[] {
  return [...xhtml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)].map((page) => ({
    width: Number(page[1]),
    height: Number(page[2]),
    words: [...page[3].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g)].map((word) => ({
      xMin: Number(word[1]),
      yMin: Number(word[2]),
      xMax: Number(word[3]),
      yMax: Number(word[4]),
      text: decodeEntities(word[5]),
    })),
  }));
}

const lettersOnly = (value: string) => normalizeForMatch(value).replace(/[^\p{L}\p{N}]/gu, "");

/** Alıntının geçtiği kelimeler; "…" ile kısaltılmış alıntının her parçası ayrı aranır. */
export function findExcerptWords(words: WordBox[], excerpt: string): WordBox[] {
  let haystack = "";
  const owner: number[] = [];
  words.forEach((word, index) => {
    const letters = lettersOnly(word.text);
    haystack += letters;
    for (let count = 0; count < letters.length; count += 1) owner.push(index);
  });
  // Satır sonunda tirelenmiş kelime ("archi-" + "tecture") harflere indirgenince kendiliğinden birleşiyor.
  const fragments = normalizeForMatch(excerpt)
    .split(/\s*(?:\.{3}|…|\[\.{3}\])\s*/)
    .map(lettersOnly)
    .filter((fragment) => fragment.length >= 10);

  const matched = new Set<number>();
  for (const fragment of fragments) {
    const start = haystack.indexOf(fragment);
    if (start < 0) return [];
    for (let position = start; position < start + fragment.length; position += 1) matched.add(owner[position]);
  }
  return [...matched].sort((a, b) => a - b).map((index) => words[index]);
}

/** Aynı satırdaki ardışık kelimeleri tek dikdörtgende toplar. */
export function toHighlightRects(matched: WordBox[], page: Pick<BoxPage, "width" | "height">): HighlightRect[] {
  const lines: WordBox[] = [];
  for (const word of matched) {
    const line = lines[lines.length - 1];
    const sameLine = line && Math.abs(line.yMin - word.yMin) < (word.yMax - word.yMin) * 0.6 && word.xMin >= line.xMin;
    if (sameLine) {
      line.xMax = Math.max(line.xMax, word.xMax);
      line.yMin = Math.min(line.yMin, word.yMin);
      line.yMax = Math.max(line.yMax, word.yMax);
    } else {
      lines.push({ ...word });
    }
  }
  return lines.map((line) => ({
    x: line.xMin / page.width,
    y: line.yMin / page.height,
    width: (line.xMax - line.xMin) / page.width,
    height: (line.yMax - line.yMin) / page.height,
  }));
}
