import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

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
 * `~/.trace` kütüphanesine asla yazmamalı.
 */
const PORT = Number(process.env.TRACE_E2E_PORT ?? 3217);
const dataDirectory = process.env.TRACE_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "trace-e2e-"));
process.env.TRACE_E2E_DATA_DIR = dataDirectory;

export default defineConfig({
  testDir: "./e2e",
  // Testler aynı sunucuyu ve veri dizinini paylaşıyor; sırayla koşmalı.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1480, height: 860 },
  },
  webServer: {
    command: `node node_modules/.bin/next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { TRACE_DATA_DIR: dataDirectory },
  },
});
