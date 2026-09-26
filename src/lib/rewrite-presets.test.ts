import { describe, expect, it } from "vitest";
import { REWRITE_PRESETS, isPresetActive, togglePreset } from "./rewrite-presets";
import { MAX_REGENERATION_INSTRUCTION, sectionKinds } from "./section-regeneration";

describe("quick rewrite requests", () => {
  it("offers every kind of section a few requests that fit the limit together", () => {
    for (const kind of sectionKinds) {
      const presets = REWRITE_PRESETS[kind];
      expect(presets.length, kind).toBeGreaterThanOrEqual(3);
      expect(new Set(presets.map((preset) => preset.id)).size, kind).toBe(presets.length);
      for (const preset of presets) {
        for (const excluded of preset.excludes ?? []) expect(presets.some((item) => item.id === excluded), `${kind}/${preset.id}`).toBe(true);
      }
      // Birbirini dışlamayanların hepsi aynı anda seçilebiliyor.
      let all = "";
      for (const preset of presets) {
        const next = togglePreset(kind, all, preset.id);
        expect(next, `${kind}/${preset.id}`).toBeDefined();
        all = next!;
      }
      expect(all.length, kind).toBeLessThanOrEqual(MAX_REGENERATION_INSTRUCTION);
    }
  });

  it("never asks for numbers the evidence does not have without saying so", () => {
    for (const kind of sectionKinds) {
      for (const preset of REWRITE_PRESETS[kind].filter((item) => item.id === "example")) {
        expect(preset.instruction, `${kind}/${preset.id}`).toMatch(/evidence/);
        expect(preset.instruction, `${kind}/${preset.id}`).toMatch(/only numbers the evidence|illustrat/);
      }
    }
  });

  it("adds a request on its own line and takes it out again, the reader's text kept", () => {
    const withAnalogy = togglePreset("story", "Keep the timeline.", "analogy")!;
    expect(withAnalogy.split("\n")).toEqual(["Keep the timeline.", REWRITE_PRESETS.story.find((preset) => preset.id === "analogy")!.instruction]);
    expect(togglePreset("story", withAnalogy, "analogy")).toBe("Keep the timeline.");
  });

  it("swaps out the opposite request instead of sending both", () => {
    const simpler = togglePreset("story", "", "simpler")!;
    const technical = togglePreset("story", simpler, "technical")!;
    const [simplerPreset, technicalPreset] = ["simpler", "technical"].map((id) => REWRITE_PRESETS.story.find((preset) => preset.id === id)!);
    expect(isPresetActive(technical, technicalPreset)).toBe(true);
    expect(isPresetActive(technical, simplerPreset)).toBe(false);
    const easier = togglePreset("quiz", togglePreset("quiz", "", "harder")!, "easier")!;
    expect(easier).toBe(REWRITE_PRESETS.quiz.find((preset) => preset.id === "easier")!.instruction);
  });

  it("refuses a request that would not fit, rather than cutting the reader's text", () => {
    const full = "x".repeat(MAX_REGENERATION_INSTRUCTION - 20);
    expect(togglePreset("story", full, "shorter")).toBeUndefined();
    expect(togglePreset("story", full, "unknown")).toBe(full);
  });
});
