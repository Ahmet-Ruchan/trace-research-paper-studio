"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import type { ResearchProject } from "@/lib/schema";
import type { StudyProgress } from "@/lib/study-path";
import { cardsPerDay, hasWeeklyGoal, weeklyGoalProgress } from "@/lib/weekly-goals";
import { dailyTotals, dayDate, dayKey } from "@/lib/work-log";
import { hourLevel, hourPattern, PATTERN_WEEKS, weekReport } from "@/lib/work-report";
import { liveSessions, useFocus, useFocusClock } from "./focus-provider";

/**
 * Profilde haftalık rapor: bu hafta geçen haftanın aynı anına göre, gün gün
 * ve makale makale; altında son dört haftada günün hangi saatlerinde
 * çalışıldığı. Hesap `work-report.ts`'te. En üstte haftalık öğrenme hedefi
 * (`weekly-goals.ts`): bitirilen makaleler ve tekrar edilen kartlar.
 */

/** Haftalık raporda gösterilen en fazla tur notu. */
const MAX_WEEK_NOTES = 8;

type Words = Messages["focus"];

function hourName(hour: number, clock: "24h" | "12h", t: Words["weeklyReport"]) {
  if (clock === "24h") return `${hour}:00`;
  return t.hour12(hour % 12 || 12, !(hour < 12 || hour === 24));
}

function changeText(change: number, byNow: number, thisWeek: number, words: Words) {
  const t = words.weeklyReport;
  if (!thisWeek && !byNow) return t.nothingYet;
  if (!byNow) return t.lastNothing;
  if (Math.abs(change) < 60) return t.same;
  const percent = Math.round((Math.abs(change) / byNow) * 100);
  return t.change(words.duration(Math.abs(change)), change > 0, percent);
}

function GoalRow({ label, done, goal, note }: { label: string; done: number; goal: number; note?: string }) {
  const t = useT().focus.weeklyReport;
  const met = goal > 0 && done >= goal;
  return (
    <div className={`week-goal${met ? " is-met" : ""}`}>
      <span>{label}</span>
      <strong>
        {goal ? t.goalOf(done, goal) : done}
        {met ? <Check size={18} aria-label={t.goalMet} /> : null}
      </strong>
      {goal ? (
        <span className="week-goal-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(done, goal)} aria-valuetext={t.goalValue(done, goal, met)}>
          <i style={{ width: `${Math.min(100, (done / goal) * 100)}%` }} />
        </span>
      ) : null}
      <small>{note ?? (goal ? "" : t.noGoal)}</small>
    </div>
  );
}

function WeekGoals({ study, now, weekStart, goals }: { study: ReadonlyMap<string, StudyProgress>; now: Date; weekStart: 0 | 1; goals: Parameters<typeof weeklyGoalProgress>[1] }) {
  const t = useT().focus.weeklyReport;
  const progress = weeklyGoalProgress(study, goals, now, weekStart);
  const pace = cardsPerDay(progress);
  const met = hasWeeklyGoal(goals) && progress.papers.done >= goals.papers && progress.cards.done >= goals.cards;
  const note = !hasWeeklyGoal(goals) ? t.goalNone : met ? t.goalReached : pace ? t.pace(pace.left, progress.daysLeft, pace.perDay) : t.daysLeft(progress.daysLeft);
  return (
    <div className="week-goals" role="group" aria-label={t.learning}>
      <h3>{t.learning}</h3>
      <div className="week-goal-rows">
        <GoalRow label={t.papersFinished} done={progress.papers.done} goal={goals.papers} />
        <GoalRow label={t.cardsReviewed} done={progress.cards.done} goal={goals.cards} note={progress.cards.done ? t.remembered(progress.cards.remembered) : undefined} />
      </div>
      <p className="focus-note">{note}</p>
    </div>
  );
}

