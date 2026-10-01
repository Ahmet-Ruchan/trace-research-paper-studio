import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSessions, emptyWorkLog, sessionPieces } from "./work-log";
import { lastWeekSummary, sessionsIcs, sessionsIcsName, weekSummaryText } from "./work-export";

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

const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+03:00`);
const piece = (kind: "focus" | "review" | "manual", day: string, from: string, to: string, extra: { label?: string; projectId?: string } = {}) => sessionPieces({ kind, ...extra }, at(day, from), at(day, to))[0];

describe("the calendar file", () => {
  it("writes one event per session, in UTC, with the paper, the kind and the round's note", () => {
    const focus = { ...piece("focus", "2026-09-28", "09:00", "09:25", { projectId: "attention" }), note: "Read section 3; the scaling, finally." };
    const review = piece("review", "2026-09-28", "10:00", "10:12");
    const manual = piece("manual", "2026-09-29", "14:00", "15:30", { label: "Seminar prep" });
    const ics = sessionsIcs([focus, review, manual], { paperTitle: (id) => (id === "attention" ? "Attention Is All You Need" : undefined), now: new Date("2026-09-30T08:00:00.000Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain(`UID:${focus.id}@trace\r\nDTSTAMP:20260930T080000Z\r\nDTSTART:20260928T060000Z\r\nDTEND:20260928T062500Z`);
    expect(ics).toContain("SUMMARY:Attention Is All You Need · Focus");
    expect(ics).toContain("DESCRIPTION:What I did: Read section 3\; the scaling\\, finally.");
    expect(ics).toContain("SUMMARY:Review\r\n");
    expect(ics).toContain("SUMMARY:Seminar prep · Added by hand");
    // Uzun satır 75 baytta katlanıyor.
    const long = sessionsIcs([{ ...manual, label: "ç".repeat(100) }], { now: new Date() });
    expect(long.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(long).toContain("\r\n ç");
    expect(sessionsIcsName(new Date("2026-09-30T10:00:00+03:00"))).toBe("trace-work-2026-09-30.ics");
  });
});

describe("the weekly summary", () => {
  it("sums up the week that ended, against the week before, with its best day", () => {
    const log = addSessions(emptyWorkLog(), [
      piece("focus", "2026-09-14", "09:00", "11:00"),
      piece("focus", "2026-09-21", "09:00", "12:00"),
      piece("focus", "2026-09-23", "14:00", "15:30"),
      piece("focus", "2026-09-30", "09:00", "10:00"),
    ]);
    const now = new Date(at("2026-09-30", "18:00"));
    const summary = lastWeekSummary(log, now, 1)!;
    expect(summary).toEqual({ from: "2026-09-21", seconds: 4.5 * 3600, previous: 2 * 3600, daysWorked: 2, best: { day: "2026-09-21", seconds: 3 * 3600 } });
    expect(weekSummaryText(summary)).toBe("Last week you worked 4h 30m on 2 days, 2h 30m more than the week before. Your best day was Monday (3h).");
    // Pazar başlayan hafta başka bir hafta.
    expect(lastWeekSummary(log, now, 0)!.from).toBe("2026-09-20");
    expect(lastWeekSummary(emptyWorkLog(), now, 1)).toBeUndefined();
    expect(weekSummaryText({ from: "2026-09-21", seconds: 3600, previous: 0, daysWorked: 1, best: { day: "2026-09-21", seconds: 3600 } })).toBe("Last week you worked 1h on 1 day.");
    expect(weekSummaryText({ from: "2026-09-21", seconds: 3600, previous: 3000, daysWorked: 1 })).toBe("Last week you worked 1h on 1 day, about the same as the week before.");
  });
});
