"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Layers, X } from "lucide-react";
import { useT, useUiLanguage } from "@/i18n/client";
import { LanguageProvider } from "@/visuals";
import { BREAK_REVIEW_SIZE, dueCards, recordReview, reviewCards, type ReviewCard } from "@/lib/review-queue";
import type { ResearchProject } from "@/lib/schema";
import type { StudyProgress } from "@/lib/study-path";
import { ReviewCardBody } from "../review-card";
import { putStudyProgress, readLibraryStudy, useStudyProgressText } from "../study-progress";

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

export function useBreakReview(projects: readonly ResearchProject[], breakKey: string | undefined) {
  const messages = useT();
  const saveFailed = messages.focus.breakReview.saveFailed;
  const progressText = useStudyProgressText();
  const drillWords = useRef(messages.learning.words.readingDrill);
  useEffect(() => {
    drillWords.current = messages.learning.words.readingDrill;
  }, [messages]);
  const [session, setSession] = useState<BreakSession>();
  const [saveError, setSaveError] = useState<string>();
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loadedKey = session?.key;

  useEffect(() => {
    if (!breakKey || breakKey === loadedKey || !projects.length) return;
    let cancelled = false;
    // Okunamazsa öneri yok: kartlar molanın bir eki, sayaç ona bağlı değil.
    readLibraryStudy(progressText.current)
      .then((study) => {
        if (cancelled) return;
        const cards = dueCards(reviewCards(projects, study, drillWords.current), new Date().toISOString(), BREAK_REVIEW_SIZE);
        setSession({ key: breakKey, cards, study, index: 0, results: [], open: false, closed: false });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [breakKey, loadedKey, projects, progressText]);

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
        await putStudyProgress(card.projectId, next, progressText.current);
        setSaveError(undefined);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : saveFailed);
      }
    });
  }, [progressText, saveFailed, session]);

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
  const { language, t: messages } = useUiLanguage();
  const t = messages.focus.breakReview;
  const { session } = review;
  if (!session) return null;
  const count = session.cards.length;

  if (!session.open) {
    return (
      <section className="focus-offer break-review" aria-label={t.region}>
        <Layers size={20} aria-hidden="true" />
        <div>
          <strong>{t.due(count)}</strong>
          <p>{t.offer(count)}</p>
        </div>
        <div className="focus-offer-actions">
          <button type="button" className="focus-primary" onClick={review.begin}>{t.review(count)}</button>
          <button type="button" className="focus-secondary" onClick={review.close}>{t.justRest}</button>
        </div>
      </section>
    );
  }

  const card = session.cards[session.index];
  const project = card ? projects.find((item) => item.id === card.projectId) : undefined;
  if (!card || !project) {
    const remembered = session.results.filter(Boolean).length;
    return (
      <section className="break-review is-done" aria-label={t.region}>
        <p role="status">
          {session.results.length ? t.remembered(remembered, session.results.length) : t.skipped}{" "}
          {review.live ? t.enjoy : ""}
        </p>
        <button type="button" className="focus-secondary" onClick={review.close}>{messages.common.close}</button>
      </section>
    );
  }

  return (
    <LanguageProvider language={card.language} ui={language}>
      <section className="break-review is-open" aria-label={t.region} style={{ "--accent": project.story.accent } as React.CSSProperties}>
        <header className="break-review-head">
          <span className="review-kind">{messages.focus.cardKinds[card.kind]}</span>
          <span className="break-review-paper" lang={card.language}>{card.paperTitle}</span>
          <span className="review-count">{session.index + 1} / {count}</span>
          <button type="button" className="break-review-close" onClick={review.close} aria-label={t.stop} title={t.stop}><X size={15} /></button>
        </header>
        <ReviewCardBody key={card.key} card={card} project={project} graded={Boolean(session.grade)} onMark={review.mark} />
        <footer className="review-card-foot">
          {session.grade ? (
            <>
              <p role="status">{t.graded(session.grade.remembered)} {t.comesBack(session.grade.due, session.grade.at)}</p>
              <button type="button" className="review-next" onClick={review.next}>
                {session.index + 1 < count ? t.nextCard : messages.common.done} <ArrowRight size={14} />
              </button>
            </>
          ) : (
            <button type="button" className="review-skip" onClick={review.next}>{t.skip}</button>
          )}
        </footer>
        {review.saveError ? <p className="regen-error" role="status">{t.notSaved(review.saveError)}</p> : null}
      </section>
    </LanguageProvider>
  );
}
