import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { readingItemSchema, readingListToJson, workKey, type ReadingItem } from "./reading-list";
import type { ResearchProject } from "./schema";
import { completeStep, studyFileToJson, type StudyProgress } from "./study-path";
import { todayBrief } from "./today";
import { addSessions, emptyWorkLog, type WorkSession } from "./work-log";

/** Günler yerel: testler sabit bir saat diliminde koşuyor. */
let zone: string | undefined;
beforeEach(() => {
  zone = process.env.TZ;
  process.env.TZ = "Europe/Istanbul";
});
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const project: ResearchProject = { ...example, id: "attention" };
const concept = example.primer!.concepts[0];
const T0 = "2026-09-27T09:00:00.000Z";
const now = new Date("2026-09-30T15:00:00+03:00");
const session = (id: string, from: string, to: string): WorkSession => ({ id, start: new Date(`2026-09-30T${from}:00+03:00`).toISOString(), end: new Date(`2026-09-30T${to}:00+03:00`).toISOString(), kind: "focus" });
const saved = (title: string, patch: Partial<ReadingItem> = {}): ReadingItem => readingItemSchema.parse({ id: workKey({ title, identifier: patch.identifier }), title, addedAt: T0, ...patch });

/** Bir kavramı okumuş (yarın dönecek kart) ve yolun ortasında kalmış okuyucu. */
const studied = (): Map<string, StudyProgress> => new Map([[project.id, completeStep(completeStep(undefined, "start", `concept:${concept.id}`, T0), `concept:${concept.id}`, "next", T0)]]);

describe("the day's brief", () => {
  it("puts the reader's due cards, the paper they left half way and their goal in one answer", () => {
    const brief = todayBrief({
      projects: [project],
      study: studied(),
      readingList: [saved("Neural Machine Translation by Jointly Learning to Align and Translate", { identifier: "arxiv:1409.0473", from: [{ projectId: project.id, relation: "reference" }] })],
      log: addSessions(emptyWorkLog(), [session("a", "09:00", "09:40")]),
      goalMinutes: 120,
      weekStart: 1,
      now,
    });
    expect(brief.day).toBe("2026-09-30");
    expect(brief.review).toMatchObject({ due: 1, papers: [{ projectId: "attention", paper: example.evidence.paper.title, due: 1 }] });
    expect(brief.continueStudying).toEqual([expect.objectContaining({ projectId: "attention", done: 2, lastStudied: T0 })]);
    expect(brief.continueStudying[0].total).toBeGreaterThan(2);
    // Tek makalelik kütüphanede okuma sırası yok: kaydedilmiş çalışma nereden kaydedildiğiyle geliyor.
    expect(brief.readNext).toEqual({ kind: "saved", title: "Neural Machine Translation by Jointly Learning to Align and Translate", identifier: "arxiv:1409.0473", why: `${example.evidence.paper.title} builds on it.` });
    expect(brief.work).toMatchObject({ today: 40 * 60, goal: 120 * 60, streak: 1 });
    expect(brief.suggestions).toEqual([
      `Review 1 card from ${example.evidence.paper.title}, about 1 minute.`,
      `Continue studying ${example.evidence.paper.title}: 2 of ${brief.continueStudying[0].total} steps done.`,
      `Next on your reading list: Neural Machine Translation by Jointly Learning to Align and Translate. ${example.evidence.paper.title} builds on it.`,
      "1h 20m to go for today's goal of 2h.",
    ]);
  });

  it("names the next paper in the reading order, or one not started yet, and says when the goal is met", () => {
    const log = addSessions(emptyWorkLog(), [session("a", "09:00", "10:05")]);
    const alone = todayBrief({ projects: [project], study: new Map(), readingList: [], log, goalMinutes: 60, weekStart: 1, now });
    expect(alone.review).toEqual({ due: 0, papers: [] });
    expect(alone.continueStudying).toEqual([]);
    expect(alone.readNext).toEqual({ kind: "paper", projectId: "attention", paper: example.evidence.paper.title, status: "new", from: "library" });
    expect(alone.suggestions).toEqual([`Not started yet: ${example.evidence.paper.title}.`, "Today's goal of 1h is met."]);

    // Transformer'ın tanımladığı bir kavramı varsayan makale okuma sırasında ondan sonra geliyor.
    const later: ResearchProject = {
      ...example,
      id: "later",
      evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "A Later Paper", year: "2019", doi: undefined }, glossary: [] },
      primer: { ...example.primer!, concepts: example.primer!.concepts.slice(0, 3).map((item, index) => ({ ...item, id: `later-c${index}`, term: index ? `Filler ${index}` : "Multi-head attention", prerequisiteIds: [] })) },
    };
    const ordered = todayBrief({ projects: [later, project], study: new Map(), readingList: [], log, goalMinutes: 60, weekStart: 1, now });
    expect(ordered.readNext).toEqual({ kind: "paper", projectId: "attention", paper: example.evidence.paper.title, status: "new", from: "reading order" });
    expect(ordered.suggestions[0]).toBe(`Next in your reading order: ${example.evidence.paper.title}.`);
  });

  it("stays quiet about reading on an empty library", () => {
    const brief = todayBrief({ projects: [], study: new Map(), readingList: [], log: emptyWorkLog(), goalMinutes: 90, weekStart: 0, now });
    expect(brief.readNext).toBeUndefined();
    expect(brief.suggestions).toEqual(["1h 30m to go for today's goal of 1h 30m."]);
  });

  it("answers an agent with the reader's day", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const workspace = mkdtempSync(join(tmpdir(), "trace-today-"));
    try {
      mkdirSync(join(workspace, "library"), { recursive: true });
      writeFileSync(join(workspace, "library", "attention.trace.json"), JSON.stringify(project));
      writeFileSync(join(workspace, "library", "study.json"), JSON.stringify(studyFileToJson(studied())));
      writeFileSync(join(workspace, "library", "reading-list.json"), JSON.stringify(readingListToJson([saved("A saved survey")])));
      const recent = Date.now();
      writeFileSync(join(workspace, "focus-log.json"), JSON.stringify(addSessions(emptyWorkLog(), [{ id: "s", start: new Date(recent - 30 * 60_000).toISOString(), end: new Date(recent - 5 * 60_000).toISOString(), kind: "focus" }])));
      writeFileSync(join(workspace, "profile.json"), JSON.stringify({ version: 1, firstName: "Ada", createdAt: T0, updatedAt: T0 }));
      const run = spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), "today"], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace } });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const answer = JSON.parse(run.stdout) as { ok: boolean; reader: string; review: { due: number }; continueStudying: Array<{ projectId: string }>; work: { today: { seconds: number; time: string } }; suggestions: string[]; note: string };
      expect(answer).toMatchObject({ ok: true, reader: "Ada", review: { due: 1 }, continueStudying: [{ projectId: "attention" }] });
      expect(answer.work.today.seconds).toBeGreaterThanOrEqual(0);
      expect(answer.suggestions[0]).toMatch(/^Review 1 card from /);
      expect(answer.suggestions.at(-1)).toMatch(/goal/);
      expect(answer.note).toMatch(/Never write any of this into a project/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