export function WeeklyReport({ projects, study, onOpen }: { projects: ResearchProject[]; study?: ReadonlyMap<string, StudyProgress>; onOpen: (project: ResearchProject) => void }) {
  const { common, focus: words } = useT();
  const t = words.weeklyReport;
  const duration = words.duration;
  const { log, profile, store, liveIntervals } = useFocus();
  const now = useFocusClock();
  const { weekStart, clock } = profile.preferences;
  // Gün adları, tarih ve saat arayüzün dilinde.
  const { weekday, longWeekday, shortDate, clockFormat } = useMemo(
    () => ({
      weekday: new Intl.DateTimeFormat(common.locale, { weekday: "short" }),
      longWeekday: new Intl.DateTimeFormat(common.locale, { weekday: "long" }),
      shortDate: new Intl.DateTimeFormat(common.locale, { day: "numeric", month: "short" }),
      clockFormat: new Intl.DateTimeFormat(common.locale, { hour: "numeric", minute: "2-digit", hour12: clock === "12h" }),
    }),
    [clock, common.locale],
  );
  const data = useMemo(() => {
    if (!now) return undefined;
    const sessions = [...log.sessions, ...liveSessions(store, profile, now)];
    const today = new Date(now);
    const report = weekReport(sessions, dailyTotals(log, liveIntervals(now)), today, weekStart);
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1 - PATTERN_WEEKS * 7).getTime();
    // Bu haftanın tur notları, en yenisi önce.
    const weekFrom = dayDate(report.thisWeek.from).getTime();
    const notes = log.sessions.filter((session) => session.note && Date.parse(session.end) >= weekFrom).reverse().slice(0, MAX_WEEK_NOTES);
    return { report, pattern: hourPattern(sessions, { from, to, weekStart }), today, notes };
  }, [log, liveIntervals, now, profile, store, weekStart]);
  if (!data) return null;
  const { report, pattern, today, notes } = data;
  const byId = new Map(projects.map((project) => [project.id, project]));
  const todayKey = dayKey(today);
  const most = Math.max(3600, ...report.thisWeek.days.map((day) => day.seconds), ...report.lastWeek.days.map((day) => day.seconds));
  const papers = report.papers.filter((row) => row.thisWeek >= 60 || row.lastWeek >= 60);
  const named = papers.filter((row) => row.projectId && byId.has(row.projectId)).slice(0, 6);
  const other = papers.filter((row) => !row.projectId || !byId.has(row.projectId)).reduce((sum, row) => ({ thisWeek: sum.thisWeek + row.thisWeek, lastWeek: sum.lastWeek + row.lastWeek }), { thisWeek: 0, lastWeek: 0 });
  const dayNames = Array.from({ length: 7 }, (_, index) => dayDate(report.thisWeek.days[index].day));
  const peak = pattern.peak;
  const busiest = pattern.total ? pattern.byDay.indexOf(Math.max(...pattern.byDay)) : -1;
  const summary = peak
    ? t.pattern(PATTERN_WEEKS, Math.round(peak.share * 100), hourName(peak.from, clock, t), hourName(peak.to, clock, t), longWeekday.format(dayNames[busiest]))
    : t.patternEmpty(PATTERN_WEEKS);

  return (
    <section className="stats-block profile-week" aria-label={t.region}>
      <h2>{t.heading}</h2>
      {study ? <WeekGoals study={study} now={today} weekStart={weekStart} goals={profile.preferences.weeklyGoals} /> : null}
      <div className="week-report">
        <div>
          <div className="week-figures">
            <div>
              <span>{t.thisWeek}</span>
              <strong>{duration(report.thisWeek.seconds)}</strong>
              <small>{t.since(shortDate.format(dayDate(report.thisWeek.from)))}</small>
            </div>
            <div className="is-last">
              <span>{t.lastWeek}</span>
              <strong>{duration(report.lastWeek.seconds)}</strong>
              <small>{t.byNow(duration(report.lastWeek.byNow))}</small>
            </div>
          </div>
          <p className={`week-change${report.change >= 60 ? " is-up" : report.change <= -60 ? " is-down" : ""}`}>{changeText(report.change, report.lastWeek.byNow, report.thisWeek.seconds, words)}</p>
          <ul className="week-bars" aria-label={t.days}>
            {report.thisWeek.days.map((day, index) => {
              const last = report.lastWeek.days[index];
              const future = day.day > todayKey;
              const name = weekday.format(dayNames[index]);
              return (
                <li key={day.day} className={day.day === todayKey ? "is-today" : ""} aria-label={t.dayLabel(name, future ? undefined : duration(day.seconds), duration(last.seconds))}>
                  <span className="week-bar-pair" aria-hidden="true">
                    <i className="is-this" style={{ height: future ? 0 : `${Math.max(day.seconds ? 3 : 0, (day.seconds / most) * 100)}%` }} />
                    <i className="is-last" style={{ height: `${Math.max(last.seconds ? 3 : 0, (last.seconds / most) * 100)}%` }} />
                  </span>
                  <small aria-hidden="true">{name}</small>
                </li>
              );
            })}
          </ul>
          <p className="week-legend" aria-hidden="true"><i className="is-this" /> {t.thisWeek} <i className="is-last" /> {t.lastWeek}</p>
        </div>
        <div className="week-papers">
          <h3>{t.byPaper}</h3>
          {named.length || other.thisWeek || other.lastWeek ? (
            <table>
              <thead>
                <tr><th scope="col">{t.paper}</th><th scope="col">{t.thisWeek}</th><th scope="col">{t.lastWeek}</th></tr>
              </thead>
              <tbody>
                {named.map((row) => {
                  const project = byId.get(row.projectId)!;
                  return (
                    <tr key={row.projectId}>
                      <th scope="row"><button type="button" onClick={() => onOpen(project)} title={project.evidence.paper.title}>{project.evidence.paper.title}</button></th>
                      <td>{row.thisWeek >= 60 ? duration(row.thisWeek) : "—"}</td>
                      <td>{row.lastWeek >= 60 ? duration(row.lastWeek) : "—"}</td>
                    </tr>
                  );
                })}
                {other.thisWeek >= 60 || other.lastWeek >= 60 ? (
                  <tr className="is-other">
                    <th scope="row">{t.otherWork}</th>
                    <td>{other.thisWeek >= 60 ? duration(other.thisWeek) : "—"}</td>
                    <td>{other.lastWeek >= 60 ? duration(other.lastWeek) : "—"}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <p className="focus-note">{t.papersEmpty}</p>
          )}
          {notes.length ? (
            <div className="week-notes">
              <h3>{t.whatYouDid}</h3>
              <ul aria-label={t.notes}>
                {notes.map((session) => {
                  const paper = session.projectId ? byId.get(session.projectId)?.evidence.paper.title : undefined;
                  return (
                    <li key={session.id}>
                      <small>{weekday.format(new Date(session.start))} {clockFormat.format(new Date(session.end))}{paper ? ` · ${paper}` : session.label ? ` · ${session.label}` : ""}</small>
                      <span>{session.note}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="hour-pattern">
        <h3>{t.whenYouWork}</h3>
        <div
          className="hour-grid"
          role="img"
          aria-label={t.gridLabel(summary)}
        >
          {pattern.cells.map((row, index) => (
            <div key={index} className="hour-row">
              <span className="hour-day">{weekday.format(dayNames[index])}</span>
              {row.map((seconds, hour) => (
                <i
                  key={hour}
                  className={`work-cell level-${hourLevel(seconds, pattern.max)}`}
                  title={`${longWeekday.format(dayNames[index])}, ${hourName(hour, clock, t)}–${hourName(hour + 1, clock, t)}: ${duration(seconds)}`}
                />
              ))}
            </div>
          ))}
          <div className="hour-row hour-axis" aria-hidden="true">
            <span />
            {Array.from({ length: 24 }, (_, hour) => <small key={hour}>{hour % 6 === 0 ? hourName(hour, clock, t).replace(":00", "") : ""}</small>)}
          </div>
        </div>
        <p className="focus-note">{summary}</p>
      </div>
    </section>
  );
}
