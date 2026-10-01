"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Layers } from "lucide-react";
import { LanguageProvider } from "@/visuals";
import { CARD_KIND_LABELS, dueCards, recordReview, reviewCards, reviewForecast, type ReviewCard } from "@/lib/review-queue";
import { REVIEW_INTERVALS_DAYS, describeDue } from "@/lib/review-schedule";
import { extendReviewBlock, type ReviewBlock } from "@/lib/work-log";
import type { ResearchProject } from "@/lib/schema";
import type { StudyProgress } from "@/lib/study-path";
import { putStudyProgress, readLibraryStudy } from "./study-progress";
import { ReviewCardBody } from "./review-card";
import { useFocus } from "./focus/focus-provider";
import { FocusRoundBar } from "./focus/paper-time";
import { StudioNav } from "./focus/studio-nav";

type Load = { status: "loading" } | { status: "failed"; message: string } | { status: "ready" };
type Grade = { remembered: boolean; due: string; at: string };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Tekrar: kütüphanedeki bütün makalelerin vadesi gelmiş kartları, tek tek.
 *
 * Kartın kendisi `review-card.tsx`'te. Kavram kartında seçenek yok: seçenek
 * olmadan hatırlamak, seçenekler arasından tanımaktan daha zor ve daha kalıcı.
 *
 * Oturum açılışta bir kez kuruluyor; yanıtlandıkça kuyruk yeniden
 * hesaplanmıyor, yoksa ertesi güne atılan bir kart okuyucunun gözü önünde
 * kaybolurdu.
 */
