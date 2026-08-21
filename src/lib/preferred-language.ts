/**
 * Analiz çıktısının dili KULLANICIDAN gelir, kodda sabitlenmez.
 *
 * Bu dosya var, çünkü sabit bir varsayılan sessizce yanlış olabiliyor: eskiden
 * her yerde "tr" varsayılıyordu ve İngilizce yazan bir kullanıcı okuyamadığı
 * Türkçe bir analiz alıyordu. Sabit bir varsayılan kullanıcıların bir kısmı
 * için her zaman yanlıştır; tek doğru kaynak kullanıcının kendisidir.
 *
 * Web'de bunu tarayıcı dilinden okuyoruz. Plugin tarafında karşılığı
 * `--language` bayrağıdır: köprü konuşmayı göremediği için orada varsayılan
 * yoktur, bayrak zorunludur.
 */

/** BCP-47 dil etiketi. Şemadaki `languageTagSchema` ile aynı sözleşme. */
export type ProjectLanguage = string;

const BCP47 = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * @param hint Bilinen bir dil etiketi (`navigator.language`, bir BCP-47 kodu
 *   ya da bir projenin kendi `language` alanı). Verilmezse tarayıcı dili
 *   okunur; tarayıcı yoksa (SSR, test) İngilizce'ye düşer — arayüzün dili de
 *   İngilizce olduğu için sunucuda üretilen işaretleme böylece tutarlı kalır.
 *
 * Geçersiz bir etiket İngilizce'ye düşer: bu değer `Intl` API'lerine gidiyor
 * ve orada bozuk bir etiket `RangeError` fırlatır.
 */
export function preferredLanguage(hint?: string): ProjectLanguage {
  const raw = (hint ?? (typeof navigator === "undefined" ? undefined : navigator.language))?.trim();
  return raw && BCP47.test(raw) ? raw : "en";
}

/**
 * Bir dil etiketini İngilizce adıyla gösterir: "de" → "German".
 *
 * Arayüz tek dil konuşuyor, o yüzden adlar da İngilizce. `Intl.DisplayNames`
 * tanımadığı bir etikette etiketin kendisini döndürür; bilinmeyen ama geçerli
 * bir etiket böylece hâlâ okunabilir kalır.
 */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * Seçicide gösterilen diller. Kapsayıcı bir liste değil, yaygın olanlar —
 * kullanıcının kendi tarayıcı dili listede yoksa ona eklenir, yani liste bir
 * sınır değil bir kısayol.
 */
export const COMMON_LANGUAGES = [
  "en", "tr", "de", "fr", "es", "pt", "it", "nl",
  "pl", "ru", "uk", "ar", "hi", "zh", "ja", "ko",
] as const;

/** Yaygın diller + kullanıcının kendi dili, İngilizce adlarıyla sıralı. */
export function languageOptions(current: string): Array<{ tag: string; label: string }> {
  const tags = new Set<string>([...COMMON_LANGUAGES, current]);
  return [...tags]
    .map((tag) => ({ tag, label: languageName(tag) }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
}
