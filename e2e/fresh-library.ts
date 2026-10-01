import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Her test boş bir kütüphaneyle başlıyor.
 *
 * Bir işçinin testleri aynı sunucuyu ve veri dizinini paylaşıyor. Bir testin eklediği
 * makale, etiket, çalışma kaydı ya da kavram eşi ötekinin ekranına düşüyordu:
 * kavram haritası testi eş testinin "Zeta" adlarını görüyor, sayımlar önceki
 * testlerin kartlarıyla kayıyordu. Sunucu diskten her istekte yeniden
 * okuyor, bellekte bir şey tutmuyor; dizini boşaltmak yetiyor.
 *
 * Yalnızca işareti taşıyan dizin boşaltılıyor: `TRACE_E2E_DATA_DIR` yanlışlıkla
 * gerçek bir kütüphaneyi gösterirse testler onu silmek yerine duruyor.
 */
export const E2E_DATA_MARKER = ".trace-e2e-data";

/** Bu işçinin veri dizini: her paralel işçinin kendi sunucusu ve kendi kütüphanesi var. */
export function workerDataDirectory(base = process.env.TRACE_E2E_DATA_DIR, index = Number(process.env.TEST_PARALLEL_INDEX ?? 0)) {
  if (!base) throw new Error("TRACE_E2E_DATA_DIR is not set; run the tests through playwright.config.ts.");
  return join(base, `worker-${index}`);
}

export function emptyTestLibrary(directory = workerDataDirectory()) {
  if (!existsSync(join(directory, E2E_DATA_MARKER))) {
    throw new Error(`${directory} was not created for the tests (no ${E2E_DATA_MARKER}); refusing to empty it.`);
  }
  for (const entry of readdirSync(directory)) {
    if (entry !== E2E_DATA_MARKER) rmSync(join(directory, entry), { recursive: true, force: true });
  }
}
