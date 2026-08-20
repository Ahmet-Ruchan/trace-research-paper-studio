import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Üç ajan da aynı plugin'i kuruyor ama her biri kendi manifestini okuyor.
 * Manifestlerden biri düşerse ya da adı kayarsa hiçbir şey derlemede
 * patlamaz — o ajanın kullanıcıları plugin'i bulamaz, o kadar. Gemini CLI
 * yerine Antigravity CLI geçirilirken tam olarak bu riske girildi.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const PLUGIN = "plugins/trace-paper-studio";
const PLUGIN_NAME = "trace-paper-studio";

const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

const MANIFESTS = [
  { agent: "Claude Code", path: `${PLUGIN}/.claude-plugin/plugin.json`, versioned: true },
  { agent: "Codex", path: `${PLUGIN}/.codex-plugin/plugin.json`, versioned: true },
  // Antigravity'nin şeması yalnızca name + description tanımlıyor; sürüm alanı yok.
  { agent: "Antigravity CLI", path: `${PLUGIN}/plugin.json`, versioned: false },
] as const;

describe("ajan manifestleri", () => {
  it.each(MANIFESTS)("$agent manifesti aynı plugin'i tarif eder", ({ path }) => {
    expect(existsSync(join(root, path))).toBe(true);
    expect(read(path).name).toBe(PLUGIN_NAME);
  });

  it("sürüm taşıyan manifestler marketplace ile aynı sürümde", () => {
    const marketplace = read(".claude-plugin/marketplace.json");
    const entry = marketplace.plugins.find((item: { name: string }) => item.name === PLUGIN_NAME);
    expect(entry).toBeDefined();
    for (const { path } of MANIFESTS.filter((item) => item.versioned)) {
      expect(read(path).version).toBe(entry.version);
    }
  });

  it("Antigravity manifesti resmi şemayı gösterir", () => {
    expect(read(`${PLUGIN}/plugin.json`).$schema).toBe(
      "https://antigravity.google/schemas/v1/plugin.json",
    );
  });

  it("kaldırılmış Gemini CLI artefaktları geri gelmez", () => {
    for (const stale of ["gemini-extension.json", "GEMINI.md", "commands/trace/analyze.toml"]) {
      expect(existsSync(join(root, stale))).toBe(false);
    }
  });

  /**
   * Antigravity `skills/<ad>/SKILL.md` düzenini kendisi tanıyor. Yanına bir de
   * düz `skills/<ad>.md` konursa AYNI beceriyi iki kez kaydediyor — kurulum
   * çıktısında "skills: 2 processed" olarak görülüyor ama hiçbir yerde hata
   * vermiyor. Bu yüzden düz kopya bir daha eklenmemeli.
   */
  it("beceriyi iki kez kaydettirecek düz kopya taşımaz", () => {
    expect(existsSync(join(root, PLUGIN, "skills", `${PLUGIN_NAME}.md`))).toBe(false);
    expect(existsSync(join(root, PLUGIN, "skills", PLUGIN_NAME, "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".agents/skills", `${PLUGIN_NAME}.md`))).toBe(false);
  });
});
