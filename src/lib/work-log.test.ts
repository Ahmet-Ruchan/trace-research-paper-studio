import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import {
  addSessions,
  calendarYears,
  dailyTotals,
  dayKey,
  emptyWorkLog,
  extendReviewBlock,
  formatClock,
  formatDuration,
  heatLevel,
  heatmap,
  MAX_SESSIONS,
  mergeWorkLogs,
  REVIEW_CARD_CAP_MS,
  parseWorkLog,
  removeSession,
  SESSION_KIND_LABELS,
  sessionPieces,
  STUDY_STEP_CAP_MS,
  timeByProject,
  workLogSchema,
  workLogToJson,
  workSummary,
  type WorkSession,
} from "./work-log";

/** Günler yerel saate göre: testler sabit bir saat diliminde koşuyor. */
let zone: string | undefined;
beforeEach(() => {
  zone = process.env.TZ;
  process.env.TZ = "Europe/Istanbul";
});
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

/** İstanbul saatiyle (UTC+3) bir an. */
const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+03:00`);
const session = (id: string, day: string, from: string, to: string, kind: WorkSession["kind"] = "focus"): WorkSession => ({
  id,
  start: new Date(at(day, from)).toISOString(),
  end: new Date(at(day, to)).toISOString(),
  kind,
});

describe("the work log", () => {
  it("counts overlapping sessions once: a focus round and a stopwatch at the same time, or two tabs", () => {
    const log = addSessions(emptyWorkLog(), [
      session("a", "2026-09-20", "09:00", "09:25"),
      session("b", "2026-09-20", "09:10", "09:40", "stopwatch"),
      session("c", "2026-09-20", "10:00", "10:30"),
    ]);
    expect(dailyTotals(log).get("2026-09-20")).toBe(70 * 60);
  });

  it("splits a session across midnight on the reader's clock", () => {
    const log = addSessions(emptyWorkLog(), [{ id: "late", start: new Date(at("2026-09-20", "23:30")).toISOString(), end: new Date(at("2026-09-21", "00:45")).toISOString(), kind: "stopwatch" }]);
    const totals = dailyTotals(log);
    expect(totals.get("2026-09-20")).toBe(30 * 60);
    expect(totals.get("2026-09-21")).toBe(45 * 60);
  });

  it("adds a session once, keeps the longer copy of the same one, and removes one", () => {
    const first = addSessions(emptyWorkLog(), [session("a", "2026-09-20", "09:00", "09:10")]);
    const again = addSessions(first, [session("a", "2026-09-20", "09:00", "09:25"), session("a", "2026-09-20", "09:00", "09:05")]);
    expect(again.sessions).toHaveLength(1);
    expect(again.sessions[0].end).toBe(new Date(at("2026-09-20", "09:25")).toISOString());
    expect(removeSession(again, "a").sessions).toEqual([]);
  });

  it("folds the oldest sessions into day totals instead of dropping them", () => {
    const many = Array.from({ length: MAX_SESSIONS + 2 }, (_, index) => {
      const start = at("2026-01-01", "08:00") + index * 3_600_000;
      return { id: `s${index}`, start: new Date(start).toISOString(), end: new Date(start + 600_000).toISOString(), kind: "focus" as const };
    });
    const log = addSessions(emptyWorkLog(), many);
    expect(log.sessions).toHaveLength(MAX_SESSIONS);
    expect(Object.values(log.archive).reduce((sum, seconds) => sum + seconds, 0)).toBe(2 * 600);
    const total = [...dailyTotals(log).values()].reduce((sum, seconds) => sum + seconds, 0);
    expect(total).toBe((MAX_SESSIONS + 2) * 600);
  });

  it("merges an imported log without counting the same file twice", () => {
    const mine = addSessions(emptyWorkLog(), [session("a", "2026-09-20", "09:00", "09:25")]);
    const theirs = { ...addSessions(emptyWorkLog(), [session("a", "2026-09-20", "09:00", "09:25"), session("b", "2026-09-21", "09:00", "10:00")]), archive: { "2025-01-02": 3600 } };
    const once = mergeWorkLogs(mine, theirs);
    const twice = mergeWorkLogs(once, theirs);
    expect(twice).toEqual(once);
    expect(once.sessions.map((item) => item.id)).toEqual(["a", "b"]);
    expect(once.archive).toEqual({ "2025-01-02": 3600 });
  });

  it("splits an interval longer than twelve hours, and writes one session per line", () => {
    const start = at("2026-09-20", "00:00");
    const pieces = sessionPieces({ kind: "stopwatch", label: "  Reading  " }, start, start + 13 * 3_600_000);
    expect(pieces.map((piece) => piece.id)).toEqual([`stopwatch-${start}`, `stopwatch-${start}-1`]);
    expect(pieces[0].label).toBe("Reading");
    const log = addSessions(emptyWorkLog(), pieces);
    const text = workLogToJson(log);
    expect(text.split("\n")).toHaveLength(5);
    expect(workLogSchema.parse(JSON.parse(text))).toEqual(log);
    expect(JSON.parse(workLogToJson(emptyWorkLog()))).toEqual(emptyWorkLog());
  });

  it("rejects a session that ends before it starts, and reads a damaged file as empty", () => {
    expect(workLogSchema.safeParse({ version: 1, sessions: [session("x", "2026-09-20", "10:00", "09:00")], archive: {} }).success).toBe(false);
    expect(parseWorkLog({ version: 2 })).toEqual(emptyWorkLog());
  });
});

describe("the reader's week and streaks", () => {
  const totals = new Map([
    ["2026-09-21", 3600], // pazartesi
    ["2026-09-22", 2 * 3600],
    ["2026-09-23", 30], // bir dakikadan az: çalışılan gün sayılmıyor
    ["2026-09-25", 5 * 3600],
    ["2026-09-26", 4 * 3600],
    ["2026-09-10", 1800],
  ]);

  it("adds up today, the week from its first day, the month, and the streaks", () => {
    const now = new Date(at("2026-09-27", "10:00")); // pazar, henüz çalışılmadı
    const summary = workSummary(totals, now, { weekStart: 1, goalMinutes: 240 });
    expect(summary.today).toBe(0);
    expect(summary.week).toBe(3600 + 7200 + 30 + 5 * 3600 + 4 * 3600);
    expect(summary.goalDaysThisWeek).toBe(2);
    expect(summary.currentStreak).toBe(2); // cuma ve cumartesi; bugün henüz bitmedi
    expect(summary.longestStreak).toBe(2);
    expect(summary.activeDays).toBe(5);
    expect(summary.best).toEqual({ day: "2026-09-25", seconds: 5 * 3600 });
    // Hafta pazardan başlıyorsa bu pazar yeni bir hafta.
    expect(workSummary(totals, now, { weekStart: 0, goalMinutes: 240 }).week).toBe(0);
  });

  it("colours a day by the share of the daily goal, the darkest when the goal is met", () => {
    expect([0, 59, 60, 60 * 60, 150 * 60, 240 * 60].map((seconds) => heatLevel(seconds, 240))).toEqual([0, 0, 1, 2, 3, 4]);
  });

  it("lays the calendar out in weeks, like a contribution graph", () => {
    const today = new Date(at("2026-09-27", "10:00"));
    const map = heatmap(totals, { from: new Date(2025, 8, 28), to: today, today, weekStart: 1, goalMinutes: 240 });
    expect(map.weeks.every((week) => week.length === 7)).toBe(true);
    expect(map.weeks.length).toBe(53);
    const cells = map.weeks.flat().filter((cell) => cell !== null);
    expect(cells[0]!.day).toBe("2025-09-28");
    expect(cells.at(-1)!.day).toBe("2026-09-27");
    expect(cells.find((cell) => cell!.day === "2026-09-25")!.level).toBe(4);
    expect(map.total).toBe([...totals.values()].reduce((sum, seconds) => sum + seconds, 0));
    expect(map.activeDays).toBe(5);
    expect(map.months.map((month) => month.label).slice(0, 3)).toEqual(["Sep", "Oct", "Nov"]);
    // Bir yıl: ocaktan aralığa; bugünden sonraki günler gelecek.
    const year = heatmap(totals, { from: new Date(2026, 0, 1), to: new Date(2026, 11, 31), today, weekStart: 1, goalMinutes: 240 });
    expect(year.weeks.flat().filter((cell) => cell?.future).length).toBe(95);
    expect(calendarYears(new Map([["2024-03-01", 60], ...totals]), today)).toEqual([2026, 2024]);
  });

  it("writes durations and the clock the way people read them", () => {
    expect([0, 30, 60, 45 * 60, 3600, 2 * 3600 + 15 * 60].map(formatDuration)).toEqual(["0m", "under a minute", "1m", "45m", "1h", "2h 15m"]);
    expect(formatClock(25 * 60_000)).toBe("25:00");
    expect(formatClock(400, "up")).toBe("00:01");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(dayKey(new Date(at("2026-09-20", "00:30")))).toBe("2026-09-20");
  });
});

describe("time in review", () => {
  const MIN = 60_000;
  const T0 = Date.parse("2026-09-28T09:00:00.000Z");
  let ids = 0;
  const newId = () => `review-${(ids += 1)}`;

  it("grows one session card by card, counts at most five minutes a card, and starts again after a gap", () => {
    let block = extendReviewBlock(undefined, T0, T0 + 2 * MIN, newId);
    block = extendReviewBlock(block, T0 + 2 * MIN, T0 + 3 * MIN, newId);
    expect(block).toEqual({ id: "review-1", start: T0, end: T0 + 3 * MIN });
    // Kart açık bırakılıp gidildi: beş dakikası sayılıyor, sonraki kart yeni oturum.
    block = extendReviewBlock(block, T0 + 3 * MIN, T0 + 40 * MIN, newId);
    expect(block).toEqual({ id: "review-1", start: T0, end: T0 + 3 * MIN + REVIEW_CARD_CAP_MS });
    block = extendReviewBlock(block, T0 + 40 * MIN, T0 + 41 * MIN, newId);
    expect(block).toEqual({ id: "review-2", start: T0 + 40 * MIN, end: T0 + 41 * MIN });
    expect(extendReviewBlock(block, T0 + 41 * MIN, T0 + 41 * MIN, newId)).toBe(block);
  });

  it("keeps review time as its own kind of session, counted once with a focus round beside it", () => {
    const review = sessionPieces({ kind: "review", id: "review-1", projectId: "attention" }, T0, T0 + 10 * MIN);
    expect(workLogSchema.safeParse({ ...emptyWorkLog(), sessions: review }).success).toBe(true);
    const focus = sessionPieces({ kind: "focus", projectId: "attention" }, T0 - 5 * MIN, T0 + 5 * MIN);
    expect(timeByProject([...focus, ...review]).get("attention")).toBe(15 * 60);
    // Oturum büyüdükçe aynı kimlikle yeniden yazılıyor; kayıtta bir tane kalıyor.
    const longer = sessionPieces({ kind: "review", id: "review-1", projectId: "attention" }, T0, T0 + 12 * MIN);
    expect(addSessions(addSessions(emptyWorkLog(), review), longer).sessions.map((item) => [item.id, item.end])).toEqual([["review-1", new Date(T0 + 12 * MIN).toISOString()]]);
  });

  it("keeps study time as its own kind, growing step by step when the cap is left to the Study path", () => {
    let block = extendReviewBlock(undefined, T0, T0 + 3 * MIN, newId, Number.POSITIVE_INFINITY);
    block = extendReviewBlock(block, T0 + 3 * MIN, T0 + 3 * MIN + STUDY_STEP_CAP_MS, newId, Number.POSITIVE_INFINITY);
    expect(block).toMatchObject({ start: T0, end: T0 + 3 * MIN + STUDY_STEP_CAP_MS });
    const study = sessionPieces({ kind: "study", id: block!.id, label: "Attention", projectId: "attention" }, block!.start, block!.end);
    expect(workLogSchema.safeParse({ ...emptyWorkLog(), sessions: study }).success).toBe(true);
    expect(SESSION_KIND_LABELS.study).toBe("Study");
    expect(timeByProject(study).get("attention")).toBe(23 * 60);
  });

  it("drops only a damaged session, or one of a kind a newer version knows, and reads the rest", () => {
    const good = sessionPieces({ kind: "focus" }, T0, T0 + 25 * MIN);
    const raw = { version: 1, sessions: [...good, { id: "x", start: new Date(T0).toISOString(), end: new Date(T0 + MIN).toISOString(), kind: "meditation" }, { id: "y" }], archive: { "2026-01-01": 600 } };
    expect(workLogSchema.safeParse(raw).success).toBe(false);
    expect(parseWorkLog(raw)).toEqual({ version: 1, sessions: good, archive: { "2026-01-01": 600 } });
    expect(parseWorkLog({ ...raw, archive: "broken" }).archive).toEqual({});
    expect(parseWorkLog({ version: 2, sessions: good })).toEqual(emptyWorkLog());
  });
});

describe("time by paper", () => {
  const paper = (id: string, day: string, from: string, to: string, projectId?: string): WorkSession => ({ ...session(id, day, from, to), ...(projectId ? { projectId } : {}) });

  it("adds up each paper's sessions once, keeps unnamed work apart, and can be limited to a week", () => {
    const sessions = [
      paper("a", "2026-09-21", "09:00", "10:00", "attention"),
      paper("b", "2026-09-21", "09:30", "10:30", "attention"), // bir kronometre aynı makaleye aynı anda
      paper("c", "2026-09-22", "09:00", "09:25", "bert"),
      paper("d", "2026-09-28", "09:00", "09:45", "bert"),
      paper("e", "2026-09-22", "11:00", "11:10"),
    ];
    expect([...timeByProject(sessions)]).toEqual([["attention", 90 * 60], ["bert", 70 * 60], ["", 10 * 60]]);
    const week = timeByProject(sessions, { from: at("2026-09-28", "00:00") });
    expect([...week]).toEqual([["bert", 45 * 60]]);
    expect(sessionPieces({ kind: "focus", projectId: " attention " }, at("2026-09-21", "09:00"), at("2026-09-21", "09:25"))[0].projectId).toBe("attention");
  });

  it("tells an agent the reader's work time, by paper", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const english = loadExampleProject("attention-is-all-you-need.en.trace.json");
    const workspace = mkdtempSync(join(tmpdir(), "trace-work-"));
    try {
      mkdirSync(join(workspace, "library"), { recursive: true });
      writeFileSync(join(workspace, "library", "english.trace.json"), JSON.stringify(english));
      const now = Date.now();
      const minutes = (from: number, to: number, projectId?: string, id = `s${from}`): WorkSession => ({ id, start: new Date(now - from * 60_000).toISOString(), end: new Date(now - to * 60_000).toISOString(), kind: "focus", ...(projectId ? { projectId } : {}) });
      const log = addSessions(emptyWorkLog(), [minutes(50, 25, english.id), minutes(20, 10), minutes(40, 30, "gone"), minutes(7 * 1440 + 30, 7 * 1440 + 10, english.id)]);
      writeFileSync(join(workspace, "focus-log.json"), JSON.stringify(log));
      writeFileSync(join(workspace, "profile.json"), JSON.stringify({ version: 1, firstName: "Ada", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }));
      const run = spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), "work", "--days", "3"], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace } });
      expect(run.status).toBe(0);
      const report = JSON.parse(run.stdout) as { reader: string; timeZone: string; days: unknown[]; allTime: { seconds: number }; papers: { allTime: Array<{ paper: string; projectId: string | null; seconds: number }> } };
      expect(report).toMatchObject({ reader: "Ada", timeZone: "Europe/Istanbul" });
      expect(report.days).toHaveLength(3);
      expect(report.papers.allTime.map((item) => [item.projectId, item.seconds])).toEqual([[english.id, 45 * 60], [null, 10 * 60], ["gone", 10 * 60]]);
      // Geçen haftayla karşılaştırma ve günün saatleri (son dört hafta).
      const extra = JSON.parse(run.stdout) as { againstLastWeek: { days: unknown[]; change: { direction: string } }; hoursOfDay: { busiestHours: { from: string } | null; byHour: Array<{ minutes: number }> } };
      expect(extra.againstLastWeek.days).toHaveLength(7);
      expect(["more", "less", "same"]).toContain(extra.againstLastWeek.change.direction);
      expect(extra.hoursOfDay.busiestHours?.from).toMatch(/^\d{2}:00$/);
      expect(Math.abs(extra.hoursOfDay.byHour.reduce((sum, item) => sum + item.minutes, 0) - 55)).toBeLessThanOrEqual(2); // 25 + 10 + 20: iç içe oturum bir kez
      expect(report.papers.allTime[0].paper).toBe(english.evidence.paper.title);
      expect(report.papers.allTime[2].paper).toBe("A paper no longer in the library");
      expect(spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), "work", "--days", "0"], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace } }).status).toBe(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
