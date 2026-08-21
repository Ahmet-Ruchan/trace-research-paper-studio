import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";

/**
 * `deliver` teslimatın tamamı: JSON'u saklar, bağımsız siteyi kurar, stüdyoyu
 * hazırlar ve ikisini de açar. Ürünün en riskli yolu burası ve iki kez bozuldu
 * — stüdyo hiç açılmadı, sebebi de okunmayan bir alanda durdu. Yine de tek
 * kapsaması elle denemekti.
 *
 * Bu testler stüdyoyu KASTEN dışarıda bırakıyor (`--no-app`): stüdyo dev
 * sunucusu, `node_modules` ve dakikalarca süren bir kurulum demek, yani CI'da
 * güvenilir çalışmaz. Korunan şey teslimatın deterministik yarısı: dosyalar
 * doğru üretiliyor mu, yer tutucular gerçekten dolduruluyor mu, stüdyo yokken
 * sayfa kullanıcıya komutu verebiliyor mu, ve teslimat stüdyosuz da başarılı
 * sayılıyor mu.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const BRIDGE = join(
  root,
  "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs",
);

let workspace: string;
let result: {
  ok: boolean;
  url: string;
  appUrl?: string;
  appStarted: boolean;
  appNote?: string;
  studioCommand?: string;
  opened: string[];
  siteDirectory: string;
  jsonPath: string;
  jsonUrl: string;
};

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-deliver-"));
  const projectPath = join(workspace, "example.trace.json");
  writeFileSync(projectPath, JSON.stringify(loadExampleProject()), "utf8");

  const run = spawnSync(
    process.execPath,
    [
      BRIDGE,
      "deliver",
      "--project",
      projectPath,
      "--out",
      join(workspace, "site"),
      "--no-open",
      "--no-app",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );

  if (run.status !== 0) {
    throw new Error(`deliver failed (${run.status}):\n${run.stderr || run.stdout}`);
  }
  result = JSON.parse(run.stdout);
}, 130_000);

afterAll(() => {
  if (!workspace) return;
  // Teslimat bir dinleyici bıraktı; testin kendi çöpünü toplaması gerekiyor.
  spawnSync(process.execPath, [BRIDGE, "stop", "--site", join(workspace, "site")], {
    encoding: "utf8",
    timeout: 30_000,
  });
  rmSync(workspace, { recursive: true, force: true });
});

describe("deliver", () => {
  it("stüdyo olmadan da başarılı sayılır", () => {
    // Bağımsız site tek başına eksiksiz bir teslimat. Stüdyonun açılmaması
    // teslimatı düşürmemeli, yalnızca not düşmeli.
    expect(result.ok).toBe(true);
    expect(result.appStarted).toBe(false);
    expect(result.appUrl).toBeUndefined();
    expect(result.opened).toEqual([]);
  });

  it("taşınabilir JSON'u ve tek dosyalık siteyi yazar", () => {
    expect(existsSync(result.jsonPath)).toBe(true);
    expect(existsSync(join(result.siteDirectory, "index.html"))).toBe(true);

    const delivered = JSON.parse(readFileSync(result.jsonPath, "utf8"));
    expect(delivered.id).toBe(loadExampleProject().id);
  });

  it("şablondaki yer tutucuların hiçbirini doldurulmamış bırakmaz", () => {
    /**
     * Yer tutucu dolmazsa sayfa sessizce boş açılır: JavaScript `__TRACE_...__`
     * dizesini veri sanıp ayrıştırmaya çalışır ve hiçbir şey render edilmez.
     * Tarayıcı konsolunda görünür, teslimat çıktısında görünmez.
     */
    const html = readFileSync(join(result.siteDirectory, "index.html"), "utf8");
    expect(html).not.toMatch(/__TRACE_[A-Z_]+__/);
  });

  it("projeyi sayfaya gömer, dışarıdan çekmez", () => {
    // Sayfanın CSP'si `default-src 'none'` — hiçbir ağ isteği yapamaz.
    // Proje gömülü değilse site paylaşıldığında boş açılır.
    const html = readFileSync(join(result.siteDirectory, "index.html"), "utf8");
    expect(html).toContain(loadExampleProject().evidence.paper.title);
  });

  it("--no-app geçildiğinde stüdyo komutu dayatmaz", () => {
    // `--no-app` açık bir "şimdi açma" talebi; teslimat bunu not düşer ama
    // kullanıcıya çalıştırması için komut sunmaz.
    expect(result.appNote).toBe("--no-app was passed.");
    expect(result.studioCommand).toBeUndefined();
  });

  it("aynı siteye ikinci teslimat sunucuyu yeniden kullanır", () => {
    // Her teslimatta yeni bir dinleyici bırakmak, kullanıcının makinesinde
    // sessizce port biriktirir.
    const projectPath = join(workspace, "example.trace.json");
    const again = spawnSync(
      process.execPath,
      [BRIDGE, "deliver", "--project", projectPath, "--out", join(workspace, "site"), "--no-open", "--no-app"],
      { encoding: "utf8", timeout: 120_000 },
    );
    expect(again.status).toBe(0);
    expect(JSON.parse(again.stdout).url).toBe(result.url);
  }, 130_000);
});

