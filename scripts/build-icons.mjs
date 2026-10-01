/**
 * Kurulabilir uygulamanın simgeleri: `public/icons/*.svg` kaynaktan PNG'ler.
 *
 *   node scripts/build-icons.mjs
 *
 * "t" bir yazı tipiyle değil yol olarak çizili: simge her makinede aynı. PNG'ler
 * depoda; simge değişince bu betik bir kez çalıştırılıyor (Playwright'ın
 * Chromium'u gerekiyor, `PLAYWRIGHT_CHROMIUM` ile başka bir yol verilebilir).
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const icons = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const outputs = [
  { svg: "icon.svg", png: "icon-192.png", size: 192 },
  { svg: "icon.svg", png: "icon-512.png", size: 512 },
  { svg: "maskable.svg", png: "maskable-512.png", size: 512 },
  // iOS kendi köşelerini yuvarlıyor: tam kare.
  { svg: "maskable.svg", png: "apple-touch-icon.png", size: 180 },
];

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
try {
  for (const output of outputs) {
    const page = await browser.newPage({ viewport: { width: output.size, height: output.size } });
    const svg = readFileSync(join(icons, output.svg), "utf8").replace(/width="512" height="512"/, `width="${output.size}" height="${output.size}"`);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: join(icons, output.png), omitBackground: true, clip: { x: 0, y: 0, width: output.size, height: output.size } });
    await page.close();
    console.log(`${output.png} (${output.size}×${output.size})`);
  }
} finally {
  await browser.close();
}
