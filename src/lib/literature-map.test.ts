import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { buildLiteratureMap, MAX_MAP_PAPERS } from "./literature-map";
import type { ResearchProject } from "./schema";

/**
 * Fikstür gerçek örnek projeden türetiliyor: harita `evidenceHealth` dahil
 * bütün özet hesabını çalıştırıyor ve yapay bir mini proje o yolu sınamazdı.
 */
function paper(
  id: string,
  year: string,
  options: { metrics?: Array<[label: string, value: number, unit: string]>; glossary?: Array<[term: string, definition: string]>; language?: string } = {},
): ResearchProject {
  const base = loadExampleProject("attention-is-all-you-need.en.trace.json");
  return {
    ...base,
    id,
    language: options.language ?? base.language,
    evidence: {
      ...base.evidence,
      paper: { ...base.evidence.paper, title: `Paper ${id}`, year },
      metrics: (options.metrics ?? []).map(([label, value, unit], index) => ({
        id: `${id}-m${index}`,
        label,
        value,
        displayValue: String(value),
        unit,
        context: `${label} in ${id}`,
        sourceRef: { sourceId: "paper", page: index + 3, excerpt: "excerpt" },
      })),
      glossary: (options.glossary ?? []).map(([term, definition]) => ({ term, definition })),
    },
  };
}

describe("buildLiteratureMap", () => {
  it("makaleleri seçim sırasına değil yıla göre dizer ve harf verir", () => {
    const map = buildLiteratureMap([paper("late", "2021"), paper("early", "2014"), paper("unknown", "n.d."), paper("mid", "NeurIPS 2017")]);
    expect(map.papers.map((item) => [item.letter, item.id, item.yearNumber])).toEqual([
      ["A", "early", 2014],
      ["B", "mid", 2017],
      ["C", "late", 2021],
      ["D", "unknown", undefined],
    ]);
  });

  it("aynı ölçütü iki ve fazla makalede yıl sırasıyla izler, sayfasıyla birlikte", () => {
    const map = buildLiteratureMap([
      paper("c", "2020", { metrics: [["BLEU score", 30.1, "BLEU"]] }),
      paper("a", "2014", { metrics: [["BLEU Score", 20.7, "bleu"], ["Latency", 12, "ms"]] }),
      paper("b", "2017", { metrics: [["bleu-score", 28.4, "BLEU"], ["bleu score", 99, "BLEU"]] }),
    ]);
    expect(map.metrics).toHaveLength(1);
    expect(map.metrics[0].points.map((point) => [point.letter, point.value, point.page])).toEqual([
      ["A", 20.7, 3],
      ["B", 28.4, 3],
      ["C", 30.1, 3],
    ]);
  });

  it("tek makalede geçen ölçütü ve terimi haritaya almaz", () => {
    const map = buildLiteratureMap([
      paper("a", "2014", { metrics: [["Latency", 12, "ms"]], glossary: [["attention", "x"]] }),
      paper("b", "2017"),
      paper("c", "2020"),
    ]);
    expect(map.metrics).toEqual([]);
    expect(map.terms).toEqual([]);
  });

  it("aynı terimin tanımları aynı mı, söyler", () => {
    const map = buildLiteratureMap([
      paper("a", "2014", { glossary: [["Attention", "weights over inputs"], ["Encoder", "maps input"]] }),
      paper("b", "2017", { glossary: [["attention", "a query-key-value lookup"], ["encoder", "maps input"]] }),
      paper("c", "2020", { glossary: [["ATTENTION", "weights over inputs"]] }),
    ]);
    const attention = map.terms.find((term) => term.term === "Attention");
    expect(attention?.definitions.map((item) => item.letter)).toEqual(["A", "B", "C"]);
    expect(attention?.identical).toBe(false);
    expect(map.terms.find((term) => term.term === "Encoder")?.identical).toBe(true);
  });

  it("farklı dilleri bildirir, yinelenen projeyi ve sınırın üstünü atar", () => {
    const many = Array.from({ length: MAX_MAP_PAPERS + 2 }, (_, index) => paper(`p${index}`, String(2010 + index)));
    expect(buildLiteratureMap(many).papers).toHaveLength(MAX_MAP_PAPERS);

    const first = paper("same", "2014");
    const map = buildLiteratureMap([first, first, paper("tr", "2016", { language: "tr" })]);
    expect(map.papers).toHaveLength(2);
    expect(map.languages.sort()).toEqual(["en", "tr"]);
  });
});
