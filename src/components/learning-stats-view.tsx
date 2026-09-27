"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { learningStats, LONG_TERM_BOX, type LearningStats } from "@/lib/learning-stats";
import { REVIEW_INTERVALS_DAYS } from "@/lib/review-schedule";
import type { ResearchProject } from "@/lib/schema";
import { studyStatusLabel } from "./concepts-view";
import { useLibraryStudyState } from "./study-progress";

const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;
const dayFormat = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short" });
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/** "4 of 6"; yüzde yalnızca en az on sayım varsa, küçük örneklemden oran okunmasın. */
function share(part: number, whole: number) {
  if (!whole) return "—";
  return whole >= 10 ? `${part} of ${whole} (${Math.round((part / whole) * 100)}%)` : `${part} of ${whole}`;
}

/**
 * Tek serili çubuk listesi: her satır etiket, çubuk ve sayı. Değer metin
 * olarak yazılı; çubuk yalnızca büyüklüğü gösteriyor, renk bir anlam taşımıyor.
 */
function BarList({ label, rows }: { label: string; rows: Array<{ key: string; label: string; value: number; note?: string }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="stat-bars" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key}>
          <span className="stat-bar-label">{row.label}</span>
          <span className="stat-bar-track" aria-hidden="true">
            {row.value ? <span className="stat-bar" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} /> : null}
          </span>
          <span className="stat-bar-value">{row.value}{row.note ? <small> {row.note}</small> : null}</span>
        </li>
      ))}
    </ul>
  );
}

function intervalLabel(days: number) {
  return days === 1 ? "Tomorrow" : `${days} days`;
}

/**
 * "Your learning": kütüphanedeki çalışmanın dökümü (`learning-stats.ts`).
 * Model yok, tahmin yok; çalışma kaydındaki sayımlar.
 */
