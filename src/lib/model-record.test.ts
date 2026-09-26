import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { UNLOCATED_LIMIT, modelLabel, modelRecord, projectQuoteRecord, wilsonInterval } from "./model-record";
import { checkExcerpts } from "./paper-text";
import type { ExcerptCheck, ResearchProject } from "./schema";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");

function copy(id: string, changes: Partial<ResearchProject> = {}): ResearchProject {
  return { ...structuredClone(example), id, ...changes };
}

const checkedAt = "2026-09-01T00:00:00.000Z";

/**
 * İki modelli bir ekibin ürettiği gibi bir proje: kimlikler aşama önekli,
 * metrik "results"tan, sözlük "overview"dan. Denetim kaydı gerçek sayım
 * işleviyle, sayfalar boş verilerek üretiliyor; hangi alıntıların "bulunamadı"
 * sayılacağı ayrıca seçiliyor.
 */
function teamProject(id: string, unlocated: ExcerptCheck["unlocated"]) {
  const base = structuredClone(example);
  const ref = (page: number) => [{ sourceId: "paper", page, excerpt: `quote on page ${page}` }];
  base.evidence.claims = [
    { id: "overview-1", statement: "Background.", kind: "background", confidence: "verified", sourceRefs: ref(1) },
    { id: "method-1", statement: "Method.", kind: "method", confidence: "verified", sourceRefs: [...ref(3), ...ref(4)] },
    { id: "result-1", statement: "Result.", kind: "reported-result", confidence: "verified", sourceRefs: ref(8) },
    { id: "limit-1", statement: "Limit.", kind: "limitation", confidence: "verified", sourceRefs: ref(9) },
  ];
  base.evidence.metrics = [{ ...base.evidence.metrics[0], id: "metric-1", sourceRef: ref(8)[0] }];
  base.evidence.glossary = [{ ...base.evidence.glossary.find((item) => item.sourceRef)!, term: "Attention", sourceRef: ref(2)[0] }];
  const check = checkExcerpts(base.evidence, [""], checkedAt);
  return {
    ...base,
    id,
    generation: {
      provider: "anthropic",
      model: "claude-evidence",
      assignments: {
        evidence: { provider: "anthropic", model: "claude-evidence" },
        technical: { provider: "openai", model: "gpt-technical" },
        report: { provider: "anthropic", model: "claude-evidence" },
        visual: { provider: "gemini", model: "gemini-visual" },
      },
    },
    excerptCheck: { ...check, unlocated },
  } satisfies ResearchProject;
}

