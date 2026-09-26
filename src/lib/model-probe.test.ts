import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/models/probe/route";
import {
  EXPECTED_SECTION_CHARACTERS,
  PDF_PROMPT_CHARACTERS,
  describeProbe,
  estimateSection,
  formatDuration,
  generationStageProfiles,
  slowestEstimate,
} from "./model-probe";
import { buildLearningPrompt } from "./learning-generation";
import { builtInTemplates } from "./narrative-templates";
import { buildDeepReportPrompt, buildEvidencePassPrompt, buildStoryPrompt } from "./prompts";
import type { ResearchProject } from "./schema";

const LOCAL_LIMIT = 15 * 60 * 1000;
const CLOUD_LIMIT = 120 * 1000;

describe("model speed estimate", () => {
  it("calls a quick cloud model fast", () => {
    const estimate = estimateSection(
      { firstChunkMs: 700, totalMs: 2_700, outputCharacters: 400, probePromptCharacters: 2_000 },
      { promptCharacters: 20_000, limitMs: CLOUD_LIMIT },
    );
    // Okuma 700 ms × 10, üretim 4000 / (400 / 2000 ms) = 20 s.
    expect(estimate).toEqual({ estimateSeconds: 27, limitSeconds: 120, verdict: "fast" });
  });

  it("recognises the local model that timed out in practice", () => {
    // Ölçülen: saniyede ~1,2 belirteç okuma, ~0,2 belirteç üretim.
    const estimate = estimateSection(
      { firstChunkMs: 45_000, totalMs: 120_000, outputCharacters: 90, probePromptCharacters: 2_000 },
      { promptCharacters: 20_000, limitMs: LOCAL_LIMIT },
    );
    expect(estimate.verdict).toBe("too-slow");
    expect(estimate.estimateSeconds).toBeGreaterThan(LOCAL_LIMIT / 1000);
  });

  it("marks an estimate between half the limit and the limit as slow", () => {
    const estimate = estimateSection(
      { firstChunkMs: 1_000, totalMs: 11_000, outputCharacters: 500, probePromptCharacters: 2_000 },
      { promptCharacters: 2_000, limitMs: CLOUD_LIMIT, expectedOutputCharacters: EXPECTED_SECTION_CHARACTERS },
    );
    expect(estimate.verdict).toBe("slow");
  });

  it("does not read a single tiny chunk as infinite speed", () => {
    const estimate = estimateSection(
      { firstChunkMs: 5_000, totalMs: 5_000, outputCharacters: 30, probePromptCharacters: 2_000 },
      { promptCharacters: 2_000, limitMs: CLOUD_LIMIT },
    );
    expect(Number.isFinite(estimate.estimateSeconds)).toBe(true);
    expect(estimate.verdict).toBe("too-slow");
  });

  it("says it in one sentence", () => {
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(8_000)).toBe("2 h");
    expect(describeProbe({ firstChunkMs: 800, estimateSeconds: 35, limitSeconds: 120, verdict: "fast" }))
      .toBe("Answered in 0.8 s. A section should take about 35 s.");
    expect(describeProbe({ firstChunkMs: 45_000, estimateSeconds: 4_200, limitSeconds: 900, verdict: "too-slow" }))
      .toContain("longer than the 15 min limit. Pick a faster model.");
  });
});

