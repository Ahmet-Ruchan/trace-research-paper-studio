import { z } from "zod";
import { focusColorSchema } from "./focus-colors";

/**
 * Çalışılan zamanın kaydı.
 *
 * `~/.trace/focus-log.json` içinde, makinede. Her kayıt kesintisiz bir
 * çalışma aralığı: bir odak turu, duraklatılana kadar çalışan bir geri sayım
 * ya da kronometre, ya da okuyucunun elle eklediği bir süre. Aralık kaydetmek
 * (toplam değil) iki şeyi çözüyor:
 *
 * - Üst üste binen aralıklar bir kez sayılıyor. Odak turu ve kronometre aynı
 *   anda çalışabiliyor, iki sekme aynı turu kaydedebiliyor; gün toplamı
 *   aralıkların BİRLEŞİMİ, toplamı değil.
 * - Gece yarısını geçen bir tur iki güne bölünüyor; günler okuyucunun kendi
 *   saatine göre (`dayKey`).
 *
 * Hiçbir şey sessizce düşmüyor: kayıt çok büyürse en eski oturumlar günlük
 * toplamlarına katlanıp `archive`'a geçiyor, takvimde kalıyorlar.
 */

export const WORK_LOG_VERSION = 1;
export const MAX_SESSIONS = 20_000;
/** Tek kayıt en çok 12 saat; daha uzun bir aralık parçalara bölünüyor (`sessionPieces`). */
export const MAX_SESSION_SECONDS = 12 * 3600;
/** Bir gün en az bu kadar çalışılmışsa "çalışılan gün" (seri ve ortalama için). */
export const ACTIVE_DAY_SECONDS = 60;
export const SESSION_KINDS = ["focus", "timer", "stopwatch", "manual"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const instant = z.string().max(40).refine((value) => Number.isFinite(Date.parse(value)), "Not a date.");

export const workSessionSchema = z
  .object({
    id: z.string().min(1).max(80),
    start: instant,
    end: instant,
    kind: z.enum(SESSION_KINDS),
    label: z.string().trim().max(120).optional(),
    color: focusColorSchema.optional(),
  })
  .refine((session) => Date.parse(session.end) > Date.parse(session.start), "A session ends after it starts.")
  .refine((session) => Date.parse(session.end) - Date.parse(session.start) <= MAX_SESSION_SECONDS * 1000, "A session is at most 12 hours.");
export type WorkSession = z.infer<typeof workSessionSchema>;

export const workLogSchema = z.object({
  version: z.literal(WORK_LOG_VERSION),
  sessions: z.array(workSessionSchema).max(MAX_SESSIONS),
  /** Katlanan eski oturumların gün toplamları, saniye. */
  archive: z.record(z.string().regex(DAY_PATTERN), z.number().int().min(0).max(86_400)).default({}),
});
export type WorkLog = z.infer<typeof workLogSchema>;

export function emptyWorkLog(): WorkLog {
  return { version: WORK_LOG_VERSION, sessions: [], archive: {} };
}

export function isWorkLog(raw: unknown) {
  return workLogSchema.safeParse(raw).success;
}

export function parseWorkLog(raw: unknown): WorkLog {
  const parsed = workLogSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyWorkLog();
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Yerel gün, "YYYY-MM-DD". */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "YYYY-MM-DD" → o günün yerel gece yarısı. */
export function dayDate(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

export function addDaysLocal(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Bir çalışma aralığının kayıtları: 12 saati aşan aralık parçalara bölünüyor.
 * Kimlik aralığın başından türüyor; aynı aralığı iki kez kaydetmek tek kayıt.
 */
export function sessionPieces(
  base: { kind: SessionKind; label?: string; color?: WorkSession["color"]; id?: string },
  startMs: number,
  endMs: number,
): WorkSession[] {
  const pieces: WorkSession[] = [];
  const id = base.id ?? `${base.kind}-${Math.round(startMs)}`;
  for (let from = startMs, index = 0; from < endMs; from += MAX_SESSION_SECONDS * 1000, index += 1) {
    const to = Math.min(endMs, from + MAX_SESSION_SECONDS * 1000);
    if (to - from < 1000) break;
    pieces.push({
      id: index ? `${id}-${index}` : id,
      start: new Date(from).toISOString(),
      end: new Date(to).toISOString(),
      kind: base.kind,
      ...(base.label?.trim() ? { label: base.label.trim().slice(0, 120) } : {}),
      ...(base.color ? { color: base.color } : {}),
    });
  }
  return pieces;
}

/** Aralıkların birleşimi, başlangıca göre sıralı. */
export function mergedIntervals(intervals: ReadonlyArray<readonly [number, number]>) {
  const sorted = intervals.filter(([start, end]) => end > start).map(([start, end]) => [start, end] as [number, number]).sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

const intervalOf = (session: Pick<WorkSession, "start" | "end">) => [Date.parse(session.start), Date.parse(session.end)] as const;

/**
 * Günlük toplamlar (saniye), okuyucunun saatine göre. `live` henüz
 * kaydedilmemiş, şu an süren aralıklar: ekrandaki "bugün" canlı artıyor.
 */
export function dailyTotals(log: Pick<WorkLog, "sessions" | "archive">, live: ReadonlyArray<readonly [number, number]> = []) {
  const totals = new Map<string, number>();
  const add = (day: string, seconds: number) => totals.set(day, (totals.get(day) ?? 0) + seconds);
  for (const [start, end] of mergedIntervals([...log.sessions.map(intervalOf), ...live])) {
    let cursor = start;
    while (cursor < end) {
      const at = new Date(cursor);
      const midnight = addDaysLocal(at, 1).getTime();
      const stop = Math.min(end, midnight);
      add(dayKey(at), (stop - cursor) / 1000);
      cursor = stop;
    }
  }
  for (const [day, seconds] of Object.entries(log.archive ?? {})) add(day, seconds);
  for (const [day, seconds] of totals) totals.set(day, Math.min(86_400, Math.round(seconds)));
  return totals;
}

/**
 * Oturum ekler. Aynı kimlik bir kez: daha geç biteni kalıyor (yarım kalan bir
 * tur sonradan tamamı kaydedilirse). Sınır aşılırsa en eski oturumlar gün
 * toplamı olarak `archive`'a katlanıyor.
 */
export function addSessions(log: WorkLog, incoming: readonly WorkSession[]): WorkLog {
  const byId = new Map(log.sessions.map((session) => [session.id, session]));
  for (const session of incoming) {
    const existing = byId.get(session.id);
    if (!existing || Date.parse(session.end) > Date.parse(existing.end)) byId.set(session.id, session);
  }
  let sessions = [...byId.values()].sort((left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
  const archive = { ...log.archive };
  if (sessions.length > MAX_SESSIONS) {
    const folded = sessions.slice(0, sessions.length - MAX_SESSIONS);
    sessions = sessions.slice(-MAX_SESSIONS);
    for (const [day, seconds] of dailyTotals({ sessions: folded, archive: {} })) archive[day] = Math.min(86_400, (archive[day] ?? 0) + seconds);
  }
  return { version: WORK_LOG_VERSION, sessions, archive };
}

/** Dosya biçimi: her oturum kendi satırında; tek satırlık birkaç megabaytlık JSON elle açılınca okunmuyordu. */
export function workLogToJson(log: WorkLog) {
  const sessions = log.sessions.map((session) => JSON.stringify(session)).join(",\n");
  return `{"version":${log.version},"sessions":[${sessions ? `\n${sessions}\n` : ""}],"archive":${JSON.stringify(log.archive)}}\n`;
}

export function removeSession(log: WorkLog, id: string): WorkLog {
  return { ...log, sessions: log.sessions.filter((session) => session.id !== id) };
}

/** İçe aktarılan kayıt: oturumlar kimliğe göre birleşiyor; arşiv günlerinde büyük olan (aynı dosya iki kez yüklenirse ikiye katlanmasın). */
export function mergeWorkLogs(current: WorkLog, incoming: WorkLog): WorkLog {
  const merged = addSessions(current, incoming.sessions);
  const archive = { ...merged.archive };
  for (const [day, seconds] of Object.entries(incoming.archive ?? {})) archive[day] = Math.max(archive[day] ?? 0, seconds);
  return { ...merged, archive };
}

export type WorkSummary = {
  today: number;
  week: number;
  month: number;
  total: number;
  activeDays: number;
  /** Çalışılan gün başına ortalama, saniye. */
  average: number;
  best?: { day: string; seconds: number };
  currentStreak: number;
  longestStreak: number;
  /** Bu hafta hedefe ulaşılan gün sayısı. */
  goalDaysThisWeek: number;
};

export function startOfWeek(date: Date, weekStart: 0 | 1) {
  const offset = (date.getDay() - weekStart + 7) % 7;
  return addDaysLocal(date, -offset);
}

/** Günler üst üste: dünden bugüne mi. */
const nextDay = (day: string) => dayKey(addDaysLocal(dayDate(day), 1));

export function workSummary(totals: ReadonlyMap<string, number>, now: Date, options: { weekStart: 0 | 1; goalMinutes: number }): WorkSummary {
  const today = dayKey(now);
  const weekFrom = dayKey(startOfWeek(now, options.weekStart));
  const monthPrefix = today.slice(0, 8);
  let week = 0;
  let month = 0;
  let total = 0;
  let best: WorkSummary["best"];
  let goalDaysThisWeek = 0;
  for (const [day, seconds] of totals) {
    if (day > today) continue;
    total += seconds;
    if (day >= weekFrom) {
      week += seconds;
      if (seconds >= options.goalMinutes * 60) goalDaysThisWeek += 1;
    }
    if (day.startsWith(monthPrefix)) month += seconds;
    if (!best || seconds > best.seconds) best = { day, seconds };
  }
  const active = [...totals].filter(([day, seconds]) => day <= today && seconds >= ACTIVE_DAY_SECONDS).map(([day]) => day).sort();
  const activeSet = new Set(active);
  let longestStreak = 0;
  let run = 0;
  active.forEach((day, index) => {
    run = index && nextDay(active[index - 1]) === day ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  });
  // Bugün henüz çalışılmadıysa seri dünden sayılıyor: gün bitmeden seri kırılmış sayılmıyor.
  let cursor = activeSet.has(today) ? now : addDaysLocal(now, -1);
  let currentStreak = 0;
  while (activeSet.has(dayKey(cursor))) {
    currentStreak += 1;
    cursor = addDaysLocal(cursor, -1);
  }
  return {
    today: totals.get(today) ?? 0,
    week,
    month,
    total,
    activeDays: active.length,
    average: active.length ? Math.round(active.reduce((sum, day) => sum + (totals.get(day) ?? 0), 0) / active.length) : 0,
    ...(best && best.seconds > 0 ? { best } : {}),
    currentStreak,
    longestStreak,
    goalDaysThisWeek,
  };
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;
export type HeatCell = { day: string; seconds: number; level: HeatLevel; future: boolean };

/**
 * Takvimdeki ton, günlük hedefe göre: en koyu ton hedefe ulaşılan gün. Göreli
 * (en çok çalışılan güne göre) bir ölçek, iyi bir haftadan sonra her günü
 * soluk gösterirdi; hedef okuyucunun kendi ölçüsü.
 */
export function heatLevel(seconds: number, goalMinutes: number): HeatLevel {
  if (seconds < ACTIVE_DAY_SECONDS) return 0;
  const share = seconds / (Math.max(15, goalMinutes) * 60);
  return share >= 1 ? 4 : share >= 0.6 ? 3 : share >= 0.25 ? 2 : 1;
}

export type Heatmap = {
  /** Sütunlar haftalar, satırlar günler (haftanın ilk gününden). Aralık dışı günler `null`. */
  weeks: Array<Array<HeatCell | null>>;
  /** Ayın ilk gününü içeren haftanın sütununda ayın adı. */
  months: Array<{ week: number; label: string }>;
  total: number;
  activeDays: number;
};

const monthFormat = new Intl.DateTimeFormat("en", { month: "short" });

export function heatmap(totals: ReadonlyMap<string, number>, options: { from: Date; to: Date; today: Date; weekStart: 0 | 1; goalMinutes: number }): Heatmap {
  const from = dayKey(options.from);
  const to = dayKey(options.to);
  const today = dayKey(options.today);
  const weeks: Heatmap["weeks"] = [];
  const months: Heatmap["months"] = [];
  let total = 0;
  let activeDays = 0;
  for (let cursor = startOfWeek(options.from, options.weekStart); dayKey(cursor) <= to; ) {
    const column: Array<HeatCell | null> = [];
    for (let row = 0; row < 7; row += 1, cursor = addDaysLocal(cursor, 1)) {
      const day = dayKey(cursor);
      if (day < from || day > to) {
        column.push(null);
        continue;
      }
      const seconds = day > today ? 0 : totals.get(day) ?? 0;
      total += seconds;
      if (seconds >= ACTIVE_DAY_SECONDS) activeDays += 1;
      column.push({ day, seconds, level: heatLevel(seconds, options.goalMinutes), future: day > today });
      if (cursor.getDate() === 1) months.push({ week: weeks.length, label: monthFormat.format(cursor) });
    }
    weeks.push(column);
  }
  // İlk sütun başlangıç ayının adını alıyor; bir sonraki ay üç haftadan yakınsa adlar üst üste binerdi.
  if (!months.length || months[0].week >= 3) months.unshift({ week: 0, label: monthFormat.format(options.from) });
  return { weeks, months, total, activeDays };
}

/** Takvimin seçilebilen aralıkları: son 12 ay ve kayıtta çalışma olan her yıl. */
export function calendarYears(totals: ReadonlyMap<string, number>, now: Date) {
  const years = new Set<number>([now.getFullYear()]);
  for (const [day, seconds] of totals) if (seconds > 0) years.add(Number(day.slice(0, 4)));
  return [...years].filter((year) => year <= now.getFullYear()).sort((left, right) => right - left);
}

/** "2h 15m", "45m", "under a minute". */
export function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole > 0 && whole < 60) return "under a minute";
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Zamanlayıcının göstergesi: "25:00", "1:02:03". Geri sayımda saniye yukarı yuvarlanıyor: 0,4 s kala "0:01". */
export function formatClock(ms: number, round: "up" | "down" = "down") {
  const total = Math.max(0, round === "up" ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
