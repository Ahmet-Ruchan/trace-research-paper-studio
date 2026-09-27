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
    // Paket de aynı sürümde: `npm run version:set` hepsini birlikte yazıyor.
    expect(read("package.json").version).toBe(entry.version);
    expect(read("package-lock.json").version).toBe(entry.version);
    expect(read("package-lock.json").packages[""].version).toBe(entry.version);
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

  it("üç ajanın mağaza açıklaması aynı", () => {
    const marketplace = read(".claude-plugin/marketplace.json").plugins.find((item: { name: string }) => item.name === PLUGIN_NAME);
    for (const { path } of MANIFESTS) expect(read(path).description).toBe(marketplace.description);
  });
});

/**
 * Sınırı aşan bir alan hiçbir yerde hata vermiyor, ajan onu sessizce
 * kırpıyor ya da yok sayıyor. Bu depoda ikisi de yaşandı: Codex 1024
 * karakterden uzun beceri açıklamasını cümlenin ortasında kesiyordu, altı
 * başlangıç isteminin üçünü de "maximum of 3 prompts is supported" uyarısıyla
 * atıyordu.
 */
describe("ajanların alan sınırları", () => {
  const SKILLS = [
    `${PLUGIN}/skills/${PLUGIN_NAME}/SKILL.md`,
    `.agents/skills/${PLUGIN_NAME}/SKILL.md`,
    `.claude/skills/${PLUGIN_NAME}/SKILL.md`,
  ];

  const frontmatter = (path: string) => {
    const match = readFileSync(join(root, path), "utf8").match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) throw new Error(`${path} has no frontmatter`);
    return Object.fromEntries(match[1].split("\n").map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)])) as Record<string, string>;
  };

  it.each(SKILLS)("%s Agent Skills biçimine uyar", (path) => {
    const { name, description } = frontmatter(path);
    expect(name).toBe(PLUGIN_NAME);
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(description.length).toBeGreaterThan(0);
    expect([...description].length).toBeLessThanOrEqual(1024);
    // Düz bir YAML değeri: içindeki ": " ya da " #" onu böler.
    expect(description).not.toMatch(/: | #/);
  });

  it("Codex arayüzü Codex'in sınırları içinde", () => {
    const { interface: ui } = read(`${PLUGIN}/.codex-plugin/plugin.json`);
    expect(ui.defaultPrompt.length).toBeLessThanOrEqual(3);
    for (const prompt of ui.defaultPrompt) expect(prompt.length).toBeLessThanOrEqual(128);
    expect(ui.websiteURL).toMatch(/^https:\/\//);
    const yaml = readFileSync(join(root, PLUGIN, "skills", PLUGIN_NAME, "agents", "openai.yaml"), "utf8");
    const short = yaml.match(/short_description: "([^"]*)"/)?.[1] ?? "";
    expect(short.length).toBeGreaterThanOrEqual(25);
    expect(short.length).toBeLessThanOrEqual(64);
    expect(yaml).toMatch(/default_prompt: ".*\$trace-paper-studio/);
  });
});
