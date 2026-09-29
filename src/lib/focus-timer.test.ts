import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  advanceCountdown,
  advanceFocus,
  advanceStopwatch,
  countdownRemaining,
  dueAlarms,
  elapsedOf,
  extendCountdown,
  focusRemaining,
  focusRound,
  lapStopwatch,
  lapTimes,
  nextAlarm,
  pauseCountdown,
  pauseFocus,
  pauseStopwatch,
  resumeFocus,
  skipFocus,
  STALE_MS,
  startCountdown,
  startFocus,
  startStopwatch,
  stopFocus,
} from "./focus-timer";
import { alarmSchema, focusSettingsSchema, type FocusSettings } from "./profile";

const MIN = 60_000;
const T0 = Date.parse("2026-09-27T07:00:00.000Z");
const settings = (patch: Partial<FocusSettings> = {}) => focusSettingsSchema.parse({ work: 25, shortBreak: 5, longBreak: 15, longEvery: 2, ...patch });

describe("focus cycles", () => {
  it("runs work and breaks back to back, each ending at its real end, with a long break every few rounds", () => {
    const run = startFocus(settings(), T0, "Chapter 3");
    // Sekme arka planda: bir sonraki bakış 71 dakika sonra (tarayıcı yavaşlattı ama sayfa canlıydı).
    const later = T0 + 71 * MIN;
    const step = advanceFocus(run, settings(), later, later - 30_000);
    expect(step.events.map((event) => (event.type === "phase-end" ? [event.from, event.to, (event.at - T0) / MIN] : event.type))).toEqual([
      ["work", "short", 25],
      ["short", "work", 30],
      ["work", "long", 55],
      ["long", "work", 70],
    ]);
    expect(step.segments.map((segment) => [(segment.start - T0) / MIN, (segment.end - T0) / MIN, segment.label])).toEqual([
      [0, 25, "Chapter 3"],
      [30, 55, "Chapter 3"],
    ]);
    expect(step.run).toMatchObject({ phase: "work", completed: 2 });
    expect(focusRound(step.run)).toBe(3);
    expect(focusRemaining(step.run, later)).toBe(24 * MIN);
  });

  it("waits between phases when automatic start is off, and stops after the rounds asked for", () => {
    const manual = settings({ autoStartBreaks: false, autoStartWork: false });
    const first = advanceFocus(startFocus(manual, T0), manual, T0 + 26 * MIN, T0 + 26 * MIN);
    expect(first.run).toMatchObject({ phase: "short", waiting: true });
    expect(first.run.clock.running).toBe(false);
    const resumed = resumeFocus(first.run, T0 + 40 * MIN);
    expect(focusRemaining(resumed, T0 + 41 * MIN)).toBe(4 * MIN);

    const two = settings({ rounds: 2 });
    const done = advanceFocus(startFocus(two, T0), two, T0 + 3 * 60 * MIN, T0 + 3 * 60 * MIN);
    expect(done.run).toMatchObject({ finished: true, completed: 2 });
    expect(done.events.at(-1)).toMatchObject({ to: "done", at: T0 + 55 * MIN });
    expect(done.segments).toHaveLength(2);
  });

  it("counts nothing while the page was closed: it pauses at the last moment the page was alive", () => {
    const run = startFocus(settings(), T0);
    // Sayfa 10. dakikada kapandı, 3 saat sonra açıldı.
    const back = advanceFocus(run, settings(), T0 + 180 * MIN, T0 + 10 * MIN);
    expect(back.segments.map((segment) => (segment.end - segment.start) / MIN)).toEqual([10]);
    expect(back.events).toEqual([{ type: "interrupted", at: T0 + 10 * MIN, timer: "focus" }]);
    expect(back.run.clock.running).toBe(false);
    expect(focusRemaining(back.run, T0 + 180 * MIN)).toBe(15 * MIN);
    // Kapanmadan önce biten tur yine tam kaydediliyor.
    const closedLate = advanceFocus(run, settings(), T0 + 180 * MIN, T0 + 27 * MIN);
    expect(closedLate.segments.map((segment) => (segment.end - segment.start) / MIN)).toEqual([25]);
    expect(closedLate.run).toMatchObject({ phase: "short" });
    expect(closedLate.run.clock.running).toBe(false);
    expect(STALE_MS).toBeGreaterThan(MIN);
  });

  it("carries the paper a round is for into what it records", () => {
    const run = startFocus(settings(), T0, { label: " Attention ", projectId: "attention" });
    expect(pauseFocus(run, T0 + 5 * MIN).segments).toEqual([{ kind: "focus", start: T0, end: T0 + 5 * MIN, label: "Attention", projectId: "attention" }]);
    expect(pauseStopwatch(startStopwatch(T0, { projectId: "bert" }), T0 + MIN).segments[0]).toMatchObject({ kind: "stopwatch", projectId: "bert" });
    expect(startCountdown(MIN, T0, "Tea")).toMatchObject({ label: "Tea" });
  });

  it("records the worked part when paused, skipped or stopped, and never a break", () => {
    const run = startFocus(settings(), T0);
    const paused = pauseFocus(run, T0 + 12 * MIN);
    expect(paused.segments.map((segment) => (segment.end - segment.start) / MIN)).toEqual([12]);
    expect(pauseFocus(paused.run, T0 + 20 * MIN).segments).toEqual([]);
    const resumed = resumeFocus(paused.run, T0 + 20 * MIN);
    expect(focusRemaining(resumed, T0 + 20 * MIN)).toBe(13 * MIN);
    const skipped = skipFocus(resumed, settings(), T0 + 25 * MIN);
    expect(skipped.segments.map((segment) => (segment.end - segment.start) / MIN)).toEqual([5]);
    expect(skipped.run).toMatchObject({ phase: "short", completed: 0 });
    expect(skipped.run.clock.running).toBe(true);
    expect(stopFocus(skipped.run, T0 + 27 * MIN)).toEqual([]);
  });
});

