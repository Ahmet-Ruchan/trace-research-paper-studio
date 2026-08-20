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
const path = fileURLToPath(new URL("../../examples/attention-is-all-you-need.trace.json", import.meta.url));
const project = JSON.parse(readFileSync(path, "utf8")) as ResearchProject;

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
