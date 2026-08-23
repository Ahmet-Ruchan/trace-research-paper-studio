import { describe, expect, it } from "vitest";
import { evidenceHealth } from "./evidence-health";
import type { Claim, ResearchProject } from "./schema";

function claim(id: string, page: number | undefined, confidence: Claim["confidence"], sourceId = "paper"): Claim {
  return {
    id,
    statement: `Statement ${id}`,
    kind: "reported-result",
    confidence,
    sourceRefs: [{ sourceId, page, excerpt: `excerpt ${id}` }],
  };
}

function project(overrides: Partial<ResearchProject> = {}): ResearchProject {
  const base: ResearchProject = {
    version: 1,
    id: "p1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    language: "en",
    audience: "student",
    depth: "deep",
    evidence: {
      paper: { title: "A paper", authors: ["A"], year: "2024", venue: "NeurIPS" },
      sources: [
        { id: "paper", type: "paper", title: "The PDF" },
        { id: "arxiv", type: "web", title: "arXiv metadata", url: "https://arxiv.org/abs/1" },
      ],
      thesis: "t",
      plainSummary: "s",
      researchQuestion: "q",
      methods: ["m"],
      findings: ["f"],
      limitations: ["l"],
      claims: [
        claim("c1", 1, "verified"),
        claim("c2", 3, "verified"),
        claim("c3", 5, "needs-review"),
        claim("c4", undefined, "verified", "arxiv"),
      ],
      metrics: [],
      glossary: [],
    },
    story: {
      title: "Story",
      dek: "d",
      readingTime: "5 min",
      accent: "#e75b37",
      sections: [
        {
          id: "s1",
          indexLabel: "01",
          kicker: "k",
          title: "Section one",
          body: "b",
          claimIds: ["c1", "c2"],
          visual: { type: "metric", eyebrow: "e", caption: "c", items: [] },
        },
        {
          id: "s2",
          indexLabel: "02",
          kicker: "k",
          title: "Section two",
          body: "b",
          claimIds: ["c3"],
          visual: { type: "metric", eyebrow: "e", caption: "c", items: [] },
        },
      ],
      closing: { title: "c", body: "b" },
    },
  } as ResearchProject;
  return { ...base, ...overrides };
}

describe("evidenceHealth", () => {
  it("counts verified against needs-review", () => {
    const health = evidenceHealth(project());
    expect(health.claims).toEqual({ total: 4, verified: 3, needsReview: 1, verifiedRatio: 0.75 });
  });

  it("separates paper-anchored claims from web context", () => {
    const health = evidenceHealth(project());
    expect(health.grounding).toEqual({ fromPaper: 3, fromWeb: 1 });
  });

  it("reports the gaps between the first and last cited page", () => {
    const health = evidenceHealth(project());
    expect(health.pages.cited).toEqual([1, 3, 5]);
    expect(health.pages.first).toBe(1);
    expect(health.pages.last).toBe(5);
    expect(health.pages.gaps).toEqual([2, 4]);
  });

  it("counts a page reached by a figure or metric as covered", () => {
    const withExtras = project();
    withExtras.evidence.metrics = [
      {
        id: "m1",
        label: "BLEU",
        value: 28.4,
        displayValue: "28.4",
        unit: "BLEU",
        context: "c",
        sourceRef: { sourceId: "paper", page: 2, excerpt: "e" },
      },
    ];
    withExtras.figures = [
      {
        id: "f1",
        label: "Figure 1",
        caption: "c",
        whyItMatters: "w",
        page: 4,
        image: "data:image/png;base64,AAAA",
        claimIds: [],
      },
    ];
    expect(evidenceHealth(withExtras).pages.gaps).toEqual([]);
  });

  it("has no page span at all when nothing carries a page", () => {
    const webOnly = project();
    webOnly.evidence.claims = [claim("c1", undefined, "verified", "arxiv")];
    webOnly.story.sections[0].claimIds = ["c1"];
    webOnly.story.sections[1].claimIds = ["c1"];
    const health = evidenceHealth(webOnly);
    expect(health.pages.cited).toEqual([]);
    expect(health.pages.first).toBeUndefined();
    expect(health.pages.gaps).toEqual([]);
  });

  it("marks a section thin when it hangs on a single claim", () => {
    const health = evidenceHealth(project());
    const one = health.sections.find((section) => section.id === "s1");
    const two = health.sections.find((section) => section.id === "s2");
    expect(one?.thin).toBe(false);
    expect(two?.thin).toBe(true);
    expect(two?.claimCount).toBe(1);
  });

  it("marks a section thin when none of its claims are verified", () => {
    const unverified = project();
    unverified.evidence.claims = [claim("c1", 1, "needs-review"), claim("c2", 2, "needs-review")];
    unverified.story.sections[0].claimIds = ["c1", "c2"];
    unverified.story.sections[1].claimIds = ["c1", "c2"];
    const health = evidenceHealth(unverified);
    expect(health.sections.every((section) => section.thin)).toBe(true);
    expect(health.sections[0].claimCount).toBe(2);
  });

  it("finds claims that were collected but never referenced", () => {
    const health = evidenceHealth(project());
    expect(health.unusedClaims.map((item) => item.id)).toEqual(["c4"]);
    expect(health.usedClaimCount).toBe(3);
  });

  it("counts a claim as used when any block references it, not just the story", () => {
    const withReport = project({
      deepReport: {
        title: "r",
        dek: "d",
        readingTime: "9 min",
        sections: [
          { id: "r1", kind: "contribution", title: "R", summary: "s", analysis: ["a", "b"], claimIds: ["c4"] },
        ],
        openQuestions: ["q1", "q2", "q3"],
      },
    } as Partial<ResearchProject>);
    const health = evidenceHealth(withReport);
    expect(health.unusedClaims).toEqual([]);
    expect(health.sections.map((section) => section.area)).toEqual(["story", "story", "report"]);
  });

  it("reaches claimIds nested deep inside the learning layer", () => {
    const withGuide = project({
      applicationGuide: {
        title: "g",
        overview: "o",
        recipe: [
          { step: "one", detail: "d", claimIds: ["c4"] },
          { step: "two", detail: "d", claimIds: ["c1"] },
        ],
        hyperparameters: [],
        pitfalls: [],
        whenNotToUse: ["never"],
      },
    } as Partial<ResearchProject>);
    expect(evidenceHealth(withGuide).unusedClaims).toEqual([]);
  });

  it("ranks sources by how often they are cited and names the unused ones", () => {
    const health = evidenceHealth(project());
    expect(health.sources.map((source) => [source.id, source.claimCount])).toEqual([
      ["paper", 3],
      ["arxiv", 1],
    ]);
  });

  it("survives a claim pointing at a source that does not exist", () => {
    // Şema bunu reddediyor, ama panel bozuk bir dosyada da çökmemeli:
    // sağlık paneli tam da kusurları göstermek için var.
    const broken = project();
    broken.evidence.claims = [claim("c1", 1, "verified", "ghost")];
    broken.story.sections[0].claimIds = ["c1"];
    broken.story.sections[1].claimIds = ["c1"];
    const health = evidenceHealth(broken);
    expect(health.grounding.fromPaper).toBe(1);
    expect(health.sources.every((source) => source.claimCount === 0)).toBe(true);
  });
});
