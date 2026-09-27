import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { parseExplainTarget, type ExplanationFeedback } from "./explain-back";
import {
  MAX_EXPLANATIONS_PER_SECTION,
  compareExplanations,
  explanationHistory,
  explanationRecord,
  forgetExplanations,
  recordExplanation,
} from "./explanation-history";
import { MAX_EXPLANATIONS, parseStudyFile, parseStudyProgress, recordAnswer, type StudyProgress } from "./study-path";

const project = loadExampleProject("attention-is-all-you-need.en.trace.json");
const target = parseExplainTarget("story:story-attention");
const other = parseExplainTarget(`story:${project.story.sections.find((section) => section.id !== "story-attention")!.id}`);
const T = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

const first: ExplanationFeedback = {
  summary: "The formula is right; the failure without scaling was never measured.",
  covered: [{ claimId: "claim-method-05", note: "Your first sentence." }],
  missed: [],
  misstated: [{ quote: "training fails completely", claimId: "claim-interpretation-01", correction: "Only a supposition." }],
  unsupported: [],
};
const second: ExplanationFeedback = {
  summary: "Both points, and the scaling is now a precaution.",
  covered: [{ claimId: "claim-method-05", note: "n" }, { claimId: "claim-interpretation-01", note: "n" }],
  missed: [],
  misstated: [],
  unsupported: [],
};
const record = (feedback: ExplanationFeedback, day: number, text = `Explanation written on day ${day}, long enough to count.`, at = target) =>
  explanationRecord(project, at, text, feedback, { total: 2 }, "test-model", T(day));

describe("the history of a reader's own explanations", () => {
  it("keeps what each explanation conveyed, counted on the section's own claims", () => {
    const withOutsider = { ...first, covered: [...first.covered, { claimId: project.evidence.claims.at(-1)!.id, note: "not this section" }] };
    const entry = record(withOutsider, 1);
    expect(entry).toMatchObject({ target: "story:story-attention", covered: ["claim-method-05"], missed: [], misstated: 1, unsupported: 0, total: 2, model: "test-model" });
    // Bölüm yeniden yazılınca mühür değişiyor: eski anlatış başka bir metne ait.
    const rewritten = {
      ...project,
      story: { ...project.story, sections: project.story.sections.map((section) => (section.id === "story-attention" ? { ...section, body: `${section.body} More.` } : section)) },
    };
    expect(explanationRecord(rewritten, target, "x".repeat(40), first, { total: 2 }, "m", T(1)).sig).not.toBe(entry.sig);
  });

  it("says what was conveyed this time that was not last time, what dropped out and what is missing both times", () => {
    const change = compareExplanations(record(first, 1), record(second, 8));
    expect(change).toMatchObject({ sameSection: true, gained: ["claim-interpretation-01"], lost: [], before: { covered: 1, total: 2 }, after: { covered: 2, total: 2 } });
    const backwards = compareExplanations(record(second, 8), { ...record(first, 9), missed: ["claim-interpretation-01"] });
    expect(backwards).toMatchObject({ gained: [], lost: ["claim-interpretation-01"], stillMissed: [] });
    const twice = compareExplanations({ ...record(first, 1), missed: ["claim-interpretation-01"] }, { ...record(first, 2), missed: ["claim-interpretation-01"] });
    expect(twice.stillMissed).toEqual(["claim-interpretation-01"]);
  });

  it("keeps the newest few per section, never touches the rest of the progress, and can forget one section", () => {
    let progress: StudyProgress | undefined = recordAnswer(undefined, project.quiz!.questions[0], { correct: true, attempts: 1, revealed: false }, T(1));
    for (let day = 1; day <= MAX_EXPLANATIONS_PER_SECTION + 2; day += 1) progress = recordExplanation(progress, record(first, day), T(day));
    progress = recordExplanation(progress, record(first, 3, "The other section, in my own words, at some length.", other), T(3));
    const history = explanationHistory(progress, target);
    expect(history).toHaveLength(MAX_EXPLANATIONS_PER_SECTION);
    expect(history[0].at).toBe(T(MAX_EXPLANATIONS_PER_SECTION + 2));
    expect(history.at(-1)!.at).toBe(T(3));
    expect(explanationHistory(progress, other)).toHaveLength(1);
    expect(progress!.answers).toHaveLength(1);
    // Çalışma dosyasının şeması yeni alanı taşıyor; eski kayıtlar da okunuyor.
    expect(parseStudyProgress(JSON.parse(JSON.stringify(progress)))).toEqual(progress);
    expect(parseStudyProgress({ version: 1, done: [], answers: [], startedAt: T(1), updatedAt: T(1) })).toBeDefined();

    const forgotten = forgetExplanations(progress, target, T(20));
    expect(explanationHistory(forgotten, target)).toEqual([]);
    expect(explanationHistory(forgotten, other)).toHaveLength(1);
    expect(forgotten!.answers).toHaveLength(1);
    expect(forgetExplanations(forgetExplanations(forgotten, other, T(21)), other, T(22))).not.toHaveProperty("explanations");
  });

  it("never lets the whole paper's history grow past its limit", () => {
    let progress: StudyProgress | undefined;
    for (let index = 0; index < MAX_EXPLANATIONS + 10; index += 1) {
      const section = parseExplainTarget(`story:section-${index}`);
      progress = recordExplanation(progress, { ...record(first, 1), target: `story:${section.sectionId}`, at: new Date(Date.parse(T(1)) + index * 1000).toISOString() }, T(2));
    }
    expect(progress!.explanations).toHaveLength(MAX_EXPLANATIONS);
    expect(progress!.explanations![0].target).toBe("story:section-10");
  });
});

