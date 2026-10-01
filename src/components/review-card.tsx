"use client";

import { useState } from "react";
import { ConceptBody, QuizView } from "@/visuals";
import { clozeMatches } from "@/lib/highlight-cards";
import type { ReviewCard } from "@/lib/review-queue";
import type { ResearchProject } from "@/lib/schema";

/**
 * Bir tekrar kartının içi. Soru çalışmadaki gibi yanıtlanıyor; yalnızca ilk
 * denemede doğru yanıt "hatırlandı" sayılıyor. Kavramda okuyucu önce kendisi
 * hatırlamaya çalışıyor, sonra açıp dürüstçe işaretliyor. Vurgu kartında
 * gizlenen kelime yazılıyor: tutarsa hatırlandı; tutmazsa yanıt açılıyor ve
 * okuyucu (yazım hatası olabilir) kendisi işaretliyor.
 *
 * Tekrar ekranı ve moladaki kısa tekrar aynı kartı kullanıyor. Kart
 * değişince çağıran `key` veriyor; açılmış yanıt bir sonraki karta taşınmıyor.
 */
function ClozeCard({ card, graded, onMark }: { card: Extract<ReviewCard, { kind: "highlight" }>; graded: boolean; onMark: (remembered: boolean) => void }) {
  const [typed, setTyped] = useState("");
  const [outcome, setOutcome] = useState<"right" | "wrong" | "shown">();
  const { text, at, answer, where } = card.cloze;
  const open = Boolean(outcome);
  return (
    <div className="review-cloze">
      <p className="review-prompt">Fill in the blank in your highlight{where ? ` from “${where}”` : ""}.</p>
      <blockquote lang={card.language}>
        {text.slice(0, at)}
        <span className={`cloze-blank${open ? " is-open" : ""}`}>{open ? answer : <span aria-label="blank">_____</span>}</span>
        {text.slice(at + answer.length)}
      </blockquote>
      {!open ? (
        <form
          className="cloze-answer"
          onSubmit={(event) => {
            event.preventDefault();
            if (!typed.trim()) return;
            const right = clozeMatches(typed, answer);
            setOutcome(right ? "right" : "wrong");
            if (right) onMark(true);
          }}
        >
          <input value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="The missing word" placeholder="The missing word" autoComplete="off" lang={card.language} />
          <button type="submit" className="quiz-check" disabled={!typed.trim()}>Check</button>
          <button type="button" className="cloze-show" onClick={() => setOutcome("shown")}>Show the answer</button>
        </form>
      ) : null}
      {outcome === "wrong" ? <p className="cloze-said">You wrote “{typed.trim()}”.</p> : null}
      {outcome && outcome !== "right" && !graded ? (
        <div className="review-grade" role="group" aria-label="Did you remember it?">
          <button onClick={() => onMark(true)}>{outcome === "wrong" ? "I had it" : "I remembered it"}</button>
          <button onClick={() => onMark(false)}>Not yet</button>
        </div>
      ) : null}
    </div>
  );
}

export function ReviewCardBody({ card, project, graded, onMark }: { card: ReviewCard; project: ResearchProject; graded: boolean; onMark: (remembered: boolean) => void }) {
  const [revealed, setRevealed] = useState(false);
  if (card.kind === "highlight") return <ClozeCard card={card} graded={graded} onMark={onMark} />;
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