/**
 * Asıl şikâyetin testi: stüdyo AÇILMAYA ÇALIŞTI ve başarısız oldu.
 *
 * Bu `--no-app`'ten farklı bir yol. Burada kullanıcı stüdyoyu istiyor ama
 * makinede bağımlılıkları kurulu bir kopya yok — plugin'in kendi klonu böyle
 * geliyor. Doğru davranış: teslimat yine başarılı, ve kullanıcı hem çıktıda
 * hem sayfada stüdyoyu ayağa kaldıracak komutu görüyor.
 *
 * `ensureTraceApp` önce 3000-3002 portlarını yokluyor. Geliştiricinin kendi
 * stüdyosu ayaktaysa bu yol hiç çalışmaz, o yüzden test o durumda atlanıyor —
 * yanlış bir "geçti" vermektense atlamak dürüst. CI'da 3000 her zaman boş.
 */
async function studioIsRunning() {
  for (const port of [3000, 3001, 3002]) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok && (await response.text()).includes("trace-research-studio")) return true;
    } catch {
      // Port kapalı: aradığımız durum.
    }
  }
  return false;
}

describe("deliver · stüdyo ayağa kalkmadığında", async () => {
  const skip = await studioIsRunning();

  it.skipIf(skip)("teslimatı düşürmez ve kullanıcıya komutu verir", () => {
    const space = mkdtempSync(join(tmpdir(), "trace-nostudio-"));
    try {
      // Trace deposuna benziyor (package.json + trace:agent betiği) ama
      // bağımlılıkları kurulu değil — plugin klonuyla aynı durum.
      const fakeApp = join(space, "trace-repo");
      mkdirSync(fakeApp, { recursive: true });
      writeFileSync(
        join(fakeApp, "package.json"),
        JSON.stringify({ name: "trace-fake", scripts: { "trace:agent": "node .", dev: "node ." } }),
        "utf8",
      );

      const projectPath = join(space, "example.trace.json");
      writeFileSync(projectPath, JSON.stringify(loadExampleProject()), "utf8");
      const site = join(space, "site");

      const run = spawnSync(
        process.execPath,
        [BRIDGE, "deliver", "--project", projectPath, "--out", site, "--no-open", "--app", fakeApp],
        { encoding: "utf8", timeout: 120_000 },
      );
      expect(run.status, run.stderr).toBe(0);
      const delivered = JSON.parse(run.stdout);

      expect(delivered.ok).toBe(true);
      expect(delivered.appStarted).toBe(false);
      expect(delivered.appNote).toMatch(/dependencies are not installed/i);
      expect(delivered.studioCommand).toContain("npm install");

      // Komut sayfaya da gömülmeli: çıktı ajanda kalır, sayfa kullanıcıda.
      const html = readFileSync(join(site, "index.html"), "utf8");
      expect(html).toContain("npm install");

      spawnSync(process.execPath, [BRIDGE, "stop", "--site", site], { timeout: 30_000 });
    } finally {
      rmSync(space, { recursive: true, force: true });
    }
  }, 130_000);
});
