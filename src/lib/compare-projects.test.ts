import { describe, expect, it } from "vitest";
import { compareProjects, formatDifference } from "./compare-projects";
import type { Metric, ResearchProject } from "./schema";

function metric(id: string, label: string, value: number, unit: string, page = 8): Metric {
  return {
    id,
    label,
    value,
    displayValue: String(value),
    unit,
    context: `context for ${label}`,
    sourceRef: { sourceId: "paper", page, excerpt: `excerpt ${id}` },
  };
}

function project(id: string, overrides: Partial<ResearchProject["evidence"]> = {}): ResearchProject {
  return {
    version: 1,
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    language: "en",
    audience: "student",
    depth: "deep",
    evidence: {
      paper: { title: `Paper ${id}`, authors: ["A"], year: "2024", venue: "NeurIPS" },
      sources: [{ id: "paper", type: "paper", title: "The PDF" }],
      thesis: "t",
      plainSummary: "s",
      researchQuestion: "q",
      methods: ["m"],
      findings: ["f"],
      limitations: ["l"],
      claims: [
        { id: "c1", statement: "s1", kind: "reported-result", confidence: "verified", sourceRefs: [{ sourceId: "paper", page: 1, excerpt: "e" }] },
        { id: "c2", statement: "s2", kind: "method", confidence: "verified", sourceRefs: [{ sourceId: "paper", page: 2, excerpt: "e" }] },
        { id: "c3", statement: "s3", kind: "method", confidence: "needs-review", sourceRefs: [{ sourceId: "paper", page: 3, excerpt: "e" }] },
        { id: "c4", statement: "s4", kind: "limitation", confidence: "verified", sourceRefs: [{ sourceId: "paper", page: 4, excerpt: "e" }] },
      ],
      metrics: [],
      glossary: [],
      ...overrides,
    },
    story: {
      title: "Story",
      dek: "d",
      readingTime: "5 min",
      accent: "#e75b37",
      sections: [
        { id: "s1", indexLabel: "01", kicker: "k", title: "One", body: "b", claimIds: ["c1", "c2"], visual: { type: "metric", eyebrow: "e", caption: "c", items: [] } },
        { id: "s2", indexLabel: "02", kicker: "k", title: "Two", body: "b", claimIds: ["c3", "c4"], visual: { type: "metric", eyebrow: "e", caption: "c", items: [] } },
      ],
      closing: { title: "c", body: "b" },
    },
  } as ResearchProject;
}

