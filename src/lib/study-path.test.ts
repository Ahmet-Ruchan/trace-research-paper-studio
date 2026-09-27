import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/library/study/route";
import { loadExampleProject } from "./example-fixture";
import { readingDrillFor } from "./reading-drill";
import {
  completeStep,
  emptyStudyProgress,
  parseStudyFile,
  recordAnswer,
  resumeStepId,
  savedAnswer,
  studyFileToJson,
  studyPath,
  studySummary,
  visitStep,
  type StudyProgress,
} from "./study-path";
import { deleteStoredProject, saveStoredProject, traceLibraryDirectory } from "./trace-storage";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const drill = readingDrillFor(example);
const path = studyPath(example, drill);
const T0 = "2026-09-01T00:00:00.000Z";

describe("the study path", () => {
  it("walks the paper in learning order: question, concepts, sections, work, check, apply, review", () => {
    const phases = path.steps.map((step) => step.phase);
    expect(phases[0]).toBe("prepare");
    expect(path.steps[0].kind).toBe("start");
    expect(path.steps.at(-1)!.kind).toBe("finish");
    const order = ["prepare", "read", "work", "check", "apply", "review"];
    expect(phases.map((phase) => order.indexOf(phase))).toEqual([...phases.map((phase) => order.indexOf(phase))].sort((a, b) => a - b));
    expect(path.steps.filter((step) => step.kind === "section").map((step) => step.kind === "section" && step.sectionId)).toEqual(example.story.sections.map((section) => section.id));
    expect(path.steps.filter((step) => step.kind === "derivation")).toHaveLength(example.derivations!.length);
    expect(path.steps.filter((step) => step.kind === "interactive")).toHaveLength(example.interactives!.length);
    expect(path.steps.some((step) => step.kind === "guide")).toBe(true);
  });

  it("puts every concept after the concepts it builds on", () => {
    const concepts = path.steps.flatMap((step) => (step.kind === "concept" ? [step.conceptId] : []));
    expect(concepts).toHaveLength(example.primer!.concepts.length);
    for (const concept of example.primer!.concepts) {
      for (const prerequisite of concept.prerequisiteIds) expect(concepts.indexOf(prerequisite), concept.id).toBeLessThan(concepts.indexOf(concept.id));
    }
  });

  it("ends each section with a question on the same claims, and asks no question twice", () => {
    const asked: string[] = [];
    for (const step of path.steps) {
      if (step.kind === "section" && step.checkId) {
        const section = example.story.sections.find((item) => item.id === step.sectionId)!;
        const question = path.questions.get(step.checkId)!;
        expect(question.claimIds.some((id) => section.claimIds.includes(id)), step.id).toBe(true);
        asked.push(step.checkId);
      }
      if (step.kind === "quiz") asked.push(...step.questionIds);
    }
    expect(new Set(asked).size).toBe(asked.length);
    // Yazılmış quiz'in her sorusu yolda bir yerde soruluyor.
    for (const question of example.quiz!.questions) expect(asked).toContain(question.id);
    // Alıştırma sorusu yalnızca bölümle iddia paylaşan quiz sorusu kalmadığında.
    const earlier = new Set<string>();
    for (const step of path.steps) {
      if (step.kind !== "section" || !step.checkId) continue;
      const section = example.story.sections.find((item) => item.id === step.sectionId)!;
      if (step.checkId.startsWith("drill-")) {
        const sharing = example.quiz!.questions.filter((question) => question.claimIds.some((id) => section.claimIds.includes(id)));
        expect(sharing.every((question) => earlier.has(question.id)), step.id).toBe(true);
      }
      earlier.add(step.checkId);
    }
    expect([...earlier].some((id) => id.startsWith("drill-"))).toBe(true);
  });

  it("still gives a paper without a learning layer a path, with questions drawn from its evidence", () => {
    const bare = { ...example, primer: undefined, quiz: undefined, derivations: undefined, interactives: undefined, applicationGuide: undefined };
    const plain = studyPath(bare, readingDrillFor(bare));
    expect(plain.steps.map((step) => step.kind)).toEqual(["start", ...bare.story.sections.map(() => "section"), "finish"]);
    const checks = plain.steps.flatMap((step) => (step.kind === "section" && step.checkId ? [step.checkId] : []));
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((id) => id.startsWith("drill-"))).toBe(true);
  });
});

