import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate/route";
import { loadExampleProject } from "./example-fixture";
import { readGenerationStream, type GenerationStreamEvent } from "./generation-events";
import { createSingleModelTeam, type ModelTeam } from "./model-providers";
import type { ResearchProject } from "./schema";

/**
 * Tam analiz hattı, sahte bir model çalışma zamanıyla. Model yanıtları örnek
 * projenin kendisi: kanıt geçişleri, anlatı, rapor, teknik ek ve öğrenme
 * blokları. Korunan şey modelin kalitesi değil, hattın öğrenme katmanını
 * doğru modele yazdırıp projeye takması ve bir blok düşerse analizin ayakta
 * kalması.
 */
const state = vi.hoisted(() => ({
  answers: new Map<string, unknown>(),
  calls: [] as Array<{ schemaName: string; model: string; prompt: string }>,
  log: [] as string[],
  failing: new Set<string>(),
  unavailable: new Set<string>(),
  technicalDelayMs: 0,
}));

vi.mock("@/lib/server/model-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/model-runtime")>();
  return {
    ...actual,
    prepareProviderRuntime: vi.fn(async (input: { provider: string; model: string }) => {
      if (state.unavailable.has(input.model)) throw Object.assign(new Error("connection refused"), { status: 503 });
      return {
        label: input.provider,
        effectiveModel: input.model,
        cleanup: async () => undefined,
        generateStructured: async (request: { schemaName: string; prompt: string }) => {
          state.calls.push({ schemaName: request.schemaName, model: input.model, prompt: request.prompt });
          state.log.push(`start:${request.schemaName}`);
          if (request.schemaName === "trace_technical_appendix" && state.technicalDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, state.technicalDelayMs));
          }
          state.log.push(`done:${request.schemaName}`);
          const answer = state.answers.get(request.schemaName);
          if (answer === undefined) throw new Error(`no canned answer for ${request.schemaName}`);
          if (state.failing.has(request.schemaName)) {
            // Var olmayan bir iddiaya dayanan yanıt: denetim iki denemede de reddeder.
            return JSON.stringify(answer).replace(/"claimIds":\[[^\]]*\]/g, '"claimIds":["claim-invented"]');
          }
          return JSON.stringify(answer);
        },
      };
    }),
  };
});

vi.mock("@/lib/server/paper-text-extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/paper-text-extract")>()),
  extractPaperPages: vi.fn(async () => {
    throw new Error("pdftotext is not used in this test");
  }),
}));

/** Örnek projenin iddia kimlikleri hattın geçiş öneklerine çevriliyor ("method-3", "result-7"). */
function cannedProject() {
  const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
  const prefix: Record<string, string> = {
    background: "overview-",
    "author-interpretation": "overview-",
    method: "method-",
    "reported-result": "result-",
    limitation: "limit-",
  };
  let text = JSON.stringify(example);
  example.evidence.claims.forEach((claim, index) => {
    text = text.replaceAll(`"${claim.id}"`, `"${prefix[claim.kind]}${index + 1}"`);
  });
  const project = JSON.parse(text) as ResearchProject;
  const claims = (start: string) => project.evidence.claims.filter((claim) => claim.id.startsWith(start));
  expect(claims("overview-1")).toHaveLength(1);
  return project;
}

function loadAnswers(project: ResearchProject) {
  const { evidence } = project;
  const claims = (start: string) => evidence.claims.filter((claim) => claim.id.startsWith(start));
  state.answers = new Map<string, unknown>([
    ["trace_evidence_overview", { paper: evidence.paper, thesis: evidence.thesis, plainSummary: evidence.plainSummary, researchQuestion: evidence.researchQuestion, glossary: evidence.glossary, claims: claims("overview-") }],
    ["trace_evidence_methods", { methods: evidence.methods, claims: claims("method-") }],
    ["trace_evidence_results", { findings: evidence.findings, claims: claims("result-"), metrics: evidence.metrics }],
    ["trace_evidence_limitations", { limitations: evidence.limitations, claims: claims("limit-") }],
    ["trace_story_spec", project.story],
    ["trace_deep_report", project.deepReport],
    ["trace_technical_appendix", project.technicalAppendix],
    ["trace_primer", project.primer],
    ["trace_quiz", project.quiz],
    ["trace_derivations", { derivations: project.derivations }],
    ["trace_interactives", { interactives: project.interactives }],
    ["trace_application_guide", project.applicationGuide],
  ]);
}

async function analyse(assignments: Partial<ModelTeam>, depth: ResearchProject["depth"] = "deep") {
  const form = new FormData();
  form.set("paper", new File([new TextEncoder().encode(`%PDF-1.4 test ${Math.random()}`)], "attention.pdf", { type: "application/pdf" }));
  form.set("language", "en");
  form.set("audience", "student");
  form.set("depth", depth);
  form.set("provider", "gemini");
  form.set("model", "gemini-3.7-flash");
  form.set("assignments", JSON.stringify(assignments));
  form.set("apiKeys", JSON.stringify({ gemini: "test-key", openai: "test-key", anthropic: "test-key" }));
  const response = await POST(new Request("http://127.0.0.1/api/generate", { method: "POST", body: form }));
  expect(response.ok).toBe(true);
  const events: GenerationStreamEvent[] = [];
  await readGenerationStream(response.body!, (event) => events.push(event));
  const error = events.find((event) => event.type === "error");
  if (error?.type === "error") throw new Error(error.error);
  const result = events.find((event) => event.type === "result");
  if (result?.type !== "result") throw new Error("the pipeline returned no result");
  return { project: result.project as ResearchProject, warnings: result.warnings, events };
}

const learningSchemas = ["trace_primer", "trace_quiz", "trace_derivations", "trace_interactives", "trace_application_guide"];