describe("compareProjects", () => {
  it("lines up a metric both papers report", () => {
    const left = project("a", { metrics: [metric("m1", "BLEU", 27.3, "BLEU")] });
    const right = project("b", { metrics: [metric("m9", "BLEU", 28.4, "BLEU")] });
    const result = compareProjects(left, right);
    expect(result.sharedMetrics).toHaveLength(1);
    expect(result.sharedMetrics[0].left.value).toBe(27.3);
    expect(result.sharedMetrics[0].right.value).toBe(28.4);
    expect(result.sharedMetrics[0].difference).toBeCloseTo(1.1);
  });

  it("matches labels that differ only in punctuation or case", () => {
    const left = project("a", { metrics: [metric("m1", "BLEU score", 27.3, "BLEU")] });
    const right = project("b", { metrics: [metric("m9", "bleu-score", 28.4, "BLEU")] });
    expect(compareProjects(left, right).sharedMetrics).toHaveLength(1);
  });

  it("does not line up the same number measured in different units", () => {
    // "41.8 BLEU" ile "41.8 saat" aynı sayıdır ve hiçbir ortak yanları yoktur.
    const left = project("a", { metrics: [metric("m1", "Training", 41.8, "BLEU")] });
    const right = project("b", { metrics: [metric("m9", "Training", 41.8, "hours")] });
    expect(compareProjects(left, right).sharedMetrics).toEqual([]);
  });

  it("does not fold an English label away under a Turkish locale", () => {
    // `toLocaleLowerCase("tr")` "I" harfini "ı"ya çeviriyor ve iki İngilizce
    // etiket birbirini bulamıyordu; eşleştirme dile duyarsız olmak zorunda.
    const left = project("a", { metrics: [metric("m1", "Inference latency", 12, "ms")] });
    const right = project("b", { metrics: [metric("m9", "INFERENCE LATENCY", 9, "ms")] });
    expect(compareProjects(left, right).sharedMetrics).toHaveLength(1);
  });

  it("consumes a match so one metric cannot answer for two", () => {
    const left = project("a", { metrics: [metric("m1", "BLEU", 27.3, "BLEU"), metric("m2", "BLEU", 28.4, "BLEU")] });
    const right = project("b", { metrics: [metric("m9", "BLEU", 30, "BLEU")] });
    const result = compareProjects(left, right);
    expect(result.sharedMetrics).toHaveLength(1);
    expect(result.sharedMetrics[0].left.value).toBe(27.3);
  });

  it("finds a term both papers define, and says whether they agree", () => {
    const left = project("a", { glossary: [{ term: "Attention", definition: "A weighted sum." }, { term: "Dropout", definition: "Random masking." }] });
    const right = project("b", { glossary: [{ term: "attention", definition: "A weighted sum." }, { term: "Residual", definition: "A skip connection." }] });
    const result = compareProjects(left, right);
    expect(result.sharedTerms.map((item) => [item.term, item.identical])).toEqual([["Attention", true]]);
    expect(result.onlyLeftTerms).toEqual(["Dropout"]);
    expect(result.onlyRightTerms).toEqual(["Residual"]);
  });

  it("flags a term the two papers define differently", () => {
    const left = project("a", { glossary: [{ term: "Head", definition: "One attention projection." }] });
    const right = project("b", { glossary: [{ term: "Head", definition: "The classifier on top of the encoder." }] });
    expect(compareProjects(left, right).sharedTerms[0].identical).toBe(false);
  });

  it("counts each side's claims by kind", () => {
    const result = compareProjects(project("a"), project("b"));
    expect(result.left.claimMix).toEqual({
      "reported-result": 1,
      "author-interpretation": 0,
      method: 2,
      background: 0,
      limitation: 1,
    });
  });

  it("carries each side's evidence health so the two can be judged together", () => {
    const result = compareProjects(project("a"), project("b"));
    expect(result.left.health.claims.verified).toBe(3);
    expect(result.right.health.claims.total).toBe(4);
  });

  it("returns nothing shared when the two papers have nothing in common", () => {
    const left = project("a", { metrics: [metric("m1", "BLEU", 27.3, "BLEU")], glossary: [{ term: "Attention", definition: "d" }] });
    const right = project("b", { metrics: [metric("m9", "F1", 0.91, "F1")], glossary: [{ term: "Residual", definition: "d" }] });
    const result = compareProjects(left, right);
    expect(result.sharedMetrics).toEqual([]);
    expect(result.sharedTerms).toEqual([]);
  });
});

describe("formatDifference", () => {
  it("keeps a small difference exact, because that is the reading", () => {
    // BLEU'da 1.1 ile 1.9 arasındaki fark makalenin bütün iddiası olabilir.
    expect(formatDifference(1.1)).toBe("+1.1");
    expect(formatDifference(-1.91)).toBe("-1.91");
    expect(formatDifference(0.0001)).toBe("+0.0001");
  });

  it("compacts a difference no one could read", () => {
    expect(formatDifference(-231_000_000_000_000_000)).toBe("-231,000T");
    expect(formatDifference(12_500)).toBe("+12.5K");
  });

  it("says equal rather than showing a zero", () => {
    expect(formatDifference(0)).toBe("equal");
    expect(formatDifference(-0)).toBe("equal");
  });

  it("does not print Infinity or NaN at the reader", () => {
    expect(formatDifference(Number.NaN)).toBe("equal");
    expect(formatDifference(Number.POSITIVE_INFINITY)).toBe("equal");
  });

  it("drops floating-point noise", () => {
    // 28.4 - 27.3 kayan noktada 1.0999999999999979 çıkıyor.
    expect(formatDifference(28.4 - 27.3)).toBe("+1.1");
  });
});
