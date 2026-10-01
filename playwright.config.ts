import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_DATA_MARKER, workerDataDirectory } from "./e2e/fresh-library";

/**
 * Arayüzün uçtan uca testleri.
 *
 * Neden var: yeniden üretim, geçmiş, şablon ve yayın panelleri eklenirken
 * dört hata birim testlerinin hiçbirine takılmadan ancak tarayıcıda elle
 * bulundu — üst üste binen iki düğme, geri yüklemeden hemen sonra açılan
 * geçmişteki yarış durumu, her açılışta "proje değişti" diyen yayın paneli
 * ve Türkçe bir tarayıcıda "DESİGN" yazan İngilizce proje. Hepsi bileşenlerin
 * birbirine ve tarayıcıya değdiği yerde yaşıyor; burada korunuyorlar.
 *
 * Sunucu derlenmiş uygulamayı çalıştırıyor (`npm run build` önce gelir) ve
 * her koşuda GEÇİCİ bir veri dizini kullanıyor: testler kullanıcının
 * `~/.trace` kütüphanesine asla yazmamalı. Her test bu dizini boşaltıp boş
 * bir kütüphaneyle başlıyor (`e2e/fresh-library.ts`); dizin yalnızca testler
 * için açıldığını söyleyen işareti taşıyorsa boşaltılıyor.
 *
 * Testler paralel: her işçinin kendi sunucusu (`PORT + sıra`) ve kendi veri
 * dizini (`worker-<sıra>`) var, böylece bir testin boşalttığı kütüphane başka
 * bir testin altından kaymıyor. Hangi işçinin hangi sunucuya gittiğini
 * `e2e/fixtures.ts` seçiyor. İşçi sayısı `TRACE_E2E_WORKERS` ile değişiyor;
 * varsayılan çekirdeklerin yarısı, en çok dört (her sunucu bir Next süreci).
 */
const PORT = Number(process.env.TRACE_E2E_PORT ?? 3217);
const WORKERS = Math.max(1, Number(process.env.TRACE_E2E_WORKERS ?? Math.min(4, Math.floor(cpus().length / 2))) || 1);
// İşçi süreçleri bunları ortamdan okuyor (`e2e/fixtures.ts`, `e2e/fresh-library.ts`).
process.env.TRACE_E2E_PORT = String(PORT);
process.env.TRACE_E2E_WORKERS = String(WORKERS);
if (!process.env.TRACE_E2E_DATA_DIR) {
  // Dizini bu koşu açtı; bitince `e2e/global-teardown.ts` siliyor.
  process.env.TRACE_E2E_DATA_DIR = mkdtempSync(join(tmpdir(), "trace-e2e-"));
  process.env.TRACE_E2E_OWNS_DATA_DIR = "1";
}
const dataDirectory = process.env.TRACE_E2E_DATA_DIR;
for (const directory of [dataDirectory, ...Array.from({ length: WORKERS }, (_, index) => workerDataDirectory(dataDirectory, index))]) {
  if (existsSync(directory) && readdirSync(directory).length) continue;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, E2E_DATA_MARKER), "Created for Trace's end-to-end tests; emptied before every test.\n");
}

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  workers: WORKERS,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    // İşçiye göre `e2e/fixtures.ts` değiştiriyor; bu ilk işçinin adresi.
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1480, height: 860 },
  },
  webServer: Array.from({ length: WORKERS }, (_, index) => ({
    // Uzun boşta bekleme: sunucu boştaki bağlantıyı tam testin yeniden kullandığı anda kapatınca
    // "socket hang up" alınıyordu (yük altında, paralel koşuda).
    command: `node node_modules/.bin/next start -p ${PORT + index} --keepAliveTimeout 120000`,
    url: `http://127.0.0.1:${PORT + index}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { TRACE_DATA_DIR: workerDataDirectory(dataDirectory, index) },
  })),
});
