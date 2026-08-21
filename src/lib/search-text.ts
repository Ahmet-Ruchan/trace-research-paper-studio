/**
 * Arama için metin katlama.
 *
 * Kütüphane ve laboratuvar aramaları `toLocaleLowerCase("tr")` kullanıyordu.
 * Türkçe yerel ayarında "I" harfi "ı"ya iner: İngilizce yazan bir kullanıcı
 * "IMAGE" arattığında sorgu "ımage" olur ve metindeki "image" ile eşleşmez —
 * yani arama sessizce hiçbir şey bulmaz. Sabit "en" de simetrik olarak Türkçe
 * kullanıcıyı vurur ("İMGE" → "i̇mge").
 *
 * Bu yüzden yerel ayar seçmiyoruz: I ailesini tek bir harfe indirip kalanı
 * yerel ayardan bağımsız küçültüyoruz. Böylece her iki taraf da aynı şekilde
 * katlanır ve iki dilde de eşleşir.
 */
export function foldForSearch(value: string) {
  return value.replace(/[İIıi]/g, "i").toLowerCase();
}
