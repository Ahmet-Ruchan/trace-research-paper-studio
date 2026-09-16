import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/models/probe/route";
import { EXPECTED_SECTION_CHARACTERS, describeProbe, estimateSection, formatDuration } from "./model-probe";

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

describe("model test endpoint", () => {
  const post = (body: unknown) => POST(new Request("http://127.0.0.1/api/models/probe", { method: "POST", body: JSON.stringify(body) }));

  it("refuses bad requests before contacting any provider", async () => {
    expect((await post({ assignment: { provider: "nope", model: "x" } })).status).toBe(400);
    expect((await post({ assignment: { provider: "openai", model: "gpt-5.6-terra" } })).status).toBe(401);
    expect((await post({ assignment: { provider: "local", model: "qwen3:8b" }, apiKey: "http://example.com:11434/v1" })).status).toBe(400);
    const response = await post({ assignment: { provider: "openai", model: "gpt-5.6-terra" } });
    expect((await response.json()).error).toBe("OpenAI API key is required.");
  });
});