export function LearningStatsView({
  projects,
  onBack,
  onOpen,
  onReview,
}: {
  projects: ResearchProject[];
  onBack: () => void;
  onOpen: (project: ResearchProject) => void;
  onReview: () => void;
}) {
  const state = useLibraryStudyState();
  const [now] = useState(() => new Date().toISOString());
  const stats: LearningStats | undefined = useMemo(
    () => (state.status === "ready" ? learningStats(projects, state.study, now) : undefined),
    [projects, state, now],
  );

  return (
    <main className="compare-page learning-stats-page">
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label="Back to the library">
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> Library</button>
        </div>
      </header>

      <section className="compare-hero">
        <p className="landing-eyebrow"><span /> Your learning</p>
        <h1>
          {!stats
            ? "Your learning."
            : stats.totals.reviews
              ? `You remembered ${stats.totals.remembered} of ${stats.totals.reviews} reviews.`
              : stats.papers.length
                ? `You are studying ${count(stats.papers.length, "paper")}.`
                : "Nothing studied yet."}
        </h1>
        <p>
          Counts from your study progress, nothing estimated: every answer, every review and every explanation you checked.
          A share is shown as a percentage only from ten counts up, because three reviews say little. It is kept in your library,
          never in a project file.
        </p>
      </section>

      {state.status === "loading" ? <p className="stats-note" role="status">Reading your study progress…</p> : null}
      {state.status === "failed" ? <p className="regen-error stats-note" role="alert">{state.message}</p> : null}

      {stats && !stats.papers.length ? (
        <section className="review-empty">
          <BarChart3 size={22} aria-hidden="true" />
          <p>Open a paper and start <strong>Study</strong>: what you answer and read shows up here, and in the review queue.</p>
          <button onClick={onBack}>Library</button>
        </section>
      ) : null}

      {stats && stats.papers.length ? (
        <>
          <section className="stat-tiles" aria-label="Summary">
            <div className="stat-tile">
              <span>Papers</span>
              <strong>{stats.totals.finished + stats.totals.started}</strong>
              <small>{stats.totals.finished} finished · {stats.totals.started} in progress</small>
            </div>
            <div className="stat-tile">
              <span>Remembered in review</span>
              <strong>{stats.totals.reviews ? share(stats.totals.remembered, stats.totals.reviews) : "—"}</strong>
              <small>{stats.totals.reviews ? "reviews where you recalled the card" : "no reviews yet"}</small>
            </div>
            <div className="stat-tile">
              <span>Right on the first try</span>
              <strong>{stats.totals.answered ? share(stats.totals.firstTry, stats.totals.answered) : "—"}</strong>
              <small>questions answered in Study</small>
            </div>
            <div className="stat-tile">
              <span>Kept long-term</span>
              <strong>{share(stats.totals.longTerm, stats.totals.cards)}</strong>
              <small>cards that come back after {REVIEW_INTERVALS_DAYS[LONG_TERM_BOX]} days or more</small>
            </div>
            <div className="stat-tile">
              <span>To review</span>
              <strong>{stats.totals.due}</strong>
              <small>
                now · {stats.week[0].due - stats.totals.due} later today · {stats.week.slice(1).reduce((total, day) => total + day.due, 0)} more this week{" "}
                {stats.totals.due ? <button type="button" className="text-link" onClick={onReview}>Review now</button> : null}
              </small>
            </div>
          </section>

          <div className="stats-columns">
            <section className="stats-block">
              <h2>How long your cards are kept</h2>
              <p>Each card comes back later every time you remember it, and tomorrow when you forget it. Where your {count(stats.totals.cards, "card")} are now:</p>
              <BarList
                label="Cards by the time until their next review"
                rows={REVIEW_INTERVALS_DAYS.map((days, box) => ({ key: `box-${box}`, label: intervalLabel(days), value: stats.boxes[box] }))}
              />
            </section>
            <section className="stats-block">
              <h2>The week ahead</h2>
              <p>Cards that come due each day. Today includes the ones already waiting.</p>
              <BarList
                label="Cards due each day this week"
                rows={stats.week.map((day, index) => ({
                  key: day.day,
                  label: index === 0 ? "Today" : index === 1 ? "Tomorrow" : dayFormat.format(new Date(day.start)),
                  value: day.due,
                }))}
              />
            </section>
          </div>

          {stats.hardest.length ? (
            <section className="stats-block">
              <h2>Hardest to keep</h2>
              <p>The cards you forgot most often. Rereading where they come from usually helps more than another review.</p>
              <ol className="stats-hardest">
                {stats.hardest.map((card) => {
                  const project = projects.find((item) => item.id === card.projectId);
                  return (
                    <li key={card.key}>
                      <span lang={card.language}>{card.kind === "concept" ? card.concept.term : card.question.prompt}</span>
                      <small>
                        {card.kind === "concept" ? "concept" : "question"} ·{" "}
                        {project ? <button type="button" className="text-link" onClick={() => onOpen(project)}>{card.paperTitle}</button> : card.paperTitle}{" "}
                        · forgotten {card.review.lapses} of {count(card.review.reviews, "review")}
                      </small>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {stats.explanationGain.sections ? (
            <section className="stats-block">
              <h2>Explaining it again</h2>
              <p>
                You explained {count(stats.explanationGain.sections, "section")} more than once in your own words. The first time you conveyed{" "}
                {stats.explanationGain.before} of the claims {stats.explanationGain.sections === 1 ? "it rests" : "they rest"} on; the latest time{" "}
                <strong>{stats.explanationGain.after} of {stats.explanationGain.total}</strong>.
              </p>
            </section>
          ) : null}

          <section className="stats-block">
            <h2>By paper</h2>
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th scope="col">Paper</th>
                    <th scope="col">Study</th>
                    <th scope="col">First try</th>
                    <th scope="col">Cards</th>
                    <th scope="col">Remembered</th>
                    <th scope="col">Last studied</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.papers.map((paper) => (
                    <tr key={paper.project.id}>
                      <th scope="row"><button type="button" className="text-link" onClick={() => onOpen(paper.project)}>{paper.project.evidence.paper.title}</button></th>
                      <td>{studyStatusLabel[paper.status]} · {paper.steps.done} of {paper.steps.total} steps</td>
                      <td>{paper.checks.answered ? share(paper.checks.firstTry, paper.checks.answered) : "—"}</td>
                      <td>{paper.cards.total}{paper.cards.due ? ` · ${paper.cards.due} due` : ""}</td>
                      <td>{paper.recalls.reviews ? share(paper.recalls.remembered, paper.recalls.reviews) : "—"}</td>
                      <td>{dateFormat.format(new Date(paper.lastStudied))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