describe("the explanation history from an agent", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const BRIDGE = join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs");
  let workspace: string;
  let projectPath: string;
  const library = () => join(workspace, "data", "library");

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-explain-history-"));
    projectPath = join(workspace, "paper.trace.json");
    writeFileSync(projectPath, JSON.stringify(project, null, 2));
  });
  afterEach(() => rmSync(workspace, { recursive: true, force: true }));

  const bridge = (...args: string[]) => {
    const run = spawnSync(process.execPath, [BRIDGE, ...args], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data") } });
    return { status: run.status, json: JSON.parse(run.status === 0 ? run.stdout : run.stderr) as Record<string, unknown> };
  };
  const explain = (text: string, feedback: ExplanationFeedback, ...extra: string[]) => {
    const prepared = bridge("explain", "--project", projectPath, "--target", "story:story-attention", "--text", text);
    writeFileSync(String(prepared.json.feedbackPath), JSON.stringify(feedback));
    return bridge("explain-check", "--brief", String(prepared.json.briefPath), ...extra);
  };
  const firstText = "Attention scores are dot products divided by the square root of d_k. Without it training fails completely.";
  const secondText = "Scores are dot products scaled by one over the square root of d_k; the authors only suspect that large values would hurt.";

  it("keeps the explanation with the reader's study progress when the paper is in the library, and says what changed", () => {
    const outside = explain(firstText, first);
    expect(outside.json.history).toMatchObject({ saved: false });

    mkdirSync(library(), { recursive: true });
    const fileName = `project-${createHash("sha256").update(project.id).digest("hex").slice(0, 24)}.trace.json`;
    writeFileSync(join(library(), fileName), JSON.stringify(project));
    writeFileSync(join(library(), "study.json"), JSON.stringify({ version: 1, projects: [{ id: project.id, progress: recordAnswer(undefined, project.quiz!.questions[0], { correct: true, attempts: 1, revealed: false }, T(1)) }] }));

    const once = explain(firstText, first, "--model", "agent-model");
    expect(once.json.history).toMatchObject({ saved: true, explanations: 1, sinceLast: null });
    // Aynı metin iki kez kaydedilmiyor.
    const again = bridge("explain-check", "--brief", join(workspace, "explanations", "story-story-attention.brief.json"));
    expect(again.json.history).toMatchObject({ saved: false, reason: "This explanation was already recorded.", explanations: 1 });

    const twice = explain(secondText, second);
    const since = (twice.json.history as { sinceLast: { before: object; after: object; conveyedThisTimeNotLast: Array<{ claimId: string; page: number | null }> } }).sinceLast;
    expect(twice.json.history).toMatchObject({ saved: true, explanations: 2 });
    expect(since.before).toEqual({ covered: 1, total: 2 });
    expect(since.after).toEqual({ covered: 2, total: 2 });
    expect(since.conveyedThisTimeNotLast.map((item) => item.claimId)).toEqual(["claim-interpretation-01"]);
    expect(since.conveyedThisTimeNotLast[0].page).toBe(4);

    // Stüdyonun okuduğu kayıt: iki anlatış, en yenisi önce; önceki yanıtlar yerinde.
    const progress = parseStudyFile(JSON.parse(readFileSync(join(library(), "study.json"), "utf8"))).get(project.id);
    expect(explanationHistory(progress, target).map((item) => [item.text, item.model])).toEqual([[secondText, "your agent"], [firstText, "agent-model"]]);
    expect(progress!.answers).toHaveLength(1);

    const skipped = explain(`${secondText} Once more.`, second, "--no-save");
    expect(skipped.json.history).toEqual({ saved: false, reason: "--no-save" });
    expect(JSON.parse(readFileSync(projectPath, "utf8"))).toEqual(project);
  });
});