describe("the countdown and the stopwatch", () => {
  it("ends a countdown at its real end, and can be given more time", () => {
    const run = startCountdown(10 * MIN, T0, "Tea");
    expect(countdownRemaining(run, T0 + 4 * MIN)).toBe(6 * MIN);
    const ended = advanceCountdown(run, T0 + 11 * MIN, T0 + 11 * MIN);
    expect(ended.events).toEqual([{ type: "countdown-end", at: T0 + 10 * MIN, label: "Tea" }]);
    expect(ended.segments.map((segment) => [segment.kind, (segment.end - segment.start) / MIN])).toEqual([["timer", 10]]);
    const more = extendCountdown(ended.run, MIN, T0 + 12 * MIN);
    expect(countdownRemaining(more, T0 + 12 * MIN)).toBe(MIN);
    expect(pauseCountdown(run, T0 + 2 * MIN).segments).toHaveLength(1);
  });

  it("keeps laps, and pauses a stopwatch left running in a closed page", () => {
    let run = startStopwatch(T0);
    run = lapStopwatch(run, T0 + 2 * MIN);
    run = lapStopwatch(run, T0 + 5 * MIN);
    expect(lapTimes(run)).toEqual([
      { lap: 1, split: 2 * MIN, total: 2 * MIN },
      { lap: 2, split: 3 * MIN, total: 5 * MIN },
    ]);
    const paused = pauseStopwatch(run, T0 + 6 * MIN);
    expect(elapsedOf(paused.run.clock, T0 + 99 * MIN)).toBe(6 * MIN);
    const abandoned = advanceStopwatch(run, T0 + 14 * 60 * MIN, T0 + 30 * MIN);
    expect(abandoned.segments.map((segment) => (segment.end - segment.start) / MIN)).toEqual([30]);
    expect(abandoned.run.clock.running).toBe(false);
    expect(advanceStopwatch(run, T0 + 30 * MIN, T0 + 29 * MIN).segments).toEqual([]);
  });
});

describe("alarms", () => {
  let zone: string | undefined;
  beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = "Europe/Istanbul";
  });
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });
  const alarm = (patch: object) => alarmSchema.parse({ id: "a", time: "07:30", ...patch });
  const local = (time: string, day = "2026-09-28") => Date.parse(`${day}T${time}:00+03:00`); // 28 Eylül 2026 pazartesi

  it("rings once when its minute passes, on the chosen days only", () => {
    const wake = alarm({ days: [1, 2, 3, 4, 5] });
    expect(dueAlarms([wake], local("07:29"), local("07:30"))).toEqual([{ alarm: wake, at: local("07:30") }]);
    expect(dueAlarms([wake], local("07:30"), local("07:31"))).toEqual([]);
    expect(dueAlarms([wake], local("07:29", "2026-09-27"), local("07:31", "2026-09-27"))).toEqual([]); // pazar
    expect(dueAlarms([{ ...wake, enabled: false }], local("07:29"), local("07:31"))).toEqual([]);
  });

  it("does not ring an alarm missed long ago, and says when it rings next", () => {
    const once = alarm({});
    expect(dueAlarms([once], local("06:00"), local("09:00"))).toEqual([]);
    expect(nextAlarm(once, local("08:00"))).toBe(local("07:30", "2026-09-29"));
    expect(nextAlarm(alarm({ days: [5] }), local("08:00"))).toBe(local("07:30", "2026-10-02"));
    const midnight = alarm({ time: "23:59" });
    expect(dueAlarms([midnight], local("23:58", "2026-09-27"), local("00:00"))).toEqual([{ alarm: midnight, at: local("23:59", "2026-09-27") }]);
  });
});
