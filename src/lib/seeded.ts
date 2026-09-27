/**
 * Tohumlu sözde rastgelelik. Aynı proje her açılışta aynı soruları aynı
 * sırayla soruyor: okuyucu yeniden baktığında bir önceki denemesini
 * tanıyabilmeli, testler de sonucu sabitleyebilmeli.
 */

/** Küçük, tohumlanabilir bir sözde rastgele üreteç (mulberry32). */
export function seededRandom(seed: string) {
  let state = 0;
  for (const character of seed) state = (Math.imul(state, 31) + character.charCodeAt(0)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}
