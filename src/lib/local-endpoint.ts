/**
 * Yerel model sunucusunun adresi.
 *
 * Ollama, LM Studio ve llama.cpp'nin sunucusu OpenAI uyumlu bir
 * `/chat/completions` uçnoktası veriyor; Trace için gereken tek şey bu. Ama
 * adresi kullanıcı yazıyor ve istek SUNUCUDAN çıkıyor — yani doğrulanmadan
 * geçirilirse klasik bir SSRF olur: `http://169.254.169.254/…` yazan biri
 * Trace'i barındıran makinenin bulut kimlik uçnoktasına istek attırabilirdi.
 *
 * Bu yüzden yalnızca geri-döngü adreslerine izin veriliyor. Kural ürünün
 * kendi tanımından çıkıyor: "yerel model" makinenin kendisinde çalışan
 * modeldir. Aynı ağdaki başka bir makine bilerek dışarıda — o adres, isteği
 * yapan sunucunun ağ komşusu demektir ve orayı yoklamak kullanıcının değil
 * sunucunun yetkisiyle olurdu.
 */

/** Ollama'nın varsayılanı; en yaygın kurulum bu. */
export const DEFAULT_LOCAL_ENDPOINT = "http://127.0.0.1:11434/v1";

function isLoopback(hostname: string) {
  if (hostname === "localhost") return true;
  // URL, IPv6 ana makine adlarını köşeli parantezle veriyor.
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (bare === "::1") return true;
  const parts = bare.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function resolveLocalEndpoint(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_LOCAL_ENDPOINT;

  let url: URL;
  try {
    // Şema yazmayan kullanıcı çok olacak; "localhost:1234" tek başına
    // `URL` için geçersiz değil — protokolü "localhost:" sanır.
    url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    throw new Error(`"${value}" is not a valid address. Use something like ${DEFAULT_LOCAL_ENDPOINT}.`);
  }

  if (url.username || url.password) {
    throw new Error("The local model address must not carry credentials.");
  }
  if (!isLoopback(url.hostname)) {
    throw new Error(
      `Only an address on this machine is accepted (127.0.0.1, localhost or ::1); "${url.hostname}" is not one. The request leaves the Trace server, so any other address would let it reach hosts you never asked for.`,
    );
  }

  // Sondaki eğik çizgi temizleniyor, `/v1` ise korunuyor: LM Studio kökü
  // `/v1` altında sunuyor, Ollama ise her ikisini de kabul ediyor.
  const base = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return base;
}

/** `resolveLocalEndpoint` çıktısının üzerine bir yol ekler. */
export function localUrl(endpoint: string, path: string): string {
  return `${endpoint}${path.startsWith("/") ? path : `/${path}`}`;
}