describe("full analysis estimate", () => {
  const example = JSON.parse(
    readFileSync(join(process.cwd(), "public/examples/attention-is-all-you-need.en.trace.json"), "utf8"),
  ) as ResearchProject;
  const options = { language: "en", audience: "student", depth: "standard", webContext: "" } as const;
  const near = (actual: number, expected: number) => {
    expect(actual).toBeGreaterThan(expected * 0.6);
    expect(actual).toBeLessThan(expected * 1.6);
  };

  it("uses request sizes that still match the real prompts and outputs", () => {
    // Profiller örnek projeden ölçüldü; istemler büyürse bu test eskiyen sayıyı yakalar.
    const profiles = generationStageProfiles({ depth: "standard" });
    near(profiles.evidence.promptCharacters - PDF_PROMPT_CHARACTERS, buildEvidencePassPrompt(options, "overview").length);
    near(profiles.technical.promptCharacters - PDF_PROMPT_CHARACTERS, buildEvidencePassPrompt(options, "results").length);
    near(profiles.visual.promptCharacters, buildStoryPrompt(example.evidence, { ...options, accent: example.story.accent }).length);
    near(profiles.report.promptCharacters, buildDeepReportPrompt(example.evidence, options).length);
    near(profiles.visual.outputCharacters, JSON.stringify(example.story).length);
    near(profiles.report.outputCharacters, JSON.stringify(example.deepReport).length);
    near(profiles.technical.outputCharacters, JSON.stringify(example.technicalAppendix).length);
    // Öğretim: standart derinlikte en ağır istek türetimler, derinde oyun alanları.
    const learning = { evidence: example.evidence, language: "en", audience: "student", technicalAppendix: example.technicalAppendix } as const;
    near(profiles.teaching.promptCharacters, buildLearningPrompt("derivations", { ...learning, depth: "standard" }).length);
    near(profiles.teaching.outputCharacters, JSON.stringify({ derivations: example.derivations }).length);
    const deep = generationStageProfiles({ depth: "deep" });
    near(deep.teaching.outputCharacters, JSON.stringify({ interactives: example.interactives }).length);
    near(generationStageProfiles({ depth: "concise" }).teaching.promptCharacters, buildLearningPrompt("primer", { ...learning, depth: "concise" }).length);
    near(generationStageProfiles({ depth: "concise" }).teaching.outputCharacters, JSON.stringify(example.primer).length);
  });

  it("grows the writing estimate with the number of sections", () => {
    const concise = generationStageProfiles({ depth: "concise" });
    const deep = generationStageProfiles({ depth: "deep" });
    expect(deep.visual.outputCharacters).toBeGreaterThan(concise.visual.outputCharacters);
    const template = builtInTemplates[0];
    expect(generationStageProfiles({ depth: "deep", template }).visual.outputCharacters)
      .toBe(Math.round(18_500 * template.story.length / 6));
  });

  it("lets the slowest request decide", () => {
    expect(slowestEstimate([{ id: "a", estimateSeconds: 4 }, { id: "b", estimateSeconds: 90 }, { id: "c", estimateSeconds: 20 }])?.id).toBe("b");
    expect(slowestEstimate([])).toBeUndefined();
    expect(describeProbe({ firstChunkMs: 800, estimateSeconds: 50, limitSeconds: 120, verdict: "fast" }, "The deep report"))
      .toBe("Answered in 0.8 s. The deep report should take about 50 s.");
  });
});

describe("model test endpoint", () => {
  const post = (body: unknown) => POST(new Request("http://127.0.0.1/api/models/probe", { method: "POST", body: JSON.stringify(body) }));

  it("refuses bad requests before contacting any provider", async () => {
    expect((await post({ assignment: { provider: "nope", model: "x" } })).status).toBe(400);
    expect((await post({ assignment: { provider: "openai", model: "gpt-5.6-terra" } })).status).toBe(401);
    expect((await post({ assignment: { provider: "local", model: "qwen3:8b" }, apiKey: "http://example.com:11434/v1" })).status).toBe(400);
    const response = await post({ assignment: { provider: "openai", model: "gpt-5.6-terra" } });
    expect((await response.json()).error).toBe("OpenAI API key is required.");
  });

  it("rejects malformed stage lists before contacting any provider", async () => {
    const assignment = { provider: "openai", model: "gpt-5.6-terra" };
    expect((await post({ assignment, apiKey: "k", stages: [{ id: "visual", label: "x", promptCharacters: 1, outputCharacters: 0 }] })).status).toBe(400);
    const tooMany = Array.from({ length: 9 }, () => ({ id: "visual", label: "x", promptCharacters: 1, outputCharacters: 1 }));
    expect((await post({ assignment, apiKey: "k", stages: tooMany })).status).toBe(400);
  });
});
