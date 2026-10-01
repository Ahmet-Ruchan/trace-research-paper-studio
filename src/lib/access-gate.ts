import { createHash, timingSafeEqual } from "node:crypto";

/**
 * İsteğe bağlı paylaşımlı parola — herkese açık bir sunucuya kurulan stüdyo için.
 *
 * Trace'te hesap yok. Kendi makinende bu sorun değil; internete açık bir
 * sunucuda ise adresi bilen herkes kütüphaneyi okuyup silebilir ve senin
 * anahtarlarınla olmasa da sunucunu kullanabilir. `TRACE_ACCESS_PASSWORD`
 * tanımlıysa stüdyonun tamamı HTTP Basic kimlik doğrulamasının arkasına girer.
 *
 * Üç yol açık kalır, bilerek:
 *   - `/p/<id>`  yayımlanmış hikâyeler; bağlantıyı paylaşmanın bütün amacı bu.
 *   - `/r/<id>`  paylaşılan okuma listeleri; aynı neden.
 *   - `/api/health`  barındırma platformunun sağlık denetimi; hiçbir şey sızdırmaz.
 *   - `/manifest.webmanifest`, `/sw.js`, `/icons/…`  kurulabilir uygulamanın
 *     kabuğu. Tarayıcı manifesti kimlik bilgisi göndermeden istiyor; kapalı
 *     olsaydı uygulama kurulamazdı. Kütüphaneden hiçbir şey içermiyorlar.
 *
 * Bu bir hesap sistemi DEĞİL: tek parola, kullanıcı adı önemsiz, HTTPS şart.
 */
export const ACCESS_REALM = "Trace studio";

export function isPublicPath(pathname: string) {
  return (
    pathname === "/api/health" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    /^\/icons\/[\w.-]+\.(?:png|svg)$/.test(pathname) ||
    /^\/[pr]\/[^/]+\/?$/.test(pathname)
  );
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function accessAllowed(pathname: string, authorization: string | null, password: string | undefined) {
  if (!password || isPublicPath(pathname)) return true;
  const match = /^Basic\s+(.+)$/i.exec(authorization ?? "");
  if (!match) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  // Özetler eşit uzunlukta; karşılaştırma süresi parolanın uzunluğunu ele vermez.
  return timingSafeEqual(digest(decoded.slice(separator + 1)), digest(password));
}
