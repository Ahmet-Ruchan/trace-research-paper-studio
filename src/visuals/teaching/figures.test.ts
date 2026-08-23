import { describe, expect, it } from "vitest";
import { figuresBySection } from "./figures";
import type { Figure } from "@/lib/schema";

function figure(id: string, claimIds: string[]): Figure {
  return {
    id,
    label: `Figure ${id}`,
    caption: "c",
    whyItMatters: "w",
    page: 1,
    image: "data:image/png;base64,AAAA",
    claimIds,
  };
}

const sections = [
  { id: "s1", claimIds: ["c1", "c2"] },
  { id: "s2", claimIds: ["c3"] },
  { id: "s3", claimIds: ["c1", "c4"] },
];

describe("figuresBySection", () => {
  it("places a figure in the section that shares a claim with it", () => {
    const placed = figuresBySection([figure("f1", ["c3"])], sections);
    expect([...placed.keys()]).toEqual(["s2"]);
    expect(placed.get("s2")?.map((item) => item.id)).toEqual(["f1"]);
  });

  it("places a figure only once even when several sections match", () => {
    // c1 hem s1'de hem s3'te; şekil yalnızca ilkine yerleşmeli, yoksa aynı
    // diyagram hikâyede iki kez basılır.
    const placed = figuresBySection([figure("f1", ["c1"])], sections);
    expect([...placed.keys()]).toEqual(["s1"]);
  });

  it("keeps several figures that belong to the same section together", () => {
    const placed = figuresBySection([figure("f1", ["c1"]), figure("f2", ["c2"])], sections);
    expect(placed.get("s1")?.map((item) => item.id)).toEqual(["f1", "f2"]);
    expect(placed.size).toBe(1);
  });

  it("leaves out a figure that matches no section", () => {
    const placed = figuresBySection([figure("f1", ["nope"])], sections);
    expect(placed.size).toBe(0);
  });

  it("leaves out a figure with no claim links at all", () => {
    // `claimIds` şemada varsayılan olarak boş; eski projeler ve iddiaya
    // bağlanmamış şekiller hikâyeye değil, yalnızca genel bakışa düşer.
    const placed = figuresBySection([figure("f1", [])], sections);
    expect(placed.size).toBe(0);
  });

  it("returns an empty map when the project has no figures", () => {
    expect(figuresBySection(undefined, sections).size).toBe(0);
    expect(figuresBySection([], sections).size).toBe(0);
  });

  it("follows the narrative order, not the figure order", () => {
    const placed = figuresBySection([figure("f2", ["c3"]), figure("f1", ["c1"])], sections);
    expect([...placed.keys()]).toEqual(["s1", "s2"]);
  });
});