describe("one project's quotes", () => {
  it("counts the shipped example exactly as its quote check did", () => {
    const record = projectQuoteRecord(example);
    expect(record.status).toBe("counted");
    if (record.status !== "counted") return;
    expect(record.tallies).toEqual([
      { key: "native-agent:claude-code/claude-opus-5[1m]", provider: "native-agent", model: "claude-code/claude-opus-5[1m]", checked: 67, found: 67, approved: 0, rejected: 0 },
    ]);
  });

  it("splits a model team's quotes between the two models that wrote them", () => {
    const record = projectQuoteRecord(teamProject("team", [
      { owner: "claim", id: "method-1", page: 4 },
      { owner: "glossary", id: "Attention", page: 2 },
    ]));
    expect(record.status).toBe("counted");
    if (record.status !== "counted") return;
    // Kanıt modeli: overview (1) + limit (1) + sözlük (1). Teknik model: method (2) + result (1) + metrik (1).
    expect(record.tallies.map(({ key, checked, found }) => ({ key, checked, found }))).toEqual([
      { key: "anthropic:claude-evidence", checked: 3, found: 2 },
      { key: "openai:gpt-technical", checked: 4, found: 3 },
    ]);
  });

  it("gives every quote to the one model when a single model ran every stage, whatever the ids", () => {
    const project = copy("single", {
      generation: { provider: "gemini", model: "gemini-3.7-flash", assignments: {
        evidence: { provider: "gemini", model: "gemini-3.7-flash" },
        technical: { provider: "gemini", model: " gemini-3.7-flash " },
        report: { provider: "openai", model: "gpt-writer" },
        visual: { provider: "openai", model: "gpt-writer" },
      } },
    });
    const record = projectQuoteRecord(project);
    expect(record.status === "counted" && record.tallies.map((tally) => [tally.key, tally.checked])).toEqual([["gemini:gemini-3.7-flash", 67]]);
  });

  it("attributes a person's decisions to the model that wrote the claim", () => {
    const project = teamProject("reviewed", []);
    project.claimReviews = {
      "method-1": { status: "rejected", by: "Ada", at: checkedAt },
      "overview-1": { status: "approved", by: "Ada", at: checkedAt },
      "limit-1": { status: "approved", by: "Ada", at: checkedAt },
    };
    const record = projectQuoteRecord(project);
    expect(record.status === "counted" && record.tallies.map(({ key, approved, rejected }) => ({ key, approved, rejected }))).toEqual([
      { key: "anthropic:claude-evidence", approved: 2, rejected: 0 },
      { key: "openai:gpt-technical", approved: 0, rejected: 1 },
    ]);
  });

  it("does not count a project whose quotes were never checked", () => {
    expect(projectQuoteRecord(copy("unchecked", { excerptCheck: undefined }))).toMatchObject({ status: "excluded", reason: "not-checked" });
  });

  it("does not guess the model when the project does not say", () => {
    expect(projectQuoteRecord(copy("anonymous", { generation: undefined }))).toMatchObject({ status: "excluded", reason: "model-not-recorded" });
    expect(projectQuoteRecord(copy("blank", { generation: { provider: "openai", model: "  " } }))).toMatchObject({ reason: "model-not-recorded" });
  });

  it("does not trust a check that stopped at its limit", () => {
    const project = copy("truncated");
    project.excerptCheck = {
      ...project.excerptCheck!,
      checked: 900,
      unlocated: Array.from({ length: UNLOCATED_LIMIT }, () => ({ owner: "claim" as const, id: project.evidence.claims[0].id, page: 1 })),
    };
    expect(projectQuoteRecord(project)).toMatchObject({ status: "excluded", reason: "check-truncated" });
  });

  it("does not count a check that no longer describes the evidence", () => {
    const fewer = copy("fewer");
    fewer.evidence.metrics = fewer.evidence.metrics.slice(1);
    expect(projectQuoteRecord(fewer)).toMatchObject({ status: "excluded", reason: "changed-since-check" });

    const orphan = copy("orphan");
    orphan.excerptCheck = { ...orphan.excerptCheck!, unlocated: [{ owner: "claim", id: "claim-that-was-removed", page: 3 }] };
    expect(projectQuoteRecord(orphan)).toMatchObject({ status: "excluded", reason: "changed-since-check" });
  });

  it("does not guess which model wrote a claim whose stage it cannot tell", () => {
    const project = teamProject("odd-id", []);
    project.evidence.claims[0].id = "custom-1";
    expect(projectQuoteRecord(project)).toMatchObject({ status: "excluded", reason: "stage-unknown" });
  });
});

describe("Wilson interval", () => {
  it("keeps three found quotes out of three from looking certain", () => {
    const interval = wilsonInterval(3, 3)!;
    expect(interval.high).toBe(1);
    expect(interval.low).toBeCloseTo(0.4385, 3);
  });

  it("narrows as more quotes are checked", () => {
    const small = wilsonInterval(9, 10)!;
    const large = wilsonInterval(900, 1000)!;
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
    expect(large.low).toBeLessThan(0.9);
    expect(large.high).toBeGreaterThan(0.9);
  });

  it("has nothing to say about zero quotes", () => {
    expect(wilsonInterval(0, 0)).toBeUndefined();
  });
});

