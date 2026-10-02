import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitPages } from "@/lib/paper-text";
import { UserFacingError, type UserErrorArgs } from "@/lib/user-error";

/**
 * PDF'ten sayfa sayfa metin — `pdftotext -layout`, plugin köprüsünün
 * kullandığı araçla aynı. Yalnızca PDF'i göremeyen (yerel) modeller için
 * çalışır; bulut sağlayıcıları dosyanın kendisini alıyor.
 *
 * Dosya geçici bir dizine yazılıp iş bitince siliniyor; PDF çalıştırılmıyor,
 * yalnızca okunuyor. Komut `execFile` ile çağrılıyor: kabuk yok, dosya adı
 * bizim ürettiğimiz sabit bir ad.
 */

/**
 * Mesajı kullanıcıya (kendi dilinde) olduğu gibi gösterilen hata: ne
 * kurulacağını söylüyor. `publicError` bu bayrağı taşıyan hataları genel bir
 * üst kaynak hatasına çevirmeden iletiyor.
 */
export class PaperTextError extends UserFacingError {
  readonly incompatibleModel = true;
  /** Neden; akış kontrolü mesaj metnine değil buna bakar. */
  constructor(readonly reason: "missing-tool" | "no-text" | "failed", ...args: UserErrorArgs) {
    super(...args);
  }
}

const EXTRACTION_TIMEOUT_MS = 60_000;
/** Taranmış (görüntüden ibaret) bir PDF'ten metin çıkmaz; bunun altı "metin yok" sayılır. */
const MIN_USEFUL_CHARACTERS = 1_500;

export async function extractPaperPages(file: File, signal?: AbortSignal): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), "trace-paper-"));
  const pdfPath = join(directory, "paper.pdf");
  const textPath = join(directory, "paper.txt");
  try {
    await writeFile(pdfPath, Buffer.from(await file.arrayBuffer()));
    await new Promise<void>((resolve, reject) => {
      execFile(
        "pdftotext",
        ["-layout", "-enc", "UTF-8", pdfPath, textPath],
        { timeout: EXTRACTION_TIMEOUT_MS, signal },
        (error) => {
          if (!error) return resolve();
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return reject(new PaperTextError("missing-tool", "pdftotextMissing"));
          }
          reject(new PaperTextError("failed", "pdfTextFailed", error.message));
        },
      );
    });
    const pages = splitPages(await readFile(textPath, "utf8"));
    const characters = pages.reduce((sum, page) => sum + page.trim().length, 0);
    if (characters < MIN_USEFUL_CHARACTERS) {
      throw new PaperTextError("no-text", "pdfNoText");
    }
    return pages;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
