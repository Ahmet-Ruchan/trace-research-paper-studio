import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrast, FOCUS_COLORS, focusColor, focusColorStyle, textSafeFill } from "./focus-colors";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("focus colours", () => {
  it("offers the eleven colours of the studio's palette", () => {
    expect(FOCUS_COLORS.map((color) => color.label)).toEqual(["Yellow", "Blue", "Red", "Green", "Orange", "Purple", "Lilac", "Light blue", "Navy", "Burgundy", "Pink"]);
    const palette = readFileSync(join(root, "src/lib/trace-storage.ts"), "utf8");
    for (const color of FOCUS_COLORS) expect(palette).toContain(`"${color.hex}"`);
  });

  it("keeps text on every colour readable, deepening a mid tone only where it has to", () => {
    for (const color of FOCUS_COLORS) {
      const { fill, on } = focusColor(color.id);
      expect(contrast(fill, on), color.label).toBeGreaterThanOrEqual(4.5);
    }
    // Palette hepsi yetiyor; ne beyazın ne koyunun yettiği orta bir ton koyulaşıyor.
    expect(FOCUS_COLORS.every((color) => textSafeFill(color.hex) === color.hex)).toBe(true);
    const deepened = textSafeFill("#777777");
    expect(deepened).not.toBe("#777777");
    expect(contrast(deepened, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(focusColor("red").on).toBe("#161714");
    expect(focusColorStyle("navy")).toEqual({ "--focus": "#1E3A8A", "--focus-fill": "#1E3A8A", "--on-focus": "#ffffff" });
    expect(focusColor("nothing", "pink").id).toBe("pink");
  });

  it("derives the colour's text tone per theme, like the paper accent", () => {
    const css = readFileSync(join(root, "src/app/focus.css"), "utf8");
    expect(css).toMatch(/--focus-ink:\s*oklch\(from var\(--focus[^)]*\) min\(l, \.5\) c h\)/);
    expect(css).toMatch(/html\[data-theme="dark"\][^{]*\{[^}]*--focus-ink:\s*oklch\(from var\(--focus[^)]*\) max\(l, \.72\) c h\)/);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*html\[data-theme="system"\]/);
  });
});