describe("the library's record", () => {
  function scored(id: string, model: string, checked: number, found: number, title = `Paper ${id}`): ResearchProject {
    const project = copy(id, { generation: { provider: "openai", model } });
    project.evidence.paper = { ...project.evidence.paper, title, doi: undefined };
    // Referans sayısı `checked` olacak şekilde iddialar kırpılıyor, metrik ve sözlük boşaltılıyor.
    project.evidence.metrics = [];
    project.evidence.glossary = [];
    const claim = project.evidence.claims[0];
    project.evidence.claims = Array.from({ length: checked }, (_, index) => ({ ...claim, id: `claim-${index}`, sourceRefs: [claim.sourceRefs[0]] }));
    project.excerptCheck = {
      checkedAt,
      method: "pdftotext",
      pageCount: 10,
      checked,
      unlocated: Array.from({ length: checked - found }, (_, index) => ({ owner: "claim" as const, id: `claim-${index}`, page: 1 })),
    };
    return project;
  }

  it("ranks by the lowest rate the evidence allows, not by the raw rate", () => {
    const record = modelRecord([scored("small", "lucky", 3, 3), scored("large", "steady", 300, 294)]);
    expect(record.models.map((row) => [row.model, row.found, row.checked, row.papers])).toEqual([
      ["steady", 294, 300, 1],
      ["lucky", 3, 3, 1],
    ]);
    expect(record.models[1].rate).toBe(1);
  });

  it("adds a model's papers together", () => {
    const record = modelRecord([scored("a", "same", 10, 9), scored("b", "same", 20, 20)]);
    expect(record.models).toHaveLength(1);
    expect(record.models[0]).toMatchObject({ papers: 2, checked: 30, found: 29 });
    expect(record.counted).toBe(2);
  });

  it("lists what it left out, with the reason", () => {
    const record = modelRecord([scored("kept", "m", 5, 5), copy("unchecked", { excerptCheck: undefined })]);
    expect(record.excluded.map((item) => [item.project.id, item.reason])).toEqual([["unchecked", "not-checked"]]);
  });

  it("lines up the same paper analysed by different models", () => {
    const record = modelRecord([
      scored("first", "model-a", 10, 10, "Attention Is All You Need"),
      scored("second", "model-b", 12, 9, "attention is all you need."),
      scored("rerun", "model-a", 10, 8, "Attention is all you need"),
      scored("other", "model-b", 5, 5, "Another paper"),
    ]);
    expect(record.samePaper).toHaveLength(1);
    expect(record.samePaper[0].title).toBe("Attention Is All You Need");
    expect(record.samePaper[0].entries.map((entry) => [entry.project.id, entry.model, entry.found, entry.checked])).toEqual([
      ["first", "model-a", 10, 10],
      ["second", "model-b", 9, 12],
      ["rerun", "model-a", 8, 10],
    ]);
  });

  it("joins the same paper by DOI when the titles differ, but not by a similar title", () => {
    const first = scored("doi-a", "model-a", 4, 4, "Deep Residual Learning");
    const second = scored("doi-b", "model-b", 4, 3, "Deep Residual Learning for Image Recognition");
    first.evidence.paper.doi = "10.1109/CVPR.2016.90";
    second.evidence.paper.doi = " 10.1109/cvpr.2016.90 ";
    expect(modelRecord([first, second]).samePaper).toHaveLength(1);

    second.evidence.paper.doi = undefined;
    expect(modelRecord([first, second]).samePaper).toHaveLength(0);
  });

  it("does not call one model's reruns a comparison", () => {
    expect(modelRecord([scored("x", "same", 4, 4, "T"), scored("y", "same", 4, 3, "T")]).samePaper).toEqual([]);
  });
});

describe("model labels", () => {
  it("names the provider, and calls a coding agent an agent", () => {
    expect(modelLabel({ provider: "anthropic", model: "claude-sonnet-5" })).toBe("Anthropic Claude · claude-sonnet-5");
    expect(modelLabel({ provider: "native-agent", model: "claude-code/claude-opus-5[1m]" })).toBe("Agent · claude-code/claude-opus-5[1m]");
    expect(modelLabel({ provider: "someone-else", model: "m" })).toBe("someone-else · m");
  });
});
