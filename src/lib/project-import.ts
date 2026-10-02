import { researchProjectSchema, type ResearchProject } from "./schema";

/**
 * Stüdyoya dışarıdan gelen bir proje: dosyadan içe aktarma ve ajanın devri
 * (`?import=`). İkisi de aynı sınırdan ve aynı şemadan geçiyor; hata
 * iletileri kullanıcıya gösterilecek biçimde.
 */

export const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

/**
 * Kullanıcıya gösterilen hata iletileri; stüdyo arayüzün dilindekini veriyor
 * (`src/i18n/messages`), verilmezse İngilizce.
 */
export type ProjectImportWords = {
  tooLarge: string;
  notJson: string;
  invalidSchema: (path: string, message: string) => string;
  /** Şema hatasının yeri yoksa (belgenin kendisi) ve iletisi yoksa. */
  root: string;
  unknownError: string;
  badAddress: string;
  notThisMachine: string;
};

export const ENGLISH_PROJECT_IMPORT_WORDS: ProjectImportWords = {
  tooLarge: "The Trace JSON exceeds the 5 MB limit.",
  notJson: "The file is not valid JSON.",
  invalidSchema: (path, message) => `Invalid Trace project schema: ${path} · ${message}`,
  root: "root",
  unknownError: "unknown error",
  badAddress: "The import address is not valid.",
  notThisMachine: "Imports are only accepted from an address on this machine.",
};

export const PROJECT_TOO_LARGE = ENGLISH_PROJECT_IMPORT_WORDS.tooLarge;

export function parseTraceProject(text: string, words: ProjectImportWords = ENGLISH_PROJECT_IMPORT_WORDS): ResearchProject {
  if (text.length > MAX_PROJECT_BYTES) throw new Error(words.tooLarge);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(words.notJson);
  }
  const parsed = researchProjectSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(words.invalidSchema(issue?.path.join(".") || words.root, issue?.message ?? words.unknownError));
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
export function handoffAddress(raw: string, origin: string, words: ProjectImportWords = ENGLISH_PROJECT_IMPORT_WORDS): URL {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    throw new Error(words.badAddress);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (!loopback || !/^https?:$/.test(url.protocol)) throw new Error(words.notThisMachine);
  return url;
}
