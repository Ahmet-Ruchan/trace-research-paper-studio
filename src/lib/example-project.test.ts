import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateProjectObject } from "./plugin-validator-entry";
import type { ResearchProject } from "./schema";

/**
 * Amiral gemisi örneğin regresyon testi.
 *
 * `examples/attention-is-all-you-need.trace.json` hem plugin çıktısının
 * referansı hem de sözleşmenin canlı örneği. Şemaya bir kural eklenip bu
 * dosya güncellenmezse burada patlar — dokümantasyonun koddan sapmasını
 * engelleyen şey bu.
 */
const load = (file: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../examples/${file}`, import.meta.url)), "utf8"),
  ) as ResearchProject;

const project = load("attention-is-all-you-need.trace.json");
const english = load("attention-is-all-you-need.en.trace.json");

describe("amiral gemisi örnek proje", () => {
  it("en katı modda doğrulanır", () => {
    const outcome = validateProjectObject(project, { requireDepthBlocks: true });
    if (!outcome.ok) throw new Error(outcome.issues.join("\n"));
    expect(outcome.ok).toBe(true);
  });

  it("derinliğin gerektirdiği tüm öğrenme bloklarını taşır", () => {
    expect(project.depth).toBe("deep");
    expect(project.primer?.concepts.length).toBeGreaterThanOrEqual(3);
    expect(project.derivations?.length).toBeGreaterThanOrEqual(1);
    expect(project.quiz?.questions.length).toBeGreaterThanOrEqual(3);
    expect(project.interactives?.length).toBeGreaterThanOrEqual(1);
    expect(project.applicationGuide).toBeDefined();
  });

  it("üç interaktif türünün hepsini örnekler", () => {
    const kinds = new Set(project.interactives?.map((item) => item.kind));
    expect(kinds).toContain("formula-playground");
    expect(kinds).toContain("mechanism-simulation");
    expect(kinds).toContain("dataset-explorer");
  });

  it("her oyun alanı parametresi makale değerinde çapalıdır", () => {
    for (const interactive of project.interactives ?? []) {
      if (interactive.kind !== "formula-playground") continue;
      for (const parameter of interactive.parameters) {
        expect(parameter.paperValue).toBeGreaterThanOrEqual(parameter.min);
        expect(parameter.paperValue).toBeLessThanOrEqual(parameter.max);
      }
      expect(interactive.paperAnchor.length).toBeGreaterThan(20);
    }
  });
});

/**
 * İngilizce sürüm README ekran görüntülerinde görünen üründür. Ayrı bir
 * dosya olduğu için Türkçe sürümle birlikte sürüklenmesi gerekir; buradaki
 * testler ikisinin yapısal olarak eş kalmasını ve İngilizce sürümde Türkçe
 * metin sızmamasını garanti eder.
 */
describe("İngilizce örnek proje", () => {
  it("en katı modda doğrulanır", () => {
    const outcome = validateProjectObject(english, { requireDepthBlocks: true });
    if (!outcome.ok) throw new Error(outcome.issues.join("\n"));
    expect(outcome.ok).toBe(true);
  });

  it("Türkçe sürümle yapısal olarak eştir", () => {
    expect(english.language).toBe("en");
    expect(english.evidence.claims.map((c) => c.id)).toEqual(project.evidence.claims.map((c) => c.id));
    expect(english.story.sections.map((s) => s.id)).toEqual(project.story.sections.map((s) => s.id));
    expect(english.interactives?.map((i) => i.id)).toEqual(project.interactives?.map((i) => i.id));
    expect(english.quiz?.questions.length).toBe(project.quiz?.questions.length);
  });

  it("alıntıları makalenin özgün metni olarak korur", () => {
    const excerpts = (p: ResearchProject) =>
      p.evidence.claims.flatMap((c) => c.sourceRefs.map((r) => r.excerpt));
    expect(excerpts(english)).toEqual(excerpts(project));
  });

  it("Türkçe düzyazı içermez", () => {
    const leaks: string[] = [];
    const scan = (node: unknown, path: string) => {
      if (typeof node === "string") {
        if (/[çğışöüÇĞİŞÖÜ]/.test(node) && !path.endsWith(".excerpt")) leaks.push(`${path}: ${node.slice(0, 60)}`);
        return;
      }
      if (Array.isArray(node)) return node.forEach((item, i) => scan(item, `${path}[${i}]`));
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) scan(value, `${path}.${key}`);
      }
    };
    scan(english, "root");
    expect(leaks).toEqual([]);
  });
});
