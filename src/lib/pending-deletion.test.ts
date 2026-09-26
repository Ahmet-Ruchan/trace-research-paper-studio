import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingDeletion, UNDO_WINDOW_MS, type FlushReason } from "./pending-deletion";

type Item = { id: string };

function setup() {
  const committed: Array<[string, FlushReason]> = [];
  const shown: Array<string | undefined> = [];
  const deletion = new PendingDeletion<Item>(
    (item, reason) => committed.push([item.id, reason]),
    (item) => shown.push(item?.id),
  );
  return { deletion, committed, shown };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("undoable deletion", () => {
  it("deletes only after the undo window has passed", () => {
    const { deletion, committed } = setup();
    deletion.schedule({ id: "a" });
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(committed).toEqual([]);
    expect(deletion.current).toEqual({ id: "a" });
    vi.advanceTimersByTime(1);
    expect(committed).toEqual([["a", "timeout"]]);
    expect(deletion.current).toBeUndefined();
  });

  it("brings the item back on undo and never deletes it later", () => {
    const { deletion, committed, shown } = setup();
    deletion.schedule({ id: "a" });
    expect(deletion.undo()).toEqual({ id: "a" });
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    expect(committed).toEqual([]);
    expect(shown).toEqual(["a", undefined]);
    expect(deletion.undo()).toBeUndefined();
  });

  it("completes the earlier deletion when a second one starts", () => {
    const { deletion, committed } = setup();
    deletion.schedule({ id: "a" });
    deletion.schedule({ id: "b" });
    expect(committed).toEqual([["a", "replaced"]]);
    expect(deletion.undo()).toEqual({ id: "b" });
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(committed).toEqual([["a", "replaced"]]);
  });

  it("completes at once when the user leaves or the page closes, and only once", () => {
    const { deletion, committed } = setup();
    deletion.schedule({ id: "a" });
    deletion.flush("pagehide");
    deletion.flush("left");
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(committed).toEqual([["a", "pagehide"]]);
  });
});
