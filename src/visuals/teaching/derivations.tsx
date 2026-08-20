import { useState } from "react";
import { useStrings } from "../language-context";
import type { Derivation } from "@/lib/schema";
import { MathText } from "../math";

/**
 * Adım adım türetim. Adımlar tek tek açılır: okuyucu bir sonraki satırı
 * görmeden önce kendi türetmeyi deneyebilir.
 */
export function DerivationView({ derivation }: { derivation: Derivation }) {
  const t = useStrings();
  const [revealed, setRevealed] = useState(1);
  const total = derivation.steps.length;
  const allShown = revealed >= total;

  return (
    <article className="derivation" aria-label={derivation.title}>
      <header className="derivation-head">
        <h4>{derivation.title}</h4>
        <p className="derivation-goal">
          <strong>{t.goal}</strong> {derivation.goal}
        </p>
      </header>

      <ol className="derivation-steps">
        {derivation.steps.slice(0, revealed).map((step, index) => (
          <li key={step.id} className="derivation-step">
            <span className="derivation-step-index">{index + 1}</span>
            <div className="derivation-step-body">
              <MathText latex={step.latex} plain={step.plain} display />
              <p className="derivation-rationale">{step.rationale}</p>
              {step.shapes ? <code className="derivation-shapes">{step.shapes}</code> : null}
            </div>
          </li>
        ))}
      </ol>

      {!allShown ? (
        <button type="button" className="derivation-more" onClick={() => setRevealed((value) => value + 1)}>
          {t.nextStep(revealed, total)}
        </button>
      ) : null}

      {allShown && derivation.numericExample ? (
        <div className="derivation-example">
          <h5>{t.numericExample}</h5>
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
