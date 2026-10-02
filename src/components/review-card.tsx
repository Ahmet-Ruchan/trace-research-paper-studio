"use client";

import { useState } from "react";
import { ConceptBody, QuizView } from "@/visuals";
import { clozeMatches } from "@/lib/highlight-cards";
import type { ReviewCard } from "@/lib/review-queue";
import type { ResearchProject } from "@/lib/schema";
import { useT } from "@/i18n/client";

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
  const t = useT().paper.reviewCard;
  const { text, at, answer, where } = card.cloze;
  const open = Boolean(outcome);
  return (
    <div className="review-cloze">
      <p className="review-prompt">{t.fillBlank(where)}</p>
      <blockquote lang={card.language}>
        {text.slice(0, at)}
        <span className={`cloze-blank${open ? " is-open" : ""}`}>{open ? answer : <span aria-label={t.blank}>_____</span>}</span>
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
          <input value={typed} onChange={(event) => setTyped(event.target.value)} aria-label={t.missingWord} placeholder={t.missingWord} autoComplete="off" lang={card.language} />
          <button type="submit" className="quiz-check" disabled={!typed.trim()}>{t.check}</button>
          <button type="button" className="cloze-show" onClick={() => setOutcome("shown")}>{t.showAnswer}</button>
        </form>
      ) : null}
      {outcome === "wrong" ? <p className="cloze-said">{t.youWrote(typed.trim())}</p> : null}
      {outcome && outcome !== "right" && !graded ? (
        <div className="review-grade" role="group" aria-label={t.rememberAria}>
          <button onClick={() => onMark(true)}>{outcome === "wrong" ? t.hadIt : t.remembered}</button>
          <button onClick={() => onMark(false)}>{t.notYet}</button>
        </div>
      ) : null}
    </div>
  );
}

export function ReviewCardBody({ card, project, graded, onMark }: { card: ReviewCard; project: ResearchProject; graded: boolean; onMark: (remembered: boolean) => void }) {
  const [revealed, setRevealed] = useState(false);
  const t = useT().paper.reviewCard;
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
      <p className="review-prompt">{t.conceptPrompt}</p>
      <h2 lang={card.language}>{card.concept.term}</h2>
      {revealed ? (
        <div className="primer-body" lang={card.language}>
          <ConceptBody concept={card.concept} prerequisites={[]} />
        </div>
      ) : (
        <button className="quiz-check" onClick={() => setRevealed(true)}>{t.showAnswer}</button>
      )}
      {revealed && !graded ? (
        <div className="review-grade" role="group" aria-label={t.rememberAria}>
          <button onClick={() => onMark(true)}>{t.remembered}</button>
          <button onClick={() => onMark(false)}>{t.notYet}</button>
        </div>
      ) : null}
    </div>
  );
}
