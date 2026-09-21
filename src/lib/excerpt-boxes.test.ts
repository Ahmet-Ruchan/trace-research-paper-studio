import { describe, expect, it } from "vitest";
import { findExcerptWords, parseBboxPages, toHighlightRects } from "./excerpt-boxes";

const word = (text: string, xMin: number, yMin: number, width = 30) =>
  `<word xMin="${xMin}" yMin="${yMin}" xMax="${xMin + width}" yMax="${yMin + 10}">${text}</word>`;

const xhtml = `<doc><page width="600.000000" height="800.000000">
${word("We", 100, 100, 14)}${word("propose", 118, 100)}${word("a", 152, 100, 6)}${word("new", 162, 100, 18)}${word("simple", 184, 100)}${word("network", 218, 100)}${word("archi-", 252, 100)}
${word("tecture,", 100, 114, 40)}${word("the", 144, 114, 16)}${word("Transformer", 164, 114, 60)}${word("&amp;", 228, 114, 8)}${word("more.", 240, 114)}
</page><page width="600.000000" height="800.000000">${word("Second", 100, 100)}</page></doc>`;

describe("excerpt boxes", () => {
  const pages = parseBboxPages(xhtml);

  it("sayfaları, kelimeleri ve varlıkları ayrıştırır", () => {
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ width: 600, height: 800 });
    expect(pages[0].words.map((item) => item.text)).toContain("&");
  });

  it("satır sonunda tirelenen alıntıyı bulur ve satır başına bir dikdörtgen üretir", () => {
    const matched = findExcerptWords(pages[0].words, "a new simple network architecture, the Transformer");
    expect(matched.map((item) => item.text)).toEqual(["a", "new", "simple", "network", "archi-", "tecture,", "the", "Transformer"]);
    const rects = toHighlightRects(matched, pages[0]);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 152 / 600, y: 100 / 800, width: (282 - 152) / 600, height: 10 / 800 });
    expect(rects[1].y).toBe(114 / 800);
  });

  it("kısaltılmış alıntının her parçasını işaretler, biri yoksa hiçbirini", () => {
    expect(findExcerptWords(pages[0].words, "We propose a new … the Transformer & more").map((item) => item.text)).toEqual(
      // "&" harf taşımıyor; eşleştirme yalnızca harf ve rakamlara bakıyor.
      ["We", "propose", "a", "new", "the", "Transformer", "more."],
    );
    expect(findExcerptWords(pages[0].words, "We propose a new … a recurrent network")).toEqual([]);
    expect(findExcerptWords(pages[0].words, "short")).toEqual([]);
  });
});
