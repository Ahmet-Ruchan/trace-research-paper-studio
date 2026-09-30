"use client";

import { useMemo } from "react";
import type { ResearchProject } from "@/lib/schema";
import { dailyTotals, dayDate, dayKey, formatDuration } from "@/lib/work-log";
import { hourLevel, hourPattern, PATTERN_WEEKS, weekReport } from "@/lib/work-report";
import { liveSessions, useFocus, useFocusClock } from "./focus-provider";

/**
 * Profilde haftalık rapor: bu hafta geçen haftanın aynı anına göre, gün gün
 * ve makale makale; altında son dört haftada günün hangi saatlerinde
 * çalışıldığı. Hesap `work-report.ts`'te.
 */

const weekday = new Intl.DateTimeFormat("en", { weekday: "short" });
const longWeekday = new Intl.DateTimeFormat("en", { weekday: "long" });
const shortDate = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

function hourName(hour: number, clock: "24h" | "12h") {
  if (clock === "24h") return `${hour}:00`;
  const shown = hour % 12 || 12;
  return `${shown} ${hour < 12 || hour === 24 ? "am" : "pm"}`;
}

function changeText(change: number, byNow: number, thisWeek: number) {
  if (!thisWeek && !byNow) return "Nothing recorded this week or by this time last week yet.";
  if (!byNow) return "Last week had nothing recorded by this time.";
  if (Math.abs(change) < 60) return "The same as last week by this time.";
  const percent = Math.round((Math.abs(change) / byNow) * 100);
  return `${formatDuration(Math.abs(change))} ${change > 0 ? "more" : "less"} than last week by this time (${change > 0 ? "+" : "−"}${percent}%).`;
}

export function WeeklyReport({ projects, onOpen }: { projects: ResearchProject[]; onOpen: (project: ResearchProject) => void }) {
  const { log, profile, store, liveIntervals } = useFocus();
  const now = useFocusClock();
  const { weekStart, clock } = profile.preferences;
  const data = useMemo(() => {
    if (!now) return undefined;
    const sessions = [...log.sessions, ...liveSessions(store, profile, now)];
    const today = new Date(now);
    const report = weekReport(sessions, dailyTotals(log, liveIntervals(now)), today, weekStart);
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1 - PATTERN_WEEKS * 7).getTime();
    return { report, pattern: hourPattern(sessions, { from, to, weekStart }), today };
  }, [log, liveIntervals, now, profile, store, weekStart]);
  if (!data) return null;
  const { report, pattern, today } = data;
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
    ? `Over the last ${PATTERN_WEEKS} weeks, ${Math.round(peak.share * 100)}% of your work fell between ${hourName(peak.from, clock)} and ${hourName(peak.to, clock)}, and ${longWeekday.format(dayNames[busiest])} was your busiest day.`
    : `Nothing recorded in the last ${PATTERN_WEEKS} weeks yet.`;

  return (
    <section className="stats-block profile-week" aria-label="Week by week">
      <h2>This week against last</h2>
      <div className="week-report">
        <div>
          <div className="week-figures">
            <div>
              <span>This week</span>
              <strong>{formatDuration(report.thisWeek.seconds)}</strong>
              <small>since {shortDate.format(dayDate(report.thisWeek.from))}</small>
            </div>
            <div className="is-last">
              <span>Last week</span>
              <strong>{formatDuration(report.lastWeek.seconds)}</strong>
              <small>{formatDuration(report.lastWeek.byNow)} by this time</small>
            </div>
          </div>
          <p className={`week-change${report.change >= 60 ? " is-up" : report.change <= -60 ? " is-down" : ""}`}>{changeText(report.change, report.lastWeek.byNow, report.thisWeek.seconds)}</p>
          <ul className="week-bars" aria-label="Day by day">
            {report.thisWeek.days.map((day, index) => {
              const last = report.lastWeek.days[index];
              const future = day.day > todayKey;
              const name = weekday.format(dayNames[index]);
              return (
                <li key={day.day} className={day.day === todayKey ? "is-today" : ""} aria-label={`${name}: ${future ? "still to come" : formatDuration(day.seconds)} this week, ${formatDuration(last.seconds)} last week`}>
                  <span className="week-bar-pair" aria-hidden="true">
                    <i className="is-this" style={{ height: future ? 0 : `${Math.max(day.seconds ? 3 : 0, (day.seconds / most) * 100)}%` }} />
                    <i className="is-last" style={{ height: `${Math.max(last.seconds ? 3 : 0, (last.seconds / most) * 100)}%` }} />
                  </span>
                  <small aria-hidden="true">{name}</small>
                </li>
              );
            })}
          </ul>
          <p className="week-legend" aria-hidden="true"><i className="is-this" /> This week <i className="is-last" /> Last week</p>
        </div>
        <div className="week-papers">
          <h3>By paper</h3>
          {named.length || other.thisWeek || other.lastWeek ? (
            <table>
              <thead>
                <tr><th scope="col">Paper</th><th scope="col">This week</th><th scope="col">Last week</th></tr>
              </thead>
              <tbody>
                {named.map((row) => {
                  const project = byId.get(row.projectId)!;
                  return (
                    <tr key={row.projectId}>
                      <th scope="row"><button type="button" onClick={() => onOpen(project)} title={project.evidence.paper.title}>{project.evidence.paper.title}</button></th>
                      <td>{row.thisWeek >= 60 ? formatDuration(row.thisWeek) : "—"}</td>
                      <td>{row.lastWeek >= 60 ? formatDuration(row.lastWeek) : "—"}</td>
                    </tr>
                  );
                })}
                {other.thisWeek >= 60 || other.lastWeek >= 60 ? (
                  <tr className="is-other">
                    <th scope="row">Other work</th>
                    <td>{other.thisWeek >= 60 ? formatDuration(other.thisWeek) : "—"}</td>
                    <td>{other.lastWeek >= 60 ? formatDuration(other.lastWeek) : "—"}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <p className="focus-note">Name a paper on the timer, or start a round from its Lab, Study or Review, and its time shows here.</p>
          )}
        </div>
      </div>

      <div className="hour-pattern">
        <h3>When you work</h3>
        <div
          className="hour-grid"
          role="img"
          aria-label={`Hours worked by weekday and hour of the day. ${summary}`}
        >
          {pattern.cells.map((row, index) => (
            <div key={index} className="hour-row">
              <span className="hour-day">{weekday.format(dayNames[index])}</span>
              {row.map((seconds, hour) => (
                <i
                  key={hour}
                  className={`work-cell level-${hourLevel(seconds, pattern.max)}`}
                  title={`${longWeekday.format(dayNames[index])}, ${hourName(hour, clock)}–${hourName(hour + 1, clock)}: ${formatDuration(seconds)}`}
                />
              ))}
            </div>
          ))}
          <div className="hour-row hour-axis" aria-hidden="true">
            <span />
            {Array.from({ length: 24 }, (_, hour) => <small key={hour}>{hour % 6 === 0 ? hourName(hour, clock).replace(":00", "") : ""}</small>)}
          </div>
        </div>
        <p className="focus-note">{summary}</p>
      </div>
    </section>
  );
}
