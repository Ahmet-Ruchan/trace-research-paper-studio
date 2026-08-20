import { useState } from "react";
import type { Claim, Quiz } from "@/lib/schema";

type Answers = Record<string, number[]>;

/**
 * Anlama kontrolü. Her soru kanıta bağlıdır: yanıtladıktan sonra hem şık
 * açıklaması hem de dayandığı iddianın sayfası ve alıntısı gösterilir.
 *
 * Not: doğru yanıtlar JSON içinde açıkça durur. Bu bilinçli bir takas —
 * proje taşınabilir ve denetlenebilir olmak zorunda; bu bir sınav değil,
 * öğrenme aracıdır.
 */
export function QuizView({ quiz, claims }: { quiz: Quiz; claims: Claim[] }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const scored = quiz.questions.filter((question) => checked[question.id]);
  const correctCount = scored.filter((question) => isCorrect(question, answers[question.id] ?? [])).length;

  return (
    <section className="quiz" aria-label={quiz.title}>
      <header className="quiz-head">
        <h3>{quiz.title}</h3>
        <p>{quiz.intro}</p>
        {scored.length ? (
          <p className="quiz-score">
            {correctCount} / {scored.length} doğru
          </p>
        ) : null}
      </header>

      <ol className="quiz-list">
        {quiz.questions.map((question, index) => {
          const selected = answers[question.id] ?? [];
          const isChecked = Boolean(checked[question.id]);
          const multi = question.kind === "multi";
          const correct = isCorrect(question, selected);

          return (
            <li key={question.id} className="quiz-question">
              <p className="quiz-prompt">
                <span className="quiz-index">{String(index + 1).padStart(2, "0")}</span>
                {question.prompt}
              </p>

              <ul className="quiz-options">
                {question.options.map((option, optionIndex) => {
                  const picked = selected.includes(optionIndex);
                  const state = !isChecked
                    ? ""
                    : option.correct
                      ? "is-correct"
                      : picked
                        ? "is-wrong"
                        : "";
                  return (
                    <li key={optionIndex} className={`quiz-option ${state}`}>
                      <label>
                        <input
                          type={multi ? "checkbox" : "radio"}
                          name={question.id}
                          checked={picked}
                          disabled={isChecked}
                          onChange={() =>
                            setAnswers((previous) => ({
                              ...previous,
                              [question.id]: multi
                                ? toggle(previous[question.id] ?? [], optionIndex)
                                : [optionIndex],
                            }))
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                      {isChecked && (picked || option.correct) ? (
                        <small className="quiz-explanation">{option.explanation}</small>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {!isChecked ? (
                <button
                  type="button"
                  className="quiz-check"
                  disabled={selected.length === 0}
                  onClick={() => setChecked((previous) => ({ ...previous, [question.id]: true }))}
                >
                  Yanıtı kontrol et
                </button>
              ) : (
                <div className={correct ? "quiz-verdict is-correct" : "quiz-verdict is-wrong"}>
                  <strong>{correct ? "Doğru" : "Yanlış"}</strong>
                  <QuizEvidence question={question} claims={claims} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function QuizEvidence({ question, claims }: { question: Quiz["questions"][number]; claims: Claim[] }) {
  const linked = question.claimIds
    .map((id) => claims.find((claim) => claim.id === id))
    .filter((claim): claim is Claim => Boolean(claim));

  if (!linked.length) return null;

  return (
    <details className="evidence-note">
      <summary>
        Kanıtı gör
        {question.page ? ` · s. ${question.page}` : ""}
      </summary>
      {linked.map((claim) => (
        <div key={claim.id}>
          <p>{claim.statement}</p>
          <blockquote>{claim.sourceRefs[0]?.excerpt}</blockquote>
        </div>
      ))}
    </details>
  );
}

function toggle(values: number[], index: number): number[] {
  return values.includes(index) ? values.filter((value) => value !== index) : [...values, index];
}

function isCorrect(question: Quiz["questions"][number], selected: number[]): boolean {
  const expected = question.options
    .map((option, index) => (option.correct ? index : -1))
    .filter((index) => index >= 0);
  if (selected.length !== expected.length) return false;
  return expected.every((index) => selected.includes(index));
}
