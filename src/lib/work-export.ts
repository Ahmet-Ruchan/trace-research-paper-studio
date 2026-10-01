import { ACTIVE_DAY_SECONDS, addDaysLocal, dailyTotals, dayDate, dayKey, formatDuration, SESSION_KIND_LABELS, startOfWeek, type WorkLog, type WorkSession } from "./work-log";

/**
 * Çalışma kaydının dışarıya çıkan iki hâli.
 *
 * Takvim dosyası (.ics, RFC 5545): her oturum bir etkinlik; Google Takvim,
 * Apple Takvim ve Outlook içe aktarıyor. Kimlik oturumun kimliğinden, yani
 * aynı dosyayı iki kez içe aktarmak etkinlikleri çoğaltmıyor.
 *
 * Haftalık özet: yeni hafta başlayınca geçen haftanın tek paragraflık özeti
 * (stüdyo bunu bir kez, bildirim olarak gösteriyor).
 */

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Metin değerinde ters bölü, virgül, noktalı virgül ve satır sonu kaçıyor. */
const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Satırlar 75 baytta katlanıyor; çok baytlı bir karakter ortadan bölünmüyor. */
function fold(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  for (const character of line) {
    const limit = parts.length ? 74 : 75;
    if (encoder.encode(current + character).length > limit) {
      parts.push(current);
      current = character;
    } else current += character;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function sessionsIcs(sessions: readonly WorkSession[], options: { paperTitle?: (projectId: string) => string | undefined; now: Date }) {
  const created = stamp(new Date(Math.floor(options.now.getTime() / 1000) * 1000).toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trace//Research Paper Studio//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Trace work sessions"];
  for (const session of sessions) {
    const paper = session.projectId ? options.paperTitle?.(session.projectId) : undefined;
    const kind = SESSION_KIND_LABELS[session.kind];
    const name = session.label || paper || kind;
    const summary = name === kind ? kind : `${name} · ${kind}`;
    const details = [paper && paper !== name ? `Paper: ${paper}` : "", session.note ? `What I did: ${session.note}` : ""].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${session.id}@trace`,
      `DTSTAMP:${created}`,
      `DTSTART:${stamp(new Date(Math.floor(Date.parse(session.start) / 1000) * 1000).toISOString())}`,
      `DTEND:${stamp(new Date(Math.floor(Date.parse(session.end) / 1000) * 1000).toISOString())}`,
      `SUMMARY:${escapeText(summary)}`,
      ...(details ? [`DESCRIPTION:${escapeText(details)}`] : []),
      `CATEGORIES:${escapeText(kind)}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

export const sessionsIcsName = (now: Date) => `trace-work-${dayKey(now)}.ics`;

export type WeekSummary = {
  /** Geçen haftanın ilk günü ("YYYY-MM-DD"); özetin kimliği. */
  from: string;
  seconds: number;
  previous: number;
  daysWorked: number;
  best?: { day: string; seconds: number };
};

/** Biten son haftanın özeti; o hafta neredeyse hiç çalışılmadıysa yok. */
export function lastWeekSummary(log: WorkLog, now: Date, weekStart: 0 | 1): WeekSummary | undefined {
  const totals = dailyTotals(log);
  const thisWeek = startOfWeek(now, weekStart);
  const week = (from: Date) => Array.from({ length: 7 }, (_, index) => {
    const day = dayKey(addDaysLocal(from, index));
    return { day, seconds: totals.get(day) ?? 0 };
  });
  const last = week(addDaysLocal(thisWeek, -7));
  const before = week(addDaysLocal(thisWeek, -14));
  const seconds = last.reduce((sum, item) => sum + item.seconds, 0);
  if (seconds < ACTIVE_DAY_SECONDS) return undefined;
  const best = [...last].sort((left, right) => right.seconds - left.seconds)[0];
  return {
    from: last[0].day,
    seconds,
    previous: before.reduce((sum, item) => sum + item.seconds, 0),
    daysWorked: last.filter((item) => item.seconds >= ACTIVE_DAY_SECONDS).length,
    ...(best.seconds ? { best } : {}),
  };
}

/** Gün adı tarihin kendi (yerel) gününden; biçimleyici oluşturulduğu anın saat dilimine bağlı kalmıyor. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekSummaryText(summary: WeekSummary) {
  const change = summary.seconds - summary.previous;
  const compared = !summary.previous
    ? ""
    : Math.abs(change) < 15 * 60
      ? ", about the same as the week before"
      : `, ${formatDuration(Math.abs(change))} ${change > 0 ? "more" : "less"} than the week before`;
  const best = summary.best && summary.daysWorked > 1 ? ` Your best day was ${WEEKDAYS[dayDate(summary.best.day).getDay()]} (${formatDuration(summary.best.seconds)}).` : "";
  return `Last week you worked ${formatDuration(summary.seconds)} on ${summary.daysWorked} ${summary.daysWorked === 1 ? "day" : "days"}${compared}.${best}`;
}
