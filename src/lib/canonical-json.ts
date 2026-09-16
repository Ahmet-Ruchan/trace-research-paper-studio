/**
 * Anahtarları sıralanmış JSON.
 *
 * Aynı değer, hangi sırayla ayrıştırılmış ya da serileştirilmiş olursa olsun
 * aynı metni üretir. İki yerde gerekiyor: kanıt mührü (Zod'un alan sırası ile
 * dosyadaki sıra farklı olduğunda mühür boşuna kırılmasın) ve revizyonlar
 * ("içerik gerçekten değişti mi" sorusu anahtar sırasına takılmasın).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * İki bağımsız tohumla FNV-1a — 64 bit.
 *
 * Kriptografik değil ve olması gerekmiyor: yanlışlıkla eski içeriğe göre
 * yapılmış bir işlemi yakalamak için. Buna karşılık her çalışma zamanında
 * (tarayıcı, Node, bağımlılıksız plugin) eşzamanlı ve aynı sonucu veriyor;
 * `crypto.subtle` ikisini de sağlamaz.
 */
function fnv1a(text: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function stableHash(text: string) {
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193 ^ 0x5bd1e995)}`;
}
