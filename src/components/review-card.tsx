"use client";

import { useState } from "react";
import { ConceptBody, QuizView } from "@/visuals";
import type { ReviewCard } from "@/lib/review-queue";
import type { ResearchProject } from "@/lib/schema";

/**
 * Bir tekrar kartının içi. Soru çalışmadaki gibi yanıtlanıyor; yalnızca ilk
 * denemede doğru yanıt "hatırlandı" sayılıyor. Kavramda okuyucu önce kendisi
 * hatırlamaya çalışıyor, sonra açıp dürüstçe işaretliyor.
 *
 * Tekrar ekranı ve moladaki kısa tekrar aynı kartı kullanıyor. Kart
 * değişince çağıran `key` veriyor; açılmış yanıt bir sonraki karta taşınmıyor.
 */
export function ReviewCardBody({ card, project, graded, onMark }: { card: ReviewCard; project: ResearchProject; graded: boolean; onMark: (remembered: boolean) => void }) {
  const [revealed, setRevealed] = useState(false);
  if (card.kind === "question") {
    return (
      <QuizView
        quiz={{ title: "", intro: "", questions: [card.question] }}
        claims={project.evidence.claims}
        onResult={(_, result) => onMark(result.correct && result.attempts === 1)}
      />
    );
  }
  return (
    <div className="review-concept">
      <p className="review-prompt">What does it mean, and why does this paper need it?</p>
      <h2 lang={card.language}>{card.concept.term}</h2>
      {revealed ? (
        <div className="primer-body" lang={card.language}>
          <ConceptBody concept={card.concept} prerequisites={[]} />
        </div>
      ) : (
        <button className="quiz-check" onClick={() => setRevealed(true)}>Show the answer</button>
      )}
      {revealed && !graded ? (
        <div className="review-grade" role="group" aria-label="Did you remember it?">
          <button onClick={() => onMark(true)}>I remembered it</button>
          <button onClick={() => onMark(false)}>Not yet</button>
        </div>
      ) : null}
    </div>
  );
}
