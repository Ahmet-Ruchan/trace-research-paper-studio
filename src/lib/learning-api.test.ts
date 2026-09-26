import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/learning/route";
import { loadExampleProject } from "./example-fixture";
import { readGenerationStream, type GenerationStreamEvent } from "./generation-events";
import type { ResearchProject } from "./schema";
import { evidenceFingerprint } from "./section-regeneration";

/** Mevcut projeye öğrenme katmanı ekleyen uç; model sahte, yanıtlar örnek projenin blokları. */
const state = vi.hoisted(() => ({
  answers: new Map<string, unknown>(),
  prompts: new Map<string, string>(),
  failing: new Set<string>(),
  refuseKey: false,
}));

vi.mock("@/lib/server/model-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/model-runtime")>();
  return {
    ...actual,
    prepareProviderRuntime: vi.fn(async (input: { provider: string; model: string }) => ({
      label: input.provider,
      effectiveModel: input.model,
      cleanup: async () => undefined,
      generateStructured: async (request: { schemaName: string; prompt: string }) => {
        state.prompts.set(request.schemaName, request.prompt);
        if (state.refuseKey) throw Object.assign(new Error("invalid api key"), { status: 401 });
        const answer = JSON.stringify(state.answers.get(request.schemaName));
        return state.failing.has(request.schemaName) ? answer.replace(/"claimIds":\[[^\]]*\]/g, '"claimIds":["claim-invented"]') : answer;
      },
    })),
  };
});

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");

/** Öğrenme katmanından önce üretilmiş, standart derinlikte bir proje. */
function withoutLearning(): ResearchProject {
  const project = structuredClone(example) as Partial<ResearchProject>;
  delete project.primer;
  delete project.quiz;
  delete project.derivations;
  delete project.interactives;
  delete project.applicationGuide;
  return { ...project, depth: "standard" } as ResearchProject;
}

async function post(body: unknown) {
  return POST(new Request("http://127.0.0.1/api/learning", { method: "POST", body: JSON.stringify(body) }));
}

async function events(response: Response) {
  const collected: GenerationStreamEvent[] = [];
  await readGenerationStream(response.body!, (event) => collected.push(event));
  return collected;
}

const assignment = { provider: "openai", model: "gpt-5.6-terra" };

describe("adding the learning layer to an existing project", () => {
  beforeEach(() => {
    state.answers = new Map<string, unknown>([
      ["trace_primer", example.primer],
      ["trace_quiz", example.quiz],
      ["trace_derivations", { derivations: example.derivations }],
    ]);
    state.prompts = new Map();
    state.failing = new Set();
    state.refuseKey = false;
  });

  it("refuses what it cannot do before contacting a model", async () => {
    expect((await post({ project: withoutLearning(), assignment })).status).toBe(401);
    expect((await post({ project: withoutLearning(), assignment: { provider: "openai", model: "no-such-model" }, apiKey: "k" })).status).toBe(400);
    const complete = await post({ project: example, assignment, apiKey: "k" });
    expect(complete.status).toBe(400);
    expect((await complete.json()).error).toBe("This project already has its learning layer.");
    const overwrite = await post({ project: example, blocks: ["quiz"], assignment, apiKey: "k" });
    expect(overwrite.status).toBe(409);
    expect((await overwrite.json()).error).toContain("already has the quiz");
    expect(state.prompts.size).toBe(0);
  });

  it("writes only the missing blocks the depth asks for, sealed to the evidence", async () => {
    const project = withoutLearning();
    const response = await post({ project, assignment, apiKey: "k" });
    const result = (await events(response)).find((event) => event.type === "learning");
    if (result?.type !== "learning") throw new Error("no learning result");
    expect(result.blocks).toEqual({ primer: example.primer, quiz: example.quiz, derivations: example.derivations });
    expect(result.failed).toEqual([]);
    expect(result.evidenceFingerprint).toBe(evidenceFingerprint(project.evidence));
    expect([...state.prompts.keys()]).toEqual(["trace_primer", "trace_quiz", "trace_derivations"]);
  });

  it("returns what it could write and names what it could not", async () => {
    state.failing.add("trace_quiz");
    const result = (await events(await post({ project: withoutLearning(), assignment, apiKey: "k" }))).find((event) => event.type === "learning");
    if (result?.type !== "learning") throw new Error("no learning result");
    expect(Object.keys(result.blocks as object).sort()).toEqual(["derivations", "primer"]);
    expect(result.failed).toEqual([{ block: "quiz", reason: "The model's answer did not pass the checks twice." }]);
  });

  it("stops at a refused key and says so, instead of trying every block", async () => {
    state.refuseKey = true;
    const collected = await events(await post({ project: withoutLearning(), assignment, apiKey: "k" }));
    expect(collected.some((event) => event.type === "learning")).toBe(false);
    expect(collected.find((event) => event.type === "error")).toBeDefined();
    expect([...state.prompts.keys()]).toEqual(["trace_primer"]);
  });

  it("does not show the model a claim a reviewer rejected", async () => {
    const project = withoutLearning();
    const rejected = example.quiz!.questions[0].claimIds[0];
    project.claimReviews = { [rejected]: { status: "rejected", by: "Ada", at: "2026-09-01T00:00:00.000Z" } };
    state.answers.set("trace_quiz", { ...example.quiz, questions: example.quiz!.questions.filter((question) => !question.claimIds.includes(rejected)) });
    await events(await post({ project, blocks: ["quiz"], assignment, apiKey: "k" }));
    expect(state.prompts.get("trace_quiz")).not.toContain(`"id":"${rejected}"`);
  });
});
