import { describe, expect, it } from "vitest";
import { MAX_POSITIONS, parsePositions, positionLabel, READING_POSITIONS_KEY, readPositions, savePosition, worthContinuing, type ReadingPosition } from "./reading-position";

/** Tarayıcının depolaması yerine bellekte bir sözlük. */
function memory(fail = false) {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
  };
}
const at = (minute: number) => new Date(Date.UTC(2026, 8, 30, 9, minute)).toISOString();
const position = (index: number, minute = 0): ReadingPosition => ({ place: "report", sectionId: `s${index}`, title: `Section ${index + 1}`, index, total: 9, at: at(minute) });

describe("where you stopped reading", () => {
  it("keeps one place per paper, the newest two hundred papers, and reads a damaged value as nothing", () => {
    const store = memory();
    savePosition(store, "attention", position(2));
    savePosition(store, "attention", position(4, 1));
    expect(readPositions(store)).toEqual({ attention: position(4, 1) });
    for (let index = 0; index < MAX_POSITIONS + 5; index += 1) savePosition(store, `paper-${index}`, position(1, index + 2));
    const kept = readPositions(store);
    expect(Object.keys(kept)).toHaveLength(MAX_POSITIONS);
    expect(kept.attention).toBeUndefined();
    expect(kept[`paper-${MAX_POSITIONS + 4}`]).toBeDefined();
    expect(parsePositions("{not json")).toEqual({});
    expect(parsePositions(JSON.stringify({ a: position(1), b: { place: "elsewhere" } }))).toEqual({ a: position(1) });
    store.values.set(READING_POSITIONS_KEY, "[]");
    expect(readPositions(store)).toEqual({});
  });

  it("offers to continue only past the first section, says where, and never fails when storage is closed", () => {
    expect(worthContinuing(position(0))).toBe(false);
    expect(worthContinuing(undefined)).toBe(false);
    expect(worthContinuing(position(3))).toBe(true);
    expect(positionLabel(position(3))).toBe("4 of 9: Section 4");
    expect(() => savePosition(memory(true), "attention", position(3))).not.toThrow();
    expect(readPositions(undefined)).toEqual({});
  });
});
