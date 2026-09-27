import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Her test boş bir kütüphaneyle başlıyor.
 *
 * Testler aynı sunucuyu ve veri dizinini paylaşıyor. Bir testin eklediği
 * makale, etiket, çalışma kaydı ya da kavram eşi ötekinin ekranına düşüyordu:
 * kavram haritası testi eş testinin "Zeta" adlarını görüyor, sayımlar önceki
 * testlerin kartlarıyla kayıyordu. Sunucu diskten her istekte yeniden
 * okuyor, bellekte bir şey tutmuyor; dizini boşaltmak yetiyor.
 *
 * Yalnızca işareti taşıyan dizin boşaltılıyor: `TRACE_E2E_DATA_DIR` yanlışlıkla
 * gerçek bir kütüphaneyi gösterirse testler onu silmek yerine duruyor.
 */
export const E2E_DATA_MARKER = ".trace-e2e-data";

export function emptyTestLibrary(directory = process.env.TRACE_E2E_DATA_DIR) {
  if (!directory) throw new Error("TRACE_E2E_DATA_DIR is not set; run the tests through playwright.config.ts.");
  if (!existsSync(join(directory, E2E_DATA_MARKER))) {
    throw new Error(`${directory} was not created for the tests (no ${E2E_DATA_MARKER}); refusing to empty it.`);
  }
  for (const entry of readdirSync(directory)) {
    if (entry !== E2E_DATA_MARKER) rmSync(join(directory, entry), { recursive: true, force: true });
  }
}
