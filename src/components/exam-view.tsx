"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock, X } from "lucide-react";
import { LanguageProvider } from "@/visuals";
import { buildExam, EXAM_MINUTES, EXAM_SIZES, examPool, gradeExam, missedToReview, type ExamQuestion, type ExamResult } from "@/lib/exam";
import type { ResearchProject } from "@/lib/schema";
import { formatClock, formatDuration } from "@/lib/work-log";
import { putStudyProgress, readLibraryStudy } from "./study-progress";
import { StudioNav } from "./focus/studio-nav";

/**
 * Sınav modu (`exam.ts`): kurulum, süreli sınav, sonuç. Sınav sırasında
 * doğru yanıt gösterilmiyor; sonuç sonda, her sorunun açıklamasıyla.
 */

type Run = { exam: ExamQuestion[]; startedAt: number; minutes: number };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function ExamView({
  projects,
  projectId,
  onBack,
  backLabel,
  onOpen,
}: {
  projects: ResearchProject[];
  /** Verilirse yalnızca bu makalenin soruları. */
  projectId?: string;
  onBack: () => void;
  backLabel: string;
  onOpen: (project: ResearchProject) => void;
}) {
  const scoped = useMemo(() => (projectId ? projects.filter((item) => item.id === projectId) : projects), [projects, projectId]);
  const pool = useMemo(() => examPool(scoped), [scoped]);
  // 10, 20, 30 ve hepsi (en çok elli): kısa ya da tam bir deneme.
  const sizeOptions = useMemo(() => {
    const all = Math.min(pool.length, 50);
    return [...EXAM_SIZES.filter((option) => option < all).map((option) => ({ value: option, label: String(option) })), { value: all, label: all === pool.length ? `All ${all}` : String(all) }];
  }, [pool.length]);
  const [size, setSize] = useState<number>(Math.min(20, pool.length) || 10);
  const [minutes, setMinutes] = useState<number>(20);
  const [run, setRun] = useState<Run>();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, number[]>>(new Map());
  const [result, setResult] = useState<{ grade: ExamResult; seconds: number; timedOut: boolean }>();
  const [now, setNow] = useState(0);
  const [saved, setSaved] = useState<{ text: string; error?: boolean }>();
  const paper = projectId ? scoped[0]?.evidence.paper.title : undefined;

  const left = run && run.minutes ? Math.max(0, run.startedAt + run.minutes * 60_000 - now) : undefined;

  function finish(timedOut = false) {
    if (!run) return;
    const at = Date.now();
    setResult({ grade: gradeExam(run.exam, answers), seconds: Math.round((at - run.startedAt) / 1000), timedOut });
    setRun(undefined);
  }

  // Sayaç saniyede bir; süre bitince sınav kendiliğinden bitiyor.
  useEffect(() => {
    if (!run) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const first = setTimeout(() => setNow(Date.now()), 0);
    return () => {
      clearInterval(tick);
      clearTimeout(first);
    };
  }, [run]);
  useEffect(() => {
    if (left !== 0) return;
    const end = setTimeout(() => finish(true), 0);
    return () => clearTimeout(end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  function start() {
    const at = Date.now();
    setRun({ exam: buildExam(pool, size, at), startedAt: at, minutes });
    setNow(at);
    setIndex(0);
    setAnswers(new Map());
    setResult(undefined);
    setSaved(undefined);
  }

  async function bringBack(grade: ExamResult) {
    const missed = grade.items.filter((entry) => !entry.right);
    if (!missed.length) return;
    try {
      const study = await readLibraryStudy();
      const at = new Date().toISOString();
      const changed = new Map<string, NonNullable<ReturnType<typeof study.get>>>();
      for (const { item } of missed) changed.set(item.projectId, missedToReview(changed.get(item.projectId) ?? study.get(item.projectId), item.question, at));
      for (const [id, progress] of changed) await putStudyProgress(id, progress);
      setSaved({ text: `${plural(missed.length, "question")} will come back in Review tomorrow.` });
    } catch (error) {
      setSaved({ text: error instanceof Error ? error.message : "The questions could not be added to review.", error: true });
    }
  }

  const current = run?.exam[index];
  const project = current ? scoped.find((item) => item.id === current.projectId) : undefined;
  const chosen = current ? answers.get(current.key) ?? [] : [];

  return (
    <main className="compare-page review-page exam-page">
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label={backLabel}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</button>
          <StudioNav />
        </div>
      </header>

      <section className="compare-hero">
        <p className="landing-eyebrow"><span /> Practice exam{paper ? ` · ${paper}` : ""}</p>
        <h1>
          {result
            ? `${result.grade.correct} of ${result.grade.total} right.`
            : run
              ? `Question ${index + 1} of ${run.exam.length}.`
              : pool.length
                ? "Test yourself, against the clock."
                : "No questions to ask yet."}
        </h1>
        <p>
          Questions from {paper ? "this paper" : "every paper in your library"}, mixed, whether you studied them or not and whether they are due or
          not. Nothing is shown until the end; then each question comes with its answer, why, and the page. Your review schedule does not
          change unless you ask.
        </p>
      </section>

      {!run && !result && pool.length ? (
        <section className="exam-setup" aria-label="Set up the exam">
          <div role="group" aria-label="Questions">
            <span>Questions</span>
            {sizeOptions.map((option) => (
              <button key={option.value} type="button" aria-pressed={size === option.value} onClick={() => setSize(option.value)}>{option.label}</button>
            ))}
          </div>
          <div role="group" aria-label="Time">
            <span>Time</span>
            {EXAM_MINUTES.map((option) => (
              <button key={option} type="button" aria-pressed={minutes === option} onClick={() => setMinutes(option)}>{option ? `${option} min` : "No limit"}</button>
            ))}
          </div>
          <button type="button" className="review-next" onClick={start}>Start the exam <ArrowRight size={14} /></button>
        </section>
      ) : null}

      {!pool.length ? (
        <section className="review-empty">
          <p>Questions come from a paper&rsquo;s quiz and its reading drill. Open a paper and generate its learning layer, then come back.</p>
          <button onClick={onBack}>{backLabel}</button>
        </section>
      ) : null}

      {run && current && project ? (
        <LanguageProvider language={current.language}>
          <article className="review-card exam-card" aria-label={`Question ${index + 1} of ${run.exam.length}`} style={{ "--accent": project.story.accent } as React.CSSProperties}>
            <header className="review-card-head">
              <span className="review-kind">Question</span>
              <span className="review-paper" lang={current.language}>{current.paperTitle}</span>
              {left !== undefined ? (
                <span className={`exam-clock${left < 60_000 ? " is-low" : ""}`} role="timer" aria-label={`${formatClock(left)} left`}><Clock size={13} aria-hidden="true" /> {formatClock(left)}</span>
              ) : (
                <span className="review-count">{index + 1} / {run.exam.length}</span>
              )}
            </header>
            <div className="review-progress" aria-hidden="true"><i style={{ width: `${(answers.size / run.exam.length) * 100}%` }} /></div>
            <fieldset className="exam-question">
              <legend lang={current.language}>{current.question.prompt}</legend>
              {current.question.kind === "multi" ? <p className="review-prompt">Choose every answer that is right.</p> : null}
              {current.question.options.map((option, position) => {
                const multi = current.question.kind === "multi";
                const checked = chosen.includes(position);
                return (
                  <label key={position} className={checked ? "is-chosen" : ""}>
                    <input
                      type={multi ? "checkbox" : "radio"}
                      name={`exam-${current.key}`}
                      checked={checked}
                      onChange={() => {
                        const next = multi ? (checked ? chosen.filter((item) => item !== position) : [...chosen, position]) : [position];
                        setAnswers((map) => {
                          const copy = new Map(map);
                          if (next.length) copy.set(current.key, next);
                          else copy.delete(current.key);
                          return copy;
                        });
                      }}
                    />
                    <span lang={current.language}>{option.label}</span>
                  </label>
                );
              })}
            </fieldset>
            <footer className="review-card-foot exam-foot">
              <button type="button" className="review-skip" disabled={index === 0} onClick={() => setIndex((at) => at - 1)}>Previous</button>
              <span className="exam-answered">{answers.size} of {run.exam.length} answered</span>
              {index + 1 < run.exam.length ? (
                <button type="button" className="review-next" onClick={() => setIndex((at) => at + 1)}>Next <ArrowRight size={14} /></button>
              ) : (
                <button type="button" className="review-next" onClick={() => finish()}>Finish the exam</button>
              )}
            </footer>
          </article>
          {index + 1 < run.exam.length ? <p className="exam-early"><button type="button" className="review-skip" onClick={() => finish()}>Finish now</button></p> : null}
        </LanguageProvider>
      ) : null}

      {result ? (
        <section className="exam-result" aria-label="Your result">
          <p className="exam-score">
            {Math.round((result.grade.correct / Math.max(1, result.grade.total)) * 100)}% in {formatDuration(result.seconds)}
            {result.timedOut ? ", when the time ran out" : ""}
            {result.grade.unanswered ? `; ${plural(result.grade.unanswered, "question")} left unanswered` : ""}.
          </p>
          {result.grade.byPaper.length > 1 ? (
            <table className="exam-papers">
              <thead><tr><th scope="col">Paper</th><th scope="col">Right</th></tr></thead>
              <tbody>
                {result.grade.byPaper.map((row) => {
                  const target = scoped.find((item) => item.id === row.projectId);
                  return (
                    <tr key={row.projectId}>
                      <th scope="row">{target ? <button type="button" className="text-link" onClick={() => onOpen(target)}>{row.paper}</button> : row.paper}</th>
                      <td>{row.correct} of {row.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
          <div className="review-actions">
            {result.grade.correct < result.grade.total ? (
              <button type="button" onClick={() => void bringBack(result.grade)} disabled={Boolean(saved && !saved.error)}>
                Bring the {plural(result.grade.total - result.grade.correct, "missed question")} back in Review tomorrow
              </button>
            ) : null}
            <button type="button" className="review-secondary" onClick={start}>Take another</button>
          </div>
          {saved ? <p className={saved.error ? "regen-error" : "exam-saved"} role="status">{saved.text}</p> : null}
          <ol className="exam-answers">
            {result.grade.items.map(({ item, answer, right, correct }) => (
              <li key={item.key} className={right ? "is-right" : "is-wrong"} lang={item.language}>
                <p className="exam-answer-head">
                  {right ? <Check size={15} aria-label="Right" /> : <X size={15} aria-label={answer.length ? "Wrong" : "Not answered"} />}
                  <strong>{item.question.prompt}</strong>
                </p>
                <p className="exam-answer-line">
                  {answer.length ? <>You chose {answer.map((at) => `“${item.question.options[at].label}”`).join(", ")}. </> : <>Not answered. </>}
                  {right ? "" : <>The answer: {correct.map((at) => `“${item.question.options[at].label}”`).join(", ")}.</>}
                </p>
                <p className="exam-why">{correct.map((at) => item.question.options[at].explanation).filter(Boolean).join(" ")}</p>
                <small>{item.paperTitle}{item.question.page ? ` · p. ${item.question.page}` : ""}</small>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
