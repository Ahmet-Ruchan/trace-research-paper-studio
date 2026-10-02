"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { useUiLanguage } from "@/i18n/client";
import { uiLocale } from "@/i18n/languages";
import type { Messages } from "@/i18n/messages";
import { learningStats, LONG_TERM_BOX, type LearningStats } from "@/lib/learning-stats";
import { cardText } from "@/lib/review-queue";
import { REVIEW_INTERVALS_DAYS } from "@/lib/review-schedule";
import type { ResearchProject } from "@/lib/schema";
import { useLibraryStudyState } from "./study-progress";
import { StudioNav } from "./focus/studio-nav";

/** "4 of 6"; yüzde yalnızca en az on sayım varsa, küçük örneklemden oran okunmasın. */
function share(t: Messages["learning"]["learningStats"], part: number, whole: number) {
  if (!whole) return "—";
  return whole >= 10 ? t.share(part, whole, Math.round((part / whole) * 100)) : t.share(part, whole);
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

function intervalLabel(t: Messages["learning"]["learningStats"], days: number) {
  return days === 1 ? t.tomorrow : t.days(days);
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
  const { language, t: messages } = useUiLanguage();
  const learning = messages.learning;
  const t = learning.learningStats;
  const formats = useMemo(() => ({
    day: new Intl.DateTimeFormat(uiLocale(language), { weekday: "short", day: "numeric", month: "short" }),
    date: new Intl.DateTimeFormat(uiLocale(language), { dateStyle: "medium" }),
  }), [language]);
  const state = useLibraryStudyState();
  const [now] = useState(() => new Date().toISOString());
  const stats: LearningStats | undefined = useMemo(
    () => (state.status === "ready" ? learningStats(projects, state.study, now) : undefined),
    [projects, state, now],
  );

  return (
    <main className="compare-page learning-stats-page">
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label={learning.shell.backToLibrary}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>{learning.shell.brandTagline}</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> {learning.shell.library}</button>
          <StudioNav />
        </div>
      </header>

      <section className="compare-hero">
        <p className="landing-eyebrow"><span /> {t.eyebrow}</p>
        <h1>
          {!stats
            ? t.headingLoading
            : stats.totals.reviews
              ? t.headingRemembered(stats.totals.remembered, stats.totals.reviews)
              : stats.papers.length
                ? t.headingStudying(stats.papers.length)
                : t.headingNothing}
        </h1>
        <p>
          {t.intro}
        </p>
      </section>

      {state.status === "loading" ? <p className="stats-note" role="status">{t.loading}</p> : null}
      {state.status === "failed" ? <p className="regen-error stats-note" role="alert">{state.message}</p> : null}

      {stats && !stats.papers.length ? (
        <section className="review-empty">
          <BarChart3 size={22} aria-hidden="true" />
          <p>{t.empty.before}<strong>{t.empty.study}</strong>{t.empty.after}</p>
          <button onClick={onBack}>{learning.shell.library}</button>
        </section>
      ) : null}

      {stats && stats.papers.length ? (
        <>
          <section className="stat-tiles" aria-label={t.summary}>
            <div className="stat-tile">
              <span>{t.papers}</span>
              <strong>{stats.totals.finished + stats.totals.started}</strong>
              <small>{t.papersNote(stats.totals.finished, stats.totals.started)}</small>
            </div>
            <div className="stat-tile">
              <span>{t.remembered}</span>
              <strong>{stats.totals.reviews ? share(t, stats.totals.remembered, stats.totals.reviews) : "—"}</strong>
              <small>{stats.totals.reviews ? t.rememberedNote : t.noReviews}</small>
            </div>
            <div className="stat-tile">
              <span>{t.firstTry}</span>
              <strong>{stats.totals.answered ? share(t, stats.totals.firstTry, stats.totals.answered) : "—"}</strong>
              <small>{t.firstTryNote}</small>
            </div>
            <div className="stat-tile">
              <span>{t.longTerm}</span>
              <strong>{share(t, stats.totals.longTerm, stats.totals.cards)}</strong>
              <small>{t.longTermNote(REVIEW_INTERVALS_DAYS[LONG_TERM_BOX])}</small>
            </div>
            <div className="stat-tile">
              <span>{t.toReview}</span>
              <strong>{stats.totals.due}</strong>
              <small>
                {t.toReviewNote(stats.week[0].due - stats.totals.due, stats.week.slice(1).reduce((total, day) => total + day.due, 0))}{" "}
                {stats.totals.due ? <button type="button" className="text-link" onClick={onReview}>{t.reviewNow}</button> : null}
              </small>
            </div>
          </section>

          <div className="stats-columns">
            <section className="stats-block">
              <h2>{t.keptTitle}</h2>
              <p>{t.keptNote(stats.totals.cards)}</p>
              <BarList
                label={t.keptLabel}
                rows={REVIEW_INTERVALS_DAYS.map((days, box) => ({ key: `box-${box}`, label: intervalLabel(t, days), value: stats.boxes[box] }))}
              />
            </section>
            <section className="stats-block">
              <h2>{t.weekTitle}</h2>
              <p>{t.weekNote}</p>
              <BarList
                label={t.weekLabel}
                rows={stats.week.map((day, index) => ({
                  key: day.day,
                  label: index === 0 ? t.today : index === 1 ? t.tomorrow : formats.day.format(new Date(day.start)),
                  value: day.due,
                }))}
              />
            </section>
          </div>

          {stats.hardest.length ? (
            <section className="stats-block">
              <h2>{t.hardestTitle}</h2>
              <p>{t.hardestNote}</p>
              <ol className="stats-hardest">
                {stats.hardest.map((card) => {
                  const project = projects.find((item) => item.id === card.projectId);
                  return (
                    <li key={card.key}>
                      <span lang={card.language}>{cardText(card)}</span>
                      <small>
                        {learning.cardKinds[card.kind].toLocaleLowerCase(uiLocale(language))} ·{" "}
                        {project ? <button type="button" className="text-link" onClick={() => onOpen(project)}>{card.paperTitle}</button> : card.paperTitle}{" "}
                        {t.forgotten(card.review.lapses, card.review.reviews)}
                      </small>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {stats.explanationGain.sections ? (
            <section className="stats-block">
              <h2>{t.explainTitle}</h2>
              <p>
                {t.explainLead(stats.explanationGain.sections, stats.explanationGain.before)}
                <strong>{t.explainLatest(stats.explanationGain.after, stats.explanationGain.total)}</strong>
                {t.explainEnd}
              </p>
            </section>
          ) : null}

          <section className="stats-block">
            <h2>{t.byPaper}</h2>
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th scope="col">{t.columns.paper}</th>
                    <th scope="col">{t.columns.study}</th>
                    <th scope="col">{t.columns.firstTry}</th>
                    <th scope="col">{t.columns.cards}</th>
                    <th scope="col">{t.columns.remembered}</th>
                    <th scope="col">{t.columns.lastStudied}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.papers.map((paper) => (
                    <tr key={paper.project.id}>
                      <th scope="row"><button type="button" className="text-link" onClick={() => onOpen(paper.project)}>{paper.project.evidence.paper.title}</button></th>
                      <td>{learning.studyStatus[paper.status]} · {t.steps(paper.steps.done, paper.steps.total)}</td>
                      <td>{paper.checks.answered ? share(t, paper.checks.firstTry, paper.checks.answered) : "—"}</td>
                      <td>{paper.cards.total}{paper.cards.due ? t.dueSuffix(paper.cards.due) : ""}</td>
                      <td>{paper.recalls.reviews ? share(t, paper.recalls.remembered, paper.recalls.reviews) : "—"}</td>
                      <td>{formats.date.format(new Date(paper.lastStudied))}</td>
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
