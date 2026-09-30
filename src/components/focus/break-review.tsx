"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Layers, X } from "lucide-react";
import { LanguageProvider } from "@/visuals";
import { BREAK_REVIEW_SIZE, dueCards, recordReview, reviewCards, type ReviewCard } from "@/lib/review-queue";
import { describeDue } from "@/lib/review-schedule";
import type { ResearchProject } from "@/lib/schema";
import type { StudyProgress } from "@/lib/study-path";
import { ReviewCardBody } from "../review-card";
import { putStudyProgress, readLibraryStudy } from "../study-progress";

/**
 * Molada kısa tekrar: kısa mola başlayınca vadesi gelmiş en fazla üç kart
 * öneriliyor. Mola dinlenmek için; kartlar bir öneri, okuyucu "Just rest"
 * diyebiliyor. Uzun molada kart sorulmuyor.
 *
 * Kartlar her molada bir kez seçiliyor (`shortBreakKey`). Okuyucu kartlara
 * başladıysa mola bitince kartlar elinden alınmıyor; başlamadıysa öneri
 * molayla birlikte kalkıyor. Sonuçlar tekrar ekranındaki gibi makalenin
 * çalışma kaydına yazılıyor; çalışma süresi sayılmıyor, mola moladır.
 */

type Grade = { remembered: boolean; due: string; at: string };
type BreakSession = {
  key: string;
  cards: ReviewCard[];
  study: Map<string, StudyProgress>;
  index: number;
  results: boolean[];
  grade?: Grade;
  /** Okuyucu kartlara başladı. */
  open: boolean;
  /** "Just rest" ya da kapatıldı. */
  closed: boolean;
};

export type BreakReview = ReturnType<typeof useBreakReview>;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function useBreakReview(projects: readonly ResearchProject[], breakKey: string | undefined) {
  const [session, setSession] = useState<BreakSession>();
  const [saveError, setSaveError] = useState<string>();
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loadedKey = session?.key;

  useEffect(() => {
    if (!breakKey || breakKey === loadedKey || !projects.length) return;
    let cancelled = false;
    // Okunamazsa öneri yok: kartlar molanın bir eki, sayaç ona bağlı değil.
    readLibraryStudy()
      .then((study) => {
        if (cancelled) return;
        const cards = dueCards(reviewCards(projects, study), new Date().toISOString(), BREAK_REVIEW_SIZE);
        setSession({ key: breakKey, cards, study, index: 0, results: [], open: false, closed: false });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [breakKey, loadedKey, projects]);

  const live = Boolean(session && session.key === breakKey);
  const finished = Boolean(session && session.index >= session.cards.length);
  const visible = Boolean(session && session.cards.length && !session.closed && (live || (session.open && !finished)));

  const mark = useCallback((remembered: boolean) => {
    const card = session?.cards[session.index];
    if (!session || !card || session.grade) return;
    const at = new Date().toISOString();
    const next = recordReview(session.study.get(card.projectId), card, remembered, at);
    const due = next.reviews!.find((item) => item.id === card.review.id)!.due;
    setSession({ ...session, study: new Map(session.study).set(card.projectId, next), results: [...session.results, remembered], grade: { remembered, due, at } });
    queue.current = queue.current.then(async () => {
      try {
        await putStudyProgress(card.projectId, next);
        setSaveError(undefined);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "The review could not be saved.");
      }
    });
  }, [session]);

  const update = (patch: (current: BreakSession) => Partial<BreakSession>) => setSession((current) => (current ? { ...current, ...patch(current) } : current));
  return {
    session: visible ? session : undefined,
    /** Molada bekleyen, henüz başlanmamış kart sayısı; tam ekranda gösteriliyor. */
    waiting: visible && session && !session.open ? session.cards.length : 0,
    live,
    saveError,
    mark,
    begin: () => update(() => ({ open: true })),
    close: () => update(() => ({ closed: true })),
    next: () => update((current) => ({ index: current.index + 1, grade: undefined })),
  };
}

export function BreakReviewCard({ review, projects }: { review: BreakReview; projects: readonly ResearchProject[] }) {
  const { session } = review;
  if (!session) return null;
  const count = session.cards.length;

  if (!session.open) {
    return (
      <section className="focus-offer break-review" aria-label="Review in the break">
        <Layers size={20} aria-hidden="true" />
        <div>
          <strong>{count === 1 ? "A review card is due." : `${count} review cards are due.`}</strong>
          <p>Go through {count === 1 ? "it" : "them"} while you rest, or just rest. What you studied stays longer when it comes back like this.</p>
        </div>
        <div className="focus-offer-actions">
          <button type="button" className="focus-primary" onClick={review.begin}>Review {plural(count, "card")}</button>
          <button type="button" className="focus-secondary" onClick={review.close}>Just rest</button>
        </div>
      </section>
    );
  }

  const card = session.cards[session.index];
  const project = card ? projects.find((item) => item.id === card.projectId) : undefined;
  if (!card || !project) {
    const remembered = session.results.filter(Boolean).length;
    return (
      <section className="break-review is-done" aria-label="Review in the break">
        <p role="status">
          {session.results.length ? `You remembered ${remembered} of ${plural(session.results.length, "card")}.` : "You skipped them; they stay due."}{" "}
          {review.live ? "Enjoy the rest of your break." : ""}
        </p>
        <button type="button" className="focus-secondary" onClick={review.close}>Close</button>
      </section>
    );
  }

  return (
    <LanguageProvider language={card.language}>
      <section className="break-review is-open" aria-label="Review in the break" style={{ "--accent": project.story.accent } as React.CSSProperties}>
        <header className="break-review-head">
          <span className="review-kind">{card.kind === "question" ? "Question" : "Concept"}</span>
          <span className="break-review-paper" lang={card.language}>{card.paperTitle}</span>
          <span className="review-count">{session.index + 1} / {count}</span>
          <button type="button" className="break-review-close" onClick={review.close} aria-label="Stop reviewing" title="Stop reviewing"><X size={15} /></button>
        </header>
        <ReviewCardBody key={card.key} card={card} project={project} graded={Boolean(session.grade)} onMark={review.mark} />
        <footer className="review-card-foot">
          {session.grade ? (
            <>
              <p role="status">{session.grade.remembered ? "Remembered." : "Not yet."} This card comes back {describeDue(session.grade.due, session.grade.at)}.</p>
              <button type="button" className="review-next" onClick={review.next}>
                {session.index + 1 < count ? "Next card" : "Done"} <ArrowRight size={14} />
              </button>
            </>
          ) : (
            <button type="button" className="review-skip" onClick={review.next}>Skip for now</button>
          )}
        </footer>
        {review.saveError ? <p className="regen-error" role="status">Not saved: {review.saveError}</p> : null}
      </section>
    </LanguageProvider>
  );
}
