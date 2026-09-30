import { addDaysLocal, dayKey, mergedIntervals, startOfWeek, timeByProject, type WorkSession } from "./work-log";

/**
 * Haftalık rapor: bu hafta geçen haftayla, makale makale, ve günün hangi
 * saatlerinde çalışıldığı. Hepsi okuyucunun kendi kaydından, aralıkların
 * birleşimiyle: iki sayaç aynı anda çalıştıysa o süre bir kez sayılıyor.
 *
 * Bu hafta, geçen haftanın TAMAMIYLA değil aynı anına kadarki kısmıyla
 * karşılaştırılıyor: salı öğleden sonra "geçen haftadan 20 saat az" demek
 * haftanın yarısının henüz gelmediğini unutmak olurdu.
 */

type Span = Pick<WorkSession, "start" | "end" | "projectId">;
export type WeekDay = { day: string; seconds: number };
export type WeekReport = {
  thisWeek: { from: string; seconds: number; days: WeekDay[] };
  lastWeek: { from: string; seconds: number; days: WeekDay[]; byNow: number };
  /** Bu hafta eksi geçen haftanın aynı anına kadarki süresi, saniye. */
  change: number;
  /** Makale başına bu hafta ve geçen hafta; bağlanmamış çalışma `projectId: ""`. */
  papers: Array<{ projectId: string; thisWeek: number; lastWeek: number }>;
};

/** Aynı yerel saat, `days` gün önce (yaz saati geçişinde de saat aynı kalıyor). */
export function sameTimeDaysAgo(now: Date, days: number) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
}

function secondsWithin(intervals: ReadonlyArray<readonly [number, number]>, from: number, to: number) {
  let total = 0;
  for (const [start, end] of intervals) total += Math.max(0, Math.min(end, to) - Math.max(start, from));
  return Math.round(total / 1000);
}

const intervalsOf = (sessions: readonly Span[]) => mergedIntervals(sessions.map((session) => [Date.parse(session.start), Date.parse(session.end)] as const));

/**
 * `totals` gün toplamları (`dailyTotals`, arşiv ve süren sayaçlar dahil);
 * `sessions` makale ve "bu saate kadar" için aralıklar (süren sayaçlar dahil).
 */
export function weekReport(sessions: readonly Span[], totals: ReadonlyMap<string, number>, now: Date, weekStart: 0 | 1): WeekReport {
  const thisFrom = startOfWeek(now, weekStart);
  const lastFrom = addDaysLocal(thisFrom, -7);
  const week = (from: Date) => Array.from({ length: 7 }, (_, index) => {
    const day = dayKey(addDaysLocal(from, index));
    return { day, seconds: totals.get(day) ?? 0 };
  });
  const thisDays = week(thisFrom);
  const lastDays = week(lastFrom);
  const today = dayKey(now);
  const thisSeconds = thisDays.filter((item) => item.day <= today).reduce((sum, item) => sum + item.seconds, 0);
  const lastSeconds = lastDays.reduce((sum, item) => sum + item.seconds, 0);
  const byNow = secondsWithin(intervalsOf(sessions), lastFrom.getTime(), sameTimeDaysAgo(now, 7).getTime());

  const range = (from: Date) => ({ from: from.getTime(), to: addDaysLocal(from, 7).getTime() });
  const current = timeByProject(sessions, range(thisFrom));
  const previous = timeByProject(sessions, range(lastFrom));
  const papers = [...new Set([...current.keys(), ...previous.keys()])]
    .map((projectId) => ({ projectId, thisWeek: current.get(projectId) ?? 0, lastWeek: previous.get(projectId) ?? 0 }))
    .sort((left, right) => right.thisWeek - left.thisWeek || right.lastWeek - left.lastWeek || left.projectId.localeCompare(right.projectId));

  return {
    thisWeek: { from: dayKey(thisFrom), seconds: thisSeconds, days: thisDays },
    lastWeek: { from: dayKey(lastFrom), seconds: lastSeconds, days: lastDays, byNow },
    change: thisSeconds - byNow,
    papers,
  };
}

export type HourPattern = {
  /** 7 satır (haftanın ilk gününden) × 24 saat, saniye. */
  cells: number[][];
  /** Saat başına toplam, 24 değer. */
  byHour: number[];
  /** Haftanın günü başına toplam, 7 değer. */
  byDay: number[];
  total: number;
  max: number;
  /** En çok çalışılan art arda üç saat (gece yarısını aşmadan). */
  peak?: { from: number; to: number; seconds: number; share: number };
};

export const PATTERN_WEEKS = 4;
const HOUR_MS = 3_600_000;

/** Günün saatlerine dağılım: aralıklar yerel saat sınırlarında bölünüyor. */
export function hourPattern(sessions: readonly Span[], options: { from: number; to: number; weekStart: 0 | 1 }): HourPattern {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const [start, end] of intervalsOf(sessions)) {
    let cursor = Math.max(start, options.from);
    const stop = Math.min(end, options.to);
    while (cursor < stop) {
      const moment = new Date(cursor);
      const nextHour = new Date(moment.getFullYear(), moment.getMonth(), moment.getDate(), moment.getHours() + 1).getTime();
      const until = Math.min(stop, nextHour > cursor ? nextHour : cursor + HOUR_MS);
      cells[(moment.getDay() - options.weekStart + 7) % 7][moment.getHours()] += (until - cursor) / 1000;
      cursor = until;
    }
  }
  const rounded = cells.map((row) => row.map((seconds) => Math.round(seconds)));
  const byHour = Array.from({ length: 24 }, (_, hour) => rounded.reduce((sum, row) => sum + row[hour], 0));
  const byDay = rounded.map((row) => row.reduce((sum, seconds) => sum + seconds, 0));
  const total = byDay.reduce((sum, seconds) => sum + seconds, 0);
  let peak: HourPattern["peak"];
  if (total >= 60) {
    for (let hour = 0; hour <= 21; hour += 1) {
      const seconds = byHour[hour] + byHour[hour + 1] + byHour[hour + 2];
      if (!peak || seconds > peak.seconds) peak = { from: hour, to: hour + 3, seconds, share: seconds / total };
    }
  }
  return { cells: rounded, byHour, byDay, total, max: Math.max(0, ...rounded.flat()), ...(peak ? { peak } : {}) };
}

/** Saat ısısı: en yoğun saate göre dört ton (takvimdeki gibi hedefe göre değil; saatin hedefi yok). */
export function hourLevel(seconds: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (seconds < 60 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((seconds / max) * 4))) as 1 | 2 | 3 | 4;
}