describe("study progress", () => {
  const firstSection = path.steps.find((step) => step.kind === "section")!;
  const check = firstSection.kind === "section" ? path.questions.get(firstSection.checkId!)! : undefined!;

  it("remembers finished steps and where the reader is", () => {
    let progress: StudyProgress | undefined = completeStep(undefined, "start", path.steps[1].id, T0);
    progress = completeStep(progress, path.steps[1].id, path.steps[2].id, T0);
    progress = completeStep(progress, path.steps[1].id, path.steps[2].id, T0);
    expect(progress.done).toEqual(["start", path.steps[1].id]);
    expect(resumeStepId(path, progress)).toBe(path.steps[2].id);
    // Artık yolda olmayan bir adım (bölüm silindi): ilk bitmemiş adım.
    expect(resumeStepId(path, { ...progress, current: "section:gone" })).toBe(path.steps[2].id);
    expect(resumeStepId(path, undefined)).toBe("start");
    expect(visitStep(progress, "finish", T0).finishedAt).toBe(T0);
  });

  it("keeps the latest answer to a question, and forgets it when the question is rewritten", () => {
    let progress = recordAnswer(undefined, check, { correct: false, attempts: 2, revealed: true }, T0);
    progress = recordAnswer(progress, check, { correct: true, attempts: 1, revealed: false }, T0);
    expect(progress.answers).toHaveLength(1);
    expect(savedAnswer(progress, check)).toMatchObject({ correct: true, attempts: 1 });
    expect(savedAnswer(progress, { ...check, prompt: `${check.prompt} (rewritten)` })).toBeUndefined();
  });

  it("points a missed question back at its section and the concepts on the same claims", () => {
    const progress = recordAnswer(emptyStudyProgress(T0), check, { correct: true, attempts: 2, revealed: false }, T0);
    const summary = studySummary(example, path, progress);
    expect(summary.checks).toMatchObject({ answered: 1, firstTry: 0, total: path.questions.size });
    expect(summary.revisit.map((step) => step.id)).toContain(firstSection.id);
    const concepts = summary.revisit.filter((step) => step.kind === "concept");
    for (const step of concepts) {
      const concept = example.primer!.concepts.find((item) => step.kind === "concept" && item.id === step.conceptId)!;
      expect(concept.claimIds.some((id) => check.claimIds.includes(id))).toBe(true);
    }
    // Yol sırasıyla; atlananlar bitiş dışındaki her adım.
    expect(summary.skipped).toHaveLength(summary.total);
    const allRight = recordAnswer(emptyStudyProgress(T0), check, { correct: true, attempts: 1, revealed: false }, T0);
    expect(studySummary(example, path, allRight).revisit).toEqual([]);
  });

  it("stores progress per project in a file a hand edit cannot turn into a prototype", () => {
    const entries = new Map<string, StudyProgress>([["__proto__", emptyStudyProgress(T0)], ["paper", completeStep(undefined, "start", "x", T0)]]);
    const parsed = parseStudyFile(JSON.parse(JSON.stringify(studyFileToJson(entries))));
    expect([...parsed.keys()]).toEqual(["__proto__", "paper"]);
    expect(parsed.get("paper")!.done).toEqual(["start"]);
    expect(parseStudyFile({ version: 2, projects: [] }).size).toBe(0);
    expect(parseStudyFile({ version: 1, projects: [{ id: "bad", progress: { version: 1 } }] }).size).toBe(0);
  });
});

describe("study progress API", () => {
  let workspace: string;
  let previousDataDirectory: string | undefined;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-study-api-"));
    previousDataDirectory = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
  });

  afterEach(() => {
    if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
    else process.env.TRACE_DATA_DIR = previousDataDirectory;
    rmSync(workspace, { recursive: true, force: true });
  });

  const base = "http://127.0.0.1/api/library/study";
  const get = (id: string) => GET(new Request(`${base}?id=${id}`)).then((response) => response.json());
  const put = (id: string, body: unknown) =>
    PUT(new Request(`${base}?id=${id}`, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }));
  const progress = completeStep(undefined, "start", "section:x", T0);

  it("saves, reads and clears a paper's progress, and removes it with the paper", async () => {
    await saveStoredProject({ ...example, id: "study-api" });
    expect(await get("study-api")).toEqual({ progress: null });

    const saved = await put("study-api", { progress });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("Cache-Control")).toBe("no-store");
    expect(await get("study-api")).toEqual({ progress });

    expect((await put("study-api", { progress: null })).status).toBe(200);
    expect(await get("study-api")).toEqual({ progress: null });

    await put("study-api", { progress });
    // Kimliksiz okuma bütün kütüphaneyi veriyor: tekrar kuyruğu bunu kullanıyor.
    expect(await GET(new Request(base)).then((response) => response.json())).toEqual({ version: 1, projects: [{ id: "study-api", progress }] });
    await deleteStoredProject("study-api");
    expect(await get("study-api")).toEqual({ progress: null });
  });

  it("refuses a paper that is not in the library, a bad body, and a missing id", async () => {
    expect((await put("nowhere", { progress })).status).toBe(404);
    await saveStoredProject({ ...example, id: "study-bad" });
    expect((await put("study-bad", { progress: { version: 1 } })).status).toBe(400);
    expect((await put("study-bad", "{")).status).toBe(400);
    expect((await put("study-bad", JSON.stringify({ progress, padding: "x".repeat(300_000) }))).status).toBe(413);
    expect((await PUT(new Request(base, { method: "PUT", body: JSON.stringify({ progress }) }))).status).toBe(400);
  });

  it("sets a damaged file aside instead of writing over it", async () => {
    await saveStoredProject({ ...example, id: "study-damaged" });
    writeFileSync(join(traceLibraryDirectory(), "study.json"), JSON.stringify({ something: "else" }));
    expect((await put("study-damaged", { progress })).status).toBe(200);
    const kept = JSON.parse(readFileSync(join(traceLibraryDirectory(), "study.json"), "utf8"));
    expect(kept.projects).toHaveLength(1);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(traceLibraryDirectory()).some((name) => name.startsWith("study.damaged-"))).toBe(true);
  });
});