describe("analysis pipeline", () => {
  let project: ResearchProject;

  beforeAll(() => {
    process.env.TRACE_DATA_DIR = mkdtempSync(join(tmpdir(), "trace-pipeline-"));
    project = cannedProject();
  });

  beforeEach(() => {
    loadAnswers(project);
    state.calls = [];
    state.log = [];
    state.failing = new Set();
    state.unavailable = new Set();
    state.technicalDelayMs = 0;
  });

  it("writes the learning layer the depth asks for, after the technical appendix, and records the teaching model", async () => {
    const { project: result, warnings, events } = await analyse(createSingleModelTeam({ provider: "gemini", model: "gemini-3.7-flash" }));

    expect(result.primer).toEqual(project.primer);
    expect(result.quiz).toEqual(project.quiz);
    expect(result.derivations).toEqual(project.derivations);
    expect(result.interactives).toEqual(project.interactives);
    expect(result.applicationGuide).toEqual(project.applicationGuide);
    expect(result.generation?.assignments?.teaching).toEqual({ provider: "gemini", model: "gemini-3.7-flash" });
    expect(warnings.join(" ")).not.toContain("learning layer");

    // Tek model: görevler sırayla; öğretim teknik ekten sonra, türetimler ekin denklemlerini görüyor.
    const order = state.calls.map((call) => call.schemaName);
    expect(order.filter((name) => learningSchemas.includes(name))).toEqual(learningSchemas);
    expect(order.indexOf("trace_primer")).toBeGreaterThan(order.indexOf("trace_technical_appendix"));
    const derivations = state.calls.find((call) => call.schemaName === "trace_derivations")!;
    expect(derivations.prompt).toContain(`"id":"${project.technicalAppendix!.equations[0].id}"`);

    // İlerleme çubuğu geri gitmiyor, paralel şeritler olsa bile.
    const values = events.flatMap((event) => (event.type === "progress" && !event.heartbeat ? [event.progress] : []));
    values.forEach((value, index) => expect(value, `step ${index}`).toBeGreaterThanOrEqual(values[index - 1] ?? 0));
  });

  it("asks only for the primer at concise depth", async () => {
    // Özlü derinlik: 5 anlatı ve 6 rapor bölümü; yöntem, sınırlılık ve her rapor türü yerinde kalıyor.
    const story = [0, 1, 2, 4, 7].map((index, position) => ({ ...project.story.sections[index], indexLabel: String(position + 1).padStart(2, "0") }));
    const report = [0, 1, 3, 5, 6, 7].map((index) => project.deepReport!.sections[index]);
    loadAnswers({ ...project, story: { ...project.story, sections: story }, deepReport: { ...project.deepReport!, sections: report } });
    const { project: result } = await analyse(createSingleModelTeam({ provider: "gemini", model: "gemini-3.7-flash" }), "concise");
    expect(state.calls.map((call) => call.schemaName).filter((name) => learningSchemas.includes(name))).toEqual(["trace_primer"]);
    expect(result.primer).toBeDefined();
    expect(result.quiz).toBeUndefined();
  });

  it("keeps the analysis when a block fails its checks twice, and says what is missing", async () => {
    state.failing.add("trace_quiz");
    state.technicalDelayMs = 60;
    const team: ModelTeam = {
      ...createSingleModelTeam({ provider: "gemini", model: "gemini-3.7-flash" }),
      teaching: { provider: "openai", model: "gpt-5.6-terra" },
    };
    const { project: result, warnings } = await analyse(team);

    expect(result.quiz).toBeUndefined();
    expect(result.primer).toEqual(project.primer);
    expect(result.interactives).toEqual(project.interactives);
    expect(warnings).toContain(
      "The learning layer is incomplete: the quiz could not be written. The model's answer did not pass the checks twice. Everything else is complete; the missing parts can be added from the Lab.",
    );
    expect(state.calls.filter((call) => call.schemaName === "trace_quiz")).toHaveLength(2);
    // Öğretim kendi modelinde; türetimler başka şeritteki teknik eki bekledi.
    expect(state.calls.filter((call) => learningSchemas.includes(call.schemaName)).every((call) => call.model === "gpt-5.6-terra")).toBe(true);
    expect(state.log.indexOf("start:trace_derivations")).toBeGreaterThan(state.log.indexOf("done:trace_technical_appendix"));
  });

  it("completes the analysis when the teaching model cannot even be reached", async () => {
    state.unavailable.add("gpt-5.6-luna");
    const team: ModelTeam = {
      ...createSingleModelTeam({ provider: "gemini", model: "gemini-3.7-flash" }),
      teaching: { provider: "openai", model: "gpt-5.6-luna" },
    };
    const { project: result, warnings } = await analyse(team);
    expect(result.story.sections).toHaveLength(project.story.sections.length);
    expect(result.primer).toBeUndefined();
    expect(warnings.join(" ")).toContain("The learning layer is incomplete: the primer, the quiz, the derivations, the interactive explorations and the application guide could not be written.");
    expect(state.calls.some((call) => learningSchemas.includes(call.schemaName))).toBe(false);
  });

  it("gives an older client's four-role team its report model as the teacher", async () => {
    const older: Partial<ModelTeam> = {
      ...createSingleModelTeam({ provider: "gemini", model: "gemini-3.7-flash" }),
      report: { provider: "anthropic", model: "claude-sonnet-4-5" },
    };
    delete older.teaching;
    const { project: result } = await analyse(older);
    expect(result.generation?.assignments?.teaching).toEqual({ provider: "anthropic", model: "claude-sonnet-4-5" });
    expect(state.calls.find((call) => call.schemaName === "trace_primer")?.model).toBe("claude-sonnet-4-5");
  });
});
