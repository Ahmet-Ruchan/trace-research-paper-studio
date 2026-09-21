import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExcerptWords, parseBboxPages, toHighlightRects, type HighlightRect } from "@/lib/excerpt-boxes";
import { PaperTextError } from "./paper-text-extract";

/**
 * Alıntıyı sayfanın görüntüsü üzerinde bulur: `pdftotext -bbox` kelime
 * kutularını, `pdftoppm` sayfanın resmini verir. İkisi de Poppler; PDF geçici
 * bir dizinde okunur ve silinir, hiçbir zaman çalıştırılmaz.
 */
const TIMEOUT_MS = 45_000;
const RENDER_DPI = 110;

function run(command: string, args: string[], signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    execFile(command, args, { timeout: TIMEOUT_MS, signal, maxBuffer: 32 * 1024 * 1024 }, (error) => {
      if (!error) return resolve();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reject(new PaperTextError("Showing a quote on its page needs Poppler (pdftotext and pdftoppm), which was not found.", "missing-tool"));
      }
      reject(new PaperTextError(`The page could not be read: ${error.message}`, "failed"));
    });
  });
}

export type LocatedExcerpt = { page: number; found: boolean; image: string; rects: HighlightRect[] };

export async function locateExcerpt(file: File, page: number, excerpt: string, signal?: AbortSignal): Promise<LocatedExcerpt> {
  const directory = await mkdtemp(join(tmpdir(), "trace-locate-"));
  const pdfPath = join(directory, "paper.pdf");
  try {
    await writeFile(pdfPath, Buffer.from(await file.arrayBuffer()));
    // Alıntı sayfa kırılımına denk gelmiş olabilir: atıf yapılan sayfa önce, komşuları sonra.
    const first = Math.max(page - 1, 1);
    const boxesPath = join(directory, "boxes.html");
    await run("pdftotext", ["-bbox", "-f", String(first), "-l", String(page + 1), pdfPath, boxesPath], signal);
    const pages = parseBboxPages(await readFile(boxesPath, "utf8"));
    if (!pages.length) throw new PaperTextError(`The PDF has no page ${page}.`, "failed");

    const order = [page, page - 1, page + 1].filter((number) => number >= first && number - first < pages.length);
    let chosen = order[0];
    let rects: HighlightRect[] = [];
    for (const number of order) {
      const candidate = pages[number - first];
      const words = findExcerptWords(candidate.words, excerpt);
      if (words.length) {
        chosen = number;
        rects = toHighlightRects(words, candidate);
        break;
      }
    }

    const imageBase = join(directory, "page");
    await run("pdftoppm", ["-f", String(chosen), "-l", String(chosen), "-r", String(RENDER_DPI), "-png", "-singlefile", pdfPath, imageBase], signal);
    const image = await readFile(`${imageBase}.png`);
    return { page: chosen, found: rects.length > 0, image: `data:image/png;base64,${image.toString("base64")}`, rects };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
