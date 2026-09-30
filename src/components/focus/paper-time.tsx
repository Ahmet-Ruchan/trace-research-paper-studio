"use client";

import { useMemo } from "react";
import { Timer } from "lucide-react";
import { focusColorStyle } from "@/lib/focus-colors";
import type { Subject } from "@/lib/focus-timer";
import type { ResearchProject } from "@/lib/schema";
import { addDaysLocal, formatDuration, startOfWeek, timeByProject } from "@/lib/work-log";
import { focusDisplay, liveSessions, useFocus, useFocusClock } from "./focus-provider";
import { useStudioNav } from "./studio-nav";

/**
 * Lab'de makalenin kartı: bu makaleye ayrılan zaman ve bir odak turunu bu
 * makale için başlatan düğme. Süre, oturum bu makaleye bağlandıysa sayılıyor.
 */
export function PaperFocusOffer({ project }: { project: ResearchProject }) {
  const { profile, log, store, actions } = useFocus();
  const now = useFocusClock();
  const nav = useStudioNav();
  const { total, week } = useMemo(() => {
    const sessions = [...log.sessions, ...(now ? liveSessions(store, profile, now) : [])];
    const from = startOfWeek(new Date(now || 0), profile.preferences.weekStart).getTime();
    return {
      total: timeByProject(sessions).get(project.id) ?? 0,
      week: timeByProject(sessions, { from, to: addDaysLocal(new Date(from), 7).getTime() }).get(project.id) ?? 0,
    };
  }, [log.sessions, now, profile, project.id, store]);
  const focus = store.focus && !store.focus.finished ? store.focus : undefined;
  const here = focus?.projectId === project.id;
  const shown = focus ? focusDisplay(focus, profile, now) : undefined;

  return (
    <section className="focus-offer" style={focusColorStyle(profile.preferences.colors.focus)} aria-label="Time on this paper">
      <Timer size={20} aria-hidden="true" />
      <div>
        <strong>{total >= 60 ? `${formatDuration(total)} on this paper` : "Time on this paper"}</strong>
        <p>
          {total >= 60
            ? `${week >= 60 ? `${formatDuration(week)} of it this week` : "None of it this week yet"}. Focus rounds you start here, or name this paper on the timer, are counted for it.`
            : "Start a focus round here and the time you spend on this paper is counted for it, on your profile too."}
        </p>
      </div>
      <div className="focus-offer-actions">
        {focus && shown ? (
          <button type="button" className="focus-secondary" onClick={() => nav?.open("focus")}>
            {here ? "Focus round on this paper" : "A focus round is running"} · {Math.ceil(shown.remaining / 60_000)} min left
          </button>
        ) : (
          <button type="button" className="focus-primary" onClick={() => actions.startFocus({ label: project.evidence.paper.title, projectId: project.id })}>
            <Timer size={15} /> Start a focus round
          </button>
        )}
      </div>
    </section>
  );
}

const phaseName = { work: "Focus round", short: "Short break", long: "Long break" } as const;

/**
 * Çalışma ve tekrar ekranlarında ince bir şerit: buradan bir odak turu
 * başlatılıyor ve süre verilen konuya (makale ya da tekrar) yazılıyor. Tur
 * zaten sürüyorsa kalan süre ve zamanlayıcıya giden bir düğme.
 */
export function FocusRoundBar({ subject, hint }: { subject: Subject; hint: string }) {
  const { profile, store, actions } = useFocus();
  const now = useFocusClock();
  const nav = useStudioNav();
  const focus = store.focus && !store.focus.finished ? store.focus : undefined;
  const shown = focus ? focusDisplay(focus, profile, now) : undefined;
  const here = Boolean(focus && subject.projectId && focus.projectId === subject.projectId);

  return (
    <div className="focus-bar" style={focusColorStyle(profile.preferences.colors.focus)} role="group" aria-label="Focus round">
      <Timer size={16} aria-hidden="true" />
      {focus && shown ? (
        <>
          <p role="status">
            <strong>{phaseName[shown.phase]}</strong> · {Math.ceil(shown.remaining / 60_000)} min left{shown.running ? "" : ", paused"}
            {here ? " · counted for this paper" : ""}
          </p>
          <button type="button" className="focus-secondary" onClick={() => nav?.open("focus")}>Open the timer</button>
        </>
      ) : (
        <>
          <p>{hint}</p>
          <button type="button" className="focus-primary" onClick={() => actions.startFocus(subject)}><Timer size={15} /> Start a focus round</button>
        </>
      )}
    </div>
  );
}

/** Profilde makale başına süre: en çok zaman ayrılan makaleler, bağlanmamış çalışma ayrı. */
export function PaperTimeCard({ projects, onOpen, range }: { projects: ResearchProject[]; onOpen: (project: ResearchProject) => void; range: { from?: number; to?: number; label: string } }) {
  const { log, profile, store } = useFocus();
  const now = useFocusClock();
  const rows = useMemo(() => {
    const sessions = [...log.sessions, ...(now ? liveSessions(store, profile, now) : [])];
    return [...timeByProject(sessions, range)].filter(([, seconds]) => seconds >= 60);
  }, [log.sessions, now, profile, range, store]);
  const byId = new Map(projects.map((project) => [project.id, project]));
  const papers = rows.filter(([id]) => id && byId.has(id)).slice(0, 10);
  const other = rows.filter(([id]) => !id || !byId.has(id)).reduce((sum, [, seconds]) => sum + seconds, 0);
  const most = Math.max(1, ...papers.map(([, seconds]) => seconds), other);

  return (
    <section className="stats-block profile-papers" aria-label="Time by paper">
      <h2>Time by paper</h2>
      <p>{range.label}. Name a paper on the timer, or start a round from its Lab, to count the time for it.</p>
      {papers.length || other ? (
        <ul className="paper-time">
          {papers.map(([id, seconds]) => (
            <li key={id}>
              <button type="button" onClick={() => onOpen(byId.get(id)!)} title={byId.get(id)!.evidence.paper.title}>{byId.get(id)!.evidence.paper.title}</button>
              <span className="paper-time-bar" aria-hidden="true"><i style={{ width: `${(seconds / most) * 100}%` }} /></span>
              <strong>{formatDuration(seconds)}</strong>
            </li>
          ))}
          {other ? (
            <li>
              <span>Other work</span>
              <span className="paper-time-bar" aria-hidden="true"><i style={{ width: `${(other / most) * 100}%` }} /></span>
              <strong>{formatDuration(other)}</strong>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="focus-note">No time counted yet.</p>
      )}
    </section>
  );
}
