import { useState, type ReactNode } from "react";
import { useStrings } from "../language-context";
import { sectionHash } from "@/lib/deep-link";
import type { Claim, Quiz } from "@/lib/schema";

type Question = Quiz["questions"][number];

/** Bir sorunun durumu: kaç kez denendi, çözüldü mü, yanıt gösterildi mi. */
type Progress = { attempts: number; solved: boolean; revealed: boolean };

/** "Makalede nerede" bağlantıları için hikâye bölümlerinin gereken kısmı. */
export type QuizSection = { id: string; indexLabel?: string; title: string; claimIds: readonly string[] };

/**
 * Anlama kontrolü. Her soru kanıta bağlıdır.
 *
 * İlk yanlışta doğru şık gösterilmiyor: okuyucu seçtiği şıkkın neden yanlış
 * olduğunu ve makalede nereye bakacağını görüyor, sonra yeniden deniyor ya da
 * yanıtı açıyor. Yanıtı hemen göstermek soruyu bir okuma parçasına
 * çeviriyordu; ikinci deneme hatırlamayı çalıştırıyor. Puan ilk denemede
 * doğru yapılanları sayıyor.
 *
 * Not: doğru yanıtlar JSON içinde açıkça durur. Bu bilinçli bir takas —
 * proje taşınabilir ve denetlenebilir olmak zorunda; bu bir sınav değil,
 * öğrenme aracıdır.
 */
export function QuizView({
  quiz,
  claims,
  sections = [],
  renderAction,
}: {
  quiz: Quiz;
  claims: Claim[];
  /** Verilirse her soru, aynı iddialara dayanan hikâye bölümüne bağlanıyor. */
  sections?: readonly QuizSection[];
  renderAction?: (questionId: string) => ReactNode;
}) {
  const t = useStrings();
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  // Yanlış bir denemenin ardından şıklar "Try again" denene kadar kilitli.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const attempted = quiz.questions.filter((question) => progress[question.id]?.attempts);
  const firstTry = attempted.filter((question) => progress[question.id].solved && progress[question.id].attempts === 1).length;

  function check(question: Question) {
    const right = isCorrect(question, answers[question.id] ?? []);
    setProgress((previous) => {
      const current = previous[question.id] ?? { attempts: 0, solved: false, revealed: false };
      return { ...previous, [question.id]: { ...current, attempts: current.attempts + 1, solved: right } };
    });
    if (!right) setPending((previous) => ({ ...previous, [question.id]: true }));
  }

  return (
    <section className="quiz" aria-label={quiz.title}>
      <header className="quiz-head">
        <h3>{quiz.title}</h3>
        <p>{quiz.intro}</p>
        {attempted.length ? <p className="quiz-score">{t.score(firstTry, attempted.length)}</p> : null}
      </header>

      <ol className="quiz-list">
        {quiz.questions.map((question, index) => {
          const selected = answers[question.id] ?? [];
          const state = progress[question.id] ?? { attempts: 0, solved: false, revealed: false };
          const done = state.solved || state.revealed;
          const wrongNow = pending[question.id] && !done;
          const multi = question.kind === "multi";
          const reread = rereadSections(question, sections);

          return (
            <li key={question.id} className="quiz-question">
              <p className="quiz-prompt">
                <span className="quiz-index">{String(index + 1).padStart(2, "0")}</span>
                {question.prompt}
              </p>
              {renderAction?.(question.id)}

              <ul className="quiz-options">
                {question.options.map((option, optionIndex) => {
                  const picked = selected.includes(optionIndex);
                  // Doğru şık yalnızca çözülünce ya da yanıt açılınca işaretleniyor.
                  const mark = done
                    ? option.correct ? "is-correct" : picked ? "is-wrong" : ""
                    : wrongNow && picked && !option.correct ? "is-wrong" : "";
                  const explain = done ? picked || option.correct : wrongNow && picked && !option.correct;
                  return (
                    <li key={optionIndex} className={`quiz-option ${mark}`}>
                      <label>
                        <input
                          type={multi ? "checkbox" : "radio"}
                          name={question.id}
                          checked={picked}
                          disabled={done || wrongNow}
                          onChange={() =>
                            setAnswers((previous) => ({
                              ...previous,
                              [question.id]: multi ? toggle(previous[question.id] ?? [], optionIndex) : [optionIndex],
                            }))
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                      {explain ? <small className="quiz-explanation">{option.explanation}</small> : null}
                    </li>
                  );
                })}
              </ul>

              {!done && !wrongNow ? (
                <button type="button" className="quiz-check" disabled={selected.length === 0} onClick={() => check(question)}>
                  {state.attempts ? t.checkAgain : t.checkAnswer}
                </button>
              ) : null}

              {wrongNow ? (
                <div className="quiz-verdict is-wrong">
                  <strong>{t.notQuite}</strong>
                  {multi && selected.every((choice) => question.options[choice]?.correct) ? <div className="quiz-hint">{t.missingOption}</div> : null}
                  <Reread sections={reread} />
                  <div className="quiz-actions">
                    <button
                      type="button"
                      className="quiz-check"
                      onClick={() => {
                        setPending((previous) => ({ ...previous, [question.id]: false }));
                        setAnswers((previous) => ({ ...previous, [question.id]: [] }));
                      }}
                    >
                      {t.tryAgain}
                    </button>
                    <button
                      type="button"
                      className="quiz-reveal"
                      onClick={() => setProgress((previous) => ({ ...previous, [question.id]: { ...state, revealed: true } }))}
                    >
                      {t.showAnswer}
                    </button>
                  </div>
                </div>
              ) : null}

              {done ? (
                <div className={state.solved ? "quiz-verdict is-correct" : "quiz-verdict is-wrong"}>
                  <strong>{state.solved ? (state.attempts === 1 ? t.correct : t.correctAfter(state.attempts)) : t.answerShown}</strong>
                  <QuizEvidence question={question} claims={claims} />
                  <Reread sections={reread} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Sorunun dayandığı iddiaları kullanan hikâye bölümleri, anlatı sırasıyla; en fazla iki. */
export function rereadSections(question: Pick<Question, "claimIds">, sections: readonly QuizSection[]) {
  const wanted = new Set(question.claimIds);
  return sections.filter((section) => section.claimIds.some((id) => wanted.has(id))).slice(0, 2);
}

function Reread({ sections }: { sections: readonly QuizSection[] }) {
  const t = useStrings();
  if (!sections.length) return null;
  return (
    <div className="quiz-reread">
      <span>{t.whereToLook}</span>
      {sections.map((section) => (
        <a key={section.id} href={sectionHash(section.id)}>
          {section.indexLabel ? `${section.indexLabel} · ` : ""}{section.title}
        </a>
      ))}
    </div>
  );
}

function QuizEvidence({ question, claims }: { question: Question; claims: Claim[] }) {
  const t = useStrings();
  const linked = question.claimIds
    .map((id) => claims.find((claim) => claim.id === id))
    .filter((claim): claim is Claim => Boolean(claim));

  if (!linked.length) return null;

  return (
    <details className="evidence-note">
      <summary>
        {t.evidenceLabel}
        {question.page ? ` · ${t.page(question.page)}` : ""}
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

function isCorrect(question: Question, selected: number[]): boolean {
  const expected = question.options
    .map((option, index) => (option.correct ? index : -1))
    .filter((index) => index >= 0);
  if (selected.length !== expected.length) return false;
  return expected.every((index) => selected.includes(index));
}
