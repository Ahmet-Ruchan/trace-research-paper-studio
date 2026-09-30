import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dailyTotals, sessionPieces, type WorkSession } from "./work-log";
import { hourLevel, hourPattern, sameTimeDaysAgo, weekReport } from "./work-report";

/** Günler ve saatler yerel: testler sabit bir saat diliminde koşuyor. */
let zone: string | undefined;
beforeEach(() => {
  zone = process.env.TZ;
  process.env.TZ = "Europe/Istanbul";
});
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+03:00`);
let count = 0;
const session = (day: string, from: string, to: string, projectId?: string): WorkSession =>
  sessionPieces({ kind: "focus", id: `s${(count += 1)}`, ...(projectId ? { projectId } : {}) }, at(day, from), at(day, to))[0];

// 30 Eylül 2026 çarşamba, öğleden sonra üç. Hafta pazartesi başlıyor: bu hafta 28 Eylül, geçen hafta 21 Eylül.
const now = new Date(at("2026-09-30", "15:00"));

describe("the weekly report", () => {
  const sessions = [
    session("2026-09-21", "09:00", "11:00", "attention"), // geçen pazartesi
    session("2026-09-23", "10:00", "12:00", "bert"), // geçen çarşamba, bu saatten önce
    session("2026-09-23", "16:00", "18:00", "bert"), // geçen çarşamba, bu saatten sonra
    session("2026-09-25", "09:00", "10:00"), // geçen cuma
    session("2026-09-28", "09:00", "12:00", "attention"),
    session("2026-09-30", "13:00", "14:30", "attention"),
  ];
  const report = weekReport(sessions, dailyTotals({ sessions, archive: {} }), now, 1);

  it("sets this week against last week by the same moment, not against the whole of it", () => {
    expect(report.thisWeek).toMatchObject({ from: "2026-09-28", seconds: 4.5 * 3600 });
    expect(report.lastWeek).toMatchObject({ from: "2026-09-21", seconds: 7 * 3600, byNow: 4 * 3600 });
    expect(report.change).toBe(0.5 * 3600);
    expect(report.thisWeek.days.map((day) => day.seconds / 3600)).toEqual([3, 0, 1.5, 0, 0, 0, 0]);
    expect(report.lastWeek.days.map((day) => day.seconds / 3600)).toEqual([2, 0, 4, 0, 1, 0, 0]);
  });

  it("lists each paper with its time this week and last week, work without a paper apart", () => {
    expect(report.papers).toEqual([
      { projectId: "attention", thisWeek: 4.5 * 3600, lastWeek: 2 * 3600 },
      { projectId: "bert", thisWeek: 0, lastWeek: 4 * 3600 },
      { projectId: "", thisWeek: 0, lastWeek: 3600 },
    ]);
    expect(weekReport(sessions, new Map(), now, 0).thisWeek.from).toBe("2026-09-27");
  });

  it("keeps the same local time a week earlier", () => {
    expect(sameTimeDaysAgo(now, 7).getTime()).toBe(at("2026-09-23", "15:00"));
  });
});

describe("the hours of the day", () => {
  it("splits time at the hour on the reader's clock, by weekday, and finds the busiest three hours", () => {
    const sessions = [
      session("2026-09-28", "09:30", "11:15"), // pazartesi
      session("2026-09-29", "10:00", "11:00"), // salı
      session("2026-09-29", "10:30", "10:45"), // aynı anda çalışan ikinci sayaç: bir kez
      session("2026-09-27", "23:30", "23:59"), // pazar gecesi
    ];
    const pattern = hourPattern(sessions, { from: at("2026-09-01", "00:00"), to: at("2026-10-01", "00:00"), weekStart: 1 });
    expect(pattern.cells[0].slice(9, 12)).toEqual([1800, 3600, 900]);
    expect(pattern.cells[1][10]).toBe(3600);
    expect(pattern.cells[6][23]).toBe(29 * 60);
    expect(pattern.byDay).toEqual([6300, 3600, 0, 0, 0, 0, 1740]);
    expect(pattern.peak).toMatchObject({ from: 9, to: 12, seconds: 9900 });
    expect(pattern.total).toBe(11_640);
    // Pazar başlayan haftada pazar ilk satır.
    expect(hourPattern(sessions, { from: 0, to: at("2026-10-01", "00:00"), weekStart: 0 }).cells[0][23]).toBe(29 * 60);
    // Aralığın dışı sayılmıyor; hiç çalışılmadıysa en yoğun saat yok.
    expect(hourPattern(sessions, { from: at("2026-10-01", "00:00"), to: at("2026-10-08", "00:00"), weekStart: 1 })).toMatchObject({ total: 0, max: 0 });
    expect(hourPattern([], { from: 0, to: 1, weekStart: 1 }).peak).toBeUndefined();
  });

  it("shades an hour by its share of the busiest hour", () => {
    expect([0, 30, 900, 1800, 2700, 3600].map((seconds) => hourLevel(seconds, 3600))).toEqual([0, 0, 1, 2, 3, 4]);
    expect(hourLevel(100, 0)).toBe(0);
  });
});
