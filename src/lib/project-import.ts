import { researchProjectSchema, type ResearchProject } from "./schema";

/**
 * Stüdyoya dışarıdan gelen bir proje: dosyadan içe aktarma ve ajanın devri
 * (`?import=`). İkisi de aynı sınırdan ve aynı şemadan geçiyor; hata
 * iletileri kullanıcıya gösterilecek biçimde.
 */

export const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
export const PROJECT_TOO_LARGE = "The Trace JSON exceeds the 5 MB limit.";

export function parseTraceProject(text: string): ResearchProject {
  if (text.length > MAX_PROJECT_BYTES) throw new Error(PROJECT_TOO_LARGE);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const parsed = researchProjectSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid Trace project schema: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}`);
  }
  return parsed.data;
}

/**
 * Ajanın devri: `deliver` tarayıcıyı `?import=<adres>` ile açıyor ve proje
 * kullanıcı hiçbir şey yapmadan kütüphaneye düşüyor.
 *
 * Adres YALNIZCA bu makineden (loopback) olabilir. Aksi halde herhangi bir
 * sayfadaki bir bağlantı ("trace.app/?import=https://saldirgan/x.json")
 * kullanıcının kütüphanesine yabancı içerik yazdırabilirdi. Şema doğrulaması
 * bu kontrolün yerine geçmez: geçerli bir Trace projesi de kötü niyetli olabilir.
 */
export function handoffAddress(raw: string, origin: string): URL {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    throw new Error("The import address is not valid.");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (!loopback || !/^https?:$/.test(url.protocol)) throw new Error("Imports are only accepted from an address on this machine.");
  return url;
}