export function ReviewView({
  projects,
  projectId,
  onBack,
  backLabel,
  onOpen,
  onExam,
}: {
  projects: ResearchProject[];
  /** Sınav modu: aynı kapsamın bütün sorularından süreli bir deneme. */
  onExam?: () => void;
  /** Verilirse yalnızca bu makalenin kartları. */
  projectId?: string;
  onBack: () => void;
  backLabel: string;
  onOpen: (project: ResearchProject) => void;
}) {
  const scoped = useMemo(() => (projectId ? projects.filter((item) => item.id === projectId) : projects), [projects, projectId]);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [study, setStudy] = useState<Map<string, StudyProgress>>(new Map());
  const [session, setSession] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [grade, setGrade] = useState<Grade>();
  const [results, setResults] = useState<boolean[]>([]);
  const [saveError, setSaveError] = useState<string>();
  const [now] = useState(() => new Date().toISOString());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const { logReviewTime } = useFocus();
  const shownAt = useRef<number | undefined>(undefined);
  const block = useRef<ReviewBlock | undefined>(undefined);

  // Kartlar açılışta okunuyor; oturum o anki kuyruktan kuruluyor.
  useEffect(() => {
    let cancelled = false;
    readLibraryStudy()
      .then((entries) => {
        if (cancelled) return;
        setStudy(entries);
        setSession(dueCards(reviewCards(scoped, entries), new Date().toISOString()));
        setIndex(0);
        setLoad({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: "failed", message: error instanceof Error ? error.message : "The review cards could not be read." });
      });
    return () => {
      cancelled = true;
    };
  }, [scoped]);

  const forecast = useMemo(() => reviewForecast(reviewCards(scoped, study), now), [scoped, study, now]);
  const card = session[index];
  const project = card ? scoped.find((item) => item.id === card.projectId) : undefined;
  const paper = projectId ? scoped[0]?.evidence.paper.title : undefined;
  const subject = useMemo(() => (projectId && paper ? { label: paper, projectId } : {}), [paper, projectId]);

  // Kartın göründüğü an: geçilince aradaki süre tekrar oturumuna ekleniyor.
  const cardKey = card?.key;
  useEffect(() => {
    shownAt.current = cardKey ? Date.now() : undefined;
  }, [cardKey]);

  function save(target: string, progress: StudyProgress) {
    queue.current = queue.current.then(async () => {
      try {
        await putStudyProgress(target, progress);
        setSaveError(undefined);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "The review could not be saved.");
      }
    });
  }

  function mark(remembered: boolean) {
    if (!card || grade) return;
    const at = new Date().toISOString();
    const next = recordReview(study.get(card.projectId), card, remembered, at);
    setStudy((current) => new Map(current).set(card.projectId, next));
    setGrade({ remembered, due: next.reviews!.find((item) => item.id === card.review.id)!.due, at });
    setResults((current) => [...current, remembered]);
    save(card.projectId, next);
  }

  /** Bu kartta geçen süre çalışma saatine; kart başına en çok beş dakika. */
  function countTime() {
    const shown = shownAt.current;
    if (shown === undefined) return;
    const at = Date.now();
    shownAt.current = at;
    const next = extendReviewBlock(block.current, shown, at, () => `review-${at}`);
    if (!next || next === block.current) return;
    block.current = next;
    logReviewTime(next, subject);
  }

  function advance() {
    countTime();
    setGrade(undefined);
    setIndex((current) => current + 1);
  }

  function another() {
    setSession(dueCards(reviewCards(scoped, study), new Date().toISOString()));
    setIndex(0);
    setResults([]);
    setGrade(undefined);
  }

  const finished = load.status === "ready" && session.length > 0 && index >= session.length;
  const heading = load.status !== "ready"
    ? "Review what you studied."
    : finished
      ? "Done for now."
      : session.length
        ? `${plural(session.length, "card")} to review${projectId ? "" : forecast.papers > 1 ? ` from ${forecast.papers} papers` : ""}.`
        : forecast.total
          ? "Nothing is due."
          : "Nothing to review yet.";

  return (
    <main className="compare-page review-page">
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
        <p className="landing-eyebrow"><span /> Review{paper ? ` · ${paper}` : ""}</p>
        <h1>{heading}</h1>
        <p>
          What you answer and read in Study comes back here: a day later, then after{" "}
          {REVIEW_INTERVALS_DAYS.slice(1).join(", ").replace(/, (\d+)$/, " and $1")} days while you keep remembering it. A card
          you miss starts again from tomorrow. Papers are mixed, so one answer does not give away the next.
        </p>
        {onExam ? <button type="button" className="text-button review-exam-link" onClick={onExam}>Practice exam: every question, against the clock <ArrowRight size={14} /></button> : null}
      </section>

      {session.length > 0 && !finished ? (
        <FocusRoundBar
          subject={projectId && paper ? subject : { label: "Review" }}
          hint={projectId ? "Review in a focus round: the time is counted for this paper." : "Review in a focus round, with a break after it. Time on the cards counts as work either way."}
        />
      ) : null}
      {load.status === "loading" && <p className="review-status" role="status">Loading your review cards…</p>}
      {load.status === "failed" && <p className="regen-error" role="alert">{load.message}</p>}
      {saveError && <p className="regen-error" role="status">Not saved: {saveError}</p>}

      {load.status === "ready" && !session.length && (
        <section className="review-empty">
          <Layers size={22} aria-hidden="true" />
          {forecast.total ? (
            <p>
              {forecast.nextDue
                ? `The next ${forecast.total === 1 ? "card comes" : "cards come"} back ${describeDue(forecast.nextDue, now)}. ${plural(forecast.total, "card")} in all.`
                : `${plural(forecast.total, "card")} in all.`}
            </p>
          ) : (
            <p>Open a paper and choose Study. Every question you answer there and every concept you read becomes a card.</p>
          )}
          <button onClick={onBack}>{backLabel}</button>
        </section>
      )}

      {card && project && !finished && (
        <LanguageProvider language={card.language}>
          {/* Kart makalenin kendi rengini taşıyor: hangi makaleden geldiği bir bakışta belli. */}
          <article
            className="review-card"
            aria-label={`Card ${index + 1} of ${session.length}`}
            style={{ "--accent": project.story.accent } as React.CSSProperties}
          >
            <header className="review-card-head">
              <span className="review-kind">{CARD_KIND_LABELS[card.kind]}</span>
              <button className="review-paper" onClick={() => onOpen(project)} title="Open this paper" lang={card.language}>{card.paperTitle}</button>
              <span className="review-count">{index + 1} / {session.length}</span>
            </header>
            <div className="review-progress" aria-hidden="true"><i style={{ width: `${(index / session.length) * 100}%` }} /></div>

            <ReviewCardBody key={card.key} card={card} project={project} graded={Boolean(grade)} onMark={mark} />

            <footer className="review-card-foot">
              {grade ? (
                <>
                  <p role="status">
                    {grade.remembered ? "Remembered." : "Not yet."} This card comes back {describeDue(grade.due, grade.at)}.
                  </p>
                  <button className="review-next" onClick={advance}>
                    {index + 1 < session.length ? "Next card" : "Finish"} <ArrowRight size={14} />
                  </button>
                </>
              ) : (
                <button className="review-skip" onClick={advance}>Skip for now</button>
              )}
            </footer>
          </article>
        </LanguageProvider>
      )}

      {finished && (
        <section className="review-empty">
          <Layers size={22} aria-hidden="true" />
          <p>
            {results.length
              ? `You remembered ${results.filter(Boolean).length} of ${plural(results.length, "card")}.`
              : "You skipped every card; they stay due."}{" "}
            {forecast.due
              ? `${plural(forecast.due, "card")} still due.`
              : forecast.nextDue
                ? `The next review is ${describeDue(forecast.nextDue, now)}.`
                : ""}
          </p>
          <div className="review-actions">
            {forecast.due ? <button onClick={another}>Review {forecast.due} more</button> : null}
            <button className="review-secondary" onClick={onBack}>{backLabel}</button>
          </div>
        </section>
      )}
    </main>
  );
}
