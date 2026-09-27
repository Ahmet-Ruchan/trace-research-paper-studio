import { useState, type ReactNode } from "react";
import { useStrings } from "../language-context";
import type { Derivation } from "@/lib/schema";
import { nextStepChoices } from "@/lib/predictions";
import { MathText } from "../math";

/**
 * Adım adım türetim. Adımlar tek tek açılır ve bir sonraki adım gösterilmeden
 * önce okuyucu adaylar arasından seçer: adayların hepsi bu türetimin doğru
 * cümleleri, yalnızca biri buradan çıkıyor. Seçmek istemeyen okuyucu "Just
 * show it" ile devam eder; son adımda seçilecek aday kalmadığı için düz bir
 * "sonraki adım" düğmesi var.
 */
export function DerivationView({ derivation, action }: { derivation: Derivation; action?: ReactNode }) {
  const t = useStrings();
  const [revealed, setRevealed] = useState(1);
  // Adım kimliği → okuyucunun o adım için seçtiği aday.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const total = derivation.steps.length;
  const allShown = revealed >= total;
  const choices = allShown ? undefined : nextStepChoices(derivation, revealed);
  const position = (id: string) => derivation.steps.findIndex((step) => step.id === id) + 1;
  const pickedSteps = Object.keys(picks);
  const called = pickedSteps.filter((id) => picks[id] === id).length;

  function pick(optionId: string) {
    const next = derivation.steps[revealed];
    if (!next) return;
    setPicks((previous) => ({ ...previous, [next.id]: optionId }));
    setRevealed((value) => value + 1);
  }

  return (
    <article className="derivation" aria-label={derivation.title}>
      <header className="derivation-head">
        <h4>{derivation.title}</h4>
        <p className="derivation-goal">
          <strong>{t.goal}</strong> {derivation.goal}
        </p>
        {action}
      </header>

      <ol className="derivation-steps">
        {derivation.steps.slice(0, revealed).map((step, index) => (
          <li key={step.id} className="derivation-step">
            <span className="derivation-step-index">{index + 1}</span>
            <div className="derivation-step-body">
              <MathText latex={step.latex} plain={step.plain} display />
              {picks[step.id] ? (
                <p className={picks[step.id] === step.id ? "derivation-verdict is-right" : "derivation-verdict is-wrong"}>
                  {picks[step.id] === step.id
                    ? t.stepCalled
                    : t.stepComesAt(derivation.steps.find((item) => item.id === picks[step.id])?.plain ?? "", position(picks[step.id]))}
                </p>
              ) : null}
              <p className="derivation-rationale">{step.rationale}</p>
              {step.shapes ? <code className="derivation-shapes">{step.shapes}</code> : null}
            </div>
          </li>
        ))}
      </ol>

      {!allShown && choices ? (
        <div className="derivation-predict" role="group" aria-label={t.nextStepQuestion}>
          <strong>{t.nextStepQuestion}</strong>
          <div className="derivation-options">
            {choices.options.map((option) => (
              <button key={option.id} type="button" className="derivation-option" onClick={() => pick(option.id)}>
                {option.text}
              </button>
            ))}
          </div>
          <button type="button" className="derivation-more" onClick={() => setRevealed((value) => value + 1)}>
            {t.justShowIt}
          </button>
        </div>
      ) : null}

      {!allShown && !choices ? (
        <button type="button" className="derivation-more" onClick={() => setRevealed((value) => value + 1)}>
          {t.nextStep(revealed, total)}
        </button>
      ) : null}

      {allShown && pickedSteps.length ? <p className="derivation-score">{t.stepsCalled(called, pickedSteps.length)}</p> : null}

      {allShown && derivation.numericExample ? (
        <div className="derivation-example">
          <h5>{t.numericExample}</h5>
          {derivation.numericExample.illustrative ? <span className="illustrative-note">{t.illustrativeValues}</span> : null}
          <p className="example-setup">{derivation.numericExample.setup}</p>
          <ol className="example-walkthrough">
            {derivation.numericExample.walkthrough.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
          <p className="example-result">
            <strong>{t.result}</strong> {derivation.numericExample.result}
          </p>
        </div>
      ) : null}
    </article>
  );
}
