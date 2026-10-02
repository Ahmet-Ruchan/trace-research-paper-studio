import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { loadExampleProject } from "./example-fixture";
import { chooseStudio, PLUGIN_VERSION, versionBehind } from "../../plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs";

/**
 * `deliver` hangi stüdyoya teslim ediyor?
 *
 * Bir okuyucu yeni bir analiz istedi, sonuç en yeni ekranlar olmadan açıldı:
 * 3000'de günler önce eski bir kopyadan açılmış bir dev sunucusu çalışıyordu
 * ve teslimat, sürümüne bakmadan onu kullandı. Artık stüdyo sağlık ucunda
 * sürümünü söylüyor, teslimat eklentiden eski bir stüdyoyu sessizce
 * kullanmıyor ve eski bir kopyayı başlatmıyor.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const BRIDGE = join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs");
const packageVersion = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;

const studio = (port: number, version?: string) => ({ url: `http://127.0.0.1:${port}`, port, version });
const copy = (path: string, version: string | undefined, installed: boolean) => ({ path, version, installed });

describe("stüdyonun sürümü", () => {
  it("sağlık ucu imzayı ve uygulamanın sürümünü veriyor", async () => {
    const body = await health().json();
    expect(body).toEqual({ ok: true, app: "trace-research-studio", version: packageVersion });
  });

  it("köprü uygulamayla aynı sürümde (set-version ikisini birlikte yazıyor)", () => {
    expect(PLUGIN_VERSION).toBe(packageVersion);
  });

  it("sürümleri sayı olarak karşılaştırıyor; sürümü söylemeyen eski sayılıyor", () => {
    expect(versionBehind("0.40.0", "0.41.0")).toBe(true);
    expect(versionBehind("0.9.0", "0.41.0")).toBe(true);
    expect(versionBehind("0.41.0", "0.41.0")).toBe(false);
    expect(versionBehind("0.42.0", "0.41.0")).toBe(false);
    expect(versionBehind("1.0.0", "0.41.0")).toBe(false);
    expect(versionBehind("0.41.0-beta.1", "0.41.0")).toBe(false);
    expect(versionBehind(undefined, "0.41.0")).toBe(true);
    expect(versionBehind("dev", "0.41.0")).toBe(true);
  });
});

describe("teslimatın stüdyo kararı", () => {
  const plugin = "0.42.0";

  it("güncel bir stüdyo çalışıyorsa onu kullanıyor, eskiyi ayrıca söylüyor", () => {
    const decision = chooseStudio({ running: [studio(3000), studio(3001, "0.42.0")], roots: [], pluginVersion: plugin });
    expect(decision.action).toBe("reuse");
    expect(decision.studio.port).toBe(3001);
    expect(decision.outdated.map((item: { port: number }) => item.port)).toEqual([3000]);
  });

  it("yalnızca eski bir stüdyo varsa güncel, kurulu bir kopyayı başlatıyor", () => {
    const decision = chooseStudio({
      running: [studio(3000, "0.39.0")],
      roots: [copy("/old", "0.39.0", true), copy("/fresh", "0.42.0", true)],
      pluginVersion: plugin,
    });
    expect(decision.action).toBe("start");
    expect(decision.root.path).toBe("/fresh");
    expect(decision.outdated).toHaveLength(1);
  });

  it("eski stüdyo ve yalnızca eski bir kopya: hiçbirini açmıyor, güncelleme istiyor", () => {
    const decision = chooseStudio({
      running: [studio(3000)],
      roots: [copy("/old", "0.39.0", true), copy("/plugin", "0.42.0", false)],
      pluginVersion: plugin,
    });
    expect(decision.action).toBe("update");
    expect(decision.root.path).toBe("/old");
    // Eklentinin kendi güncel kopyası kurulumla seçenek olarak söyleniyor.
    expect(decision.uninstalled.path).toBe("/plugin");
  });

  it("hiç stüdyo çalışmıyorken eski bir kopyayı başlatmıyor", () => {
    const decision = chooseStudio({ running: [], roots: [copy("/old", "0.40.0", true)], pluginVersion: plugin });
    expect(decision.action).toBe("update");
  });

  it("--install-app ile eklentinin güncel kopyası kuruluyor", () => {
    const decision = chooseStudio({
      running: [studio(3000, "0.39.0")],
      roots: [copy("/old", "0.39.0", true), copy("/plugin", "0.42.0", false)],
      pluginVersion: plugin,
      installApp: true,
    });
    expect(decision.action).toBe("install");
    expect(decision.root.path).toBe("/plugin");
  });

  it("yalnızca kurulmamış bir kopya varsa kurulum yolunu açıyor (eski davranış)", () => {
    expect(chooseStudio({ running: [], roots: [copy("/plugin", "0.42.0", false)], pluginVersion: plugin }).action).toBe("install");
    expect(chooseStudio({ running: [], roots: [], pluginVersion: plugin }).action).toBe("none");
  });
});

/** Sahte bir stüdyo: yalnızca sağlık ucu. */
async function fakeStudio(version?: string) {
  const server: Server = createServer((request, response) => {
    if (request.url === "/api/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, app: "trace-research-studio", ...(version ? { version } : {}) }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** `spawnSync` sahte sunucuyu da durdururdu (aynı süreçte); teslimat ayrı süreçte bekleniyor. */
function deliverTo(url: string) {
  const space = mkdtempSync(join(tmpdir(), "trace-studio-version-"));
  const projectPath = join(space, "example.trace.json");
  writeFileSync(projectPath, JSON.stringify(loadExampleProject()), "utf8");
  const site = join(space, "site");
  return new Promise<{ delivered: Record<string, unknown>; cleanup: () => void }>((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE, "deliver", "--project", projectPath, "--out", site, "--no-open", "--app-url", url], {
      env: { ...process.env, TRACE_DATA_DIR: join(space, "trace-data") },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`deliver failed (${code}): ${err || out}`));
      resolve({
        delivered: JSON.parse(out),
        cleanup: () => {
          spawnSync(process.execPath, [BRIDGE, "stop", "--site", site], { timeout: 30_000 });
          rmSync(space, { recursive: true, force: true });
        },
      });
    });
  });
}

describe("deliver · eski bir stüdyo", () => {
  it("sürümünü söylemeyen stüdyoyu verilen adreste kullanıyor ama okuyucuya eski olduğunu söylüyor", async () => {
    const { server, url } = await fakeStudio();
    try {
      const { delivered, cleanup } = await deliverTo(url);
      try {
        expect(delivered.ok).toBe(true);
        expect(delivered.appUrl).toContain(url);
        expect(String(delivered.appWarning)).toMatch(/older than this plugin/);
        expect(String(delivered.appWarning)).toMatch(/git pull && npm install/);
        expect(String(delivered.note)).toMatch(/older than this plugin/);
      } finally {
        cleanup();
      }
    } finally {
      server.close();
    }
  }, 130_000);

  it("güncel bir stüdyoda uyarı yok", async () => {
    const { server, url } = await fakeStudio(PLUGIN_VERSION);
    try {
      const { delivered, cleanup } = await deliverTo(url);
      try {
        expect(delivered.ok).toBe(true);
        expect(delivered.appWarning).toBeUndefined();
      } finally {
        cleanup();
      }
    } finally {
      server.close();
    }
  }, 130_000);
});
