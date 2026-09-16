import { describe, expect, it } from "vitest";
import { MAX_DIFF_CELLS, diffWords, reconstruct, tokenize, withContext } from "./text-diff";

describe("word diff", () => {
  it("marks only the words that changed", () => {
    expect(diffWords("The model reads the whole sequence.", "The model reads every position at once.")).toEqual([
      { type: "same", text: "The model reads " },
      { type: "removed", text: "the whole sequence." },
      { type: "added", text: "every position at once." },
    ]);
  });

  it("groups neighbouring changes separated only by a space", () => {
    expect(diffWords("the old cat sat", "the new dog sat")).toEqual([
      { type: "same", text: "the " },
      { type: "removed", text: "old cat" },
      { type: "added", text: "new dog" },
      { type: "same", text: " sat" },
    ]);
  });

  it("does not cut a rewritten paragraph at every shared little word", () => {
    const segments = diffWords(
      "The encoder maps the input so that the decoder can be trained in parallel.",
      "A version that will be undone.",
    );
    expect(segments).toEqual([
      { type: "removed", text: "The encoder maps the input so that the decoder can be trained in parallel." },
      { type: "added", text: "A version that will be undone." },
    ]);
  });

  it("keeps a longer shared passage between two changes", () => {
    expect(diffWords("Old start, and the shared middle part stays, old end.", "New start, and the shared middle part stays, new end.")).toEqual([
      { type: "removed", text: "Old" },
      { type: "added", text: "New" },
      { type: "same", text: " start, and the shared middle part stays, " },
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
      { type: "same", text: " end." },
    ]);
  });

  it("returns nothing but the text when nothing changed, and handles empty sides", () => {
    expect(diffWords("Same text.", "Same text.")).toEqual([{ type: "same", text: "Same text." }]);
    expect(diffWords("", "Added.")).toEqual([{ type: "added", text: "Added." }]);
    expect(diffWords("Removed.", "")).toEqual([{ type: "removed", text: "Removed." }]);
  });

  it("always rebuilds both texts exactly", () => {
    const pairs = [
      ["A b c d e f.", "A c d x f g."],
      ["  leading and\n\ntrailing  ", "leading, and\ntrailing"],
      ["one two three four five", "five four three two one"],
      ["x y", "y x z"],
    ];
    for (const [before, after] of pairs) {
      const segments = diffWords(before, after);
      expect(reconstruct(segments, "before")).toBe(before);
      expect(reconstruct(segments, "after")).toBe(after);
    }
  });

  it("stays correct and quick on text too long to compare word by word", () => {
    const words = (seed: string) => Array.from({ length: 1_000 }, (_, index) => `${seed}${index}`).join(" ");
    const before = `Shared start. ${words("a")} Shared end.`;
    const after = `Shared start. ${words("b")} Shared end.`;
    expect(tokenize(words("a")).length ** 2).toBeGreaterThan(MAX_DIFF_CELLS);
    const segments = diffWords(before, after);
    expect(segments[0]).toEqual({ type: "same", text: "Shared start. " });
    expect(segments[segments.length - 1]).toEqual({ type: "same", text: " Shared end." });
    expect(reconstruct(segments, "before")).toBe(before);
    expect(reconstruct(segments, "after")).toBe(after);
  });

  it("shows a change with a few words around it, not the whole unchanged text", () => {
    const long = (label: string) => Array.from({ length: 40 }, (_, index) => `${label}${index}`).join(" ");
    const segments = diffWords(`${long("a")} old ${long("b")}`, `${long("a")} new ${long("b")}`);
    const shown = withContext(segments, 3);
    expect(shown.map((segment) => segment.text)).toEqual(["…", "a37 a38 a39 ", "old", "new", " b0 b1 b2 ", "…"]);
    expect(shown.filter((segment) => segment.elided)).toHaveLength(2);
    // Kısa metin olduğu gibi kalıyor.
    expect(withContext(diffWords("one two three", "one 2 three"), 3).some((segment) => segment.elided)).toBe(false);
  });
});
