/**
 * Kalıcı bağlantılar.
 *
 * Bir Trace projesi tek bir sayfa: hikâye, kanıt defteri ve teknik ek aynı
 * adreste yaşıyor. Bu yüzden "şu iddiaya bak" demenin tek yolu tüm dosyayı
 * yollamaktı. Adres çubuğundaki kısa bir çapa bunu çözüyor — hem stüdyoda
 * hem de paylaşılan tek dosyalık kopyada, çünkü ikisi de aynı çapaları yazıyor.
 *
 * Sunucu yok: bağımsız görüntüleyici `file://` üzerinden de açılabiliyor ve
 * orada yönlendirme yapabilecek tek şey hash.
 */

export type DeepLink =
  | { kind: "claim"; id: string }
  | { kind: "section"; id: string }
  | undefined;

const PREFIX = { claim: "claim-", section: "section-" } as const;

/**
 * Kimlikler şemada serbest metin. Kodlanmadan yazılırsa `#` veya `%` taşıyan
 * bir kimlik hash'i ikiye böler; kodlanınca gidiş-dönüş kayıpsız olur.
 */
export function claimHash(id: string): string {
  return `#${PREFIX.claim}${encodeURIComponent(id)}`;
}

export function sectionHash(id: string): string {
  return `#${PREFIX.section}${encodeURIComponent(id)}`;
}

export function parseDeepLink(hash: string): DeepLink {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return undefined;

  for (const kind of ["claim", "section"] as const) {
    const prefix = PREFIX[kind];
    if (!raw.startsWith(prefix)) continue;
    const encoded = raw.slice(prefix.length);
    if (!encoded) return undefined;
    let id: string;
    try {
      id = decodeURIComponent(encoded);
    } catch {
      // Yarım kodlanmış bir hash ("%zz") elle yazılmış olabilir; çözülemeyeni
      // olduğu gibi kullanmak, bağlantıyı tamamen yok saymaktan iyi.
      id = encoded;
    }
    return { kind, id };
  }

  return undefined;
}

/** DOM `id`'si — çapa ile öğe arasındaki tek eşleştirme noktası. */
export function elementId(link: Exclude<DeepLink, undefined>): string {
  return `${PREFIX[link.kind]}${link.id}`;
}

/**
 * Bağlantının tam adresi. `location.href`'in hash'i değiştirilerek üretilir,
 * böylece sorgu dizesi (örneğin `?sample=1`) korunur.
 */
export function absoluteLink(href: string, hash: string): string {
  const [base] = href.split("#");
  return `${base}${hash}`;
}

/**
 * Çapaya götür.
 *
 * `behavior: "instant"` bilerek: bir bağlantı okuyucuyu hedefe götürmeli, ona
 * doğru uçurmamalı. Açılışta yapılan uzun bir animasyon yön kaybettiriyor.
 *
 * Kaydırma iki kez yapılıyor. Şekiller gömülü data URI ve boyut bilgisi
 * taşımıyor: çözülene kadar 0 yükseklikteler, çözüldüklerinde sayfa uzuyor ve
 * ilk hesaplanan konum kayıyor — hedef görüş alanının dışında kalıyordu.
 */
export function scrollToDeepLink(link: DeepLink): void {
  if (!link) return;
  const id = elementId(link);
  const scroll = () => document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "instant" });
  scroll();

  const pending = [...document.images].filter((image) => !image.complete);
  if (!pending.length) return;
  let remaining = pending.length;
  const settle = () => {
    remaining -= 1;
    if (remaining === 0) scroll();
  };
  for (const image of pending) {
    image.addEventListener("load", settle, { once: true });
    image.addEventListener("error", settle, { once: true });
  }
}
