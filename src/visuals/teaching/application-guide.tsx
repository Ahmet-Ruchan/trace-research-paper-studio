import type { ApplicationGuide } from "@/lib/schema";
import { useStrings } from "../language-context";

/**
 * "Bunu kendi projemde nasıl kullanırım." Kod taslakları AÇIKLAYICIDIR —
 * Trace makale kodunu çalıştırmaz, çalıştırılabilir olduğunu da iddia etmez.
 */
export function ApplicationGuideView({ guide }: { guide: ApplicationGuide }) {
  const t = useStrings();
  return (
    <section className="app-guide" aria-label={guide.title}>
      <header className="app-guide-head">
        <h3>{guide.title}</h3>
        <p>{guide.overview}</p>
      </header>

      <ol className="guide-recipe">
        {guide.recipe.map((item, index) => (
          <li key={index}>
            <span className="guide-step-index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{item.step}</strong>
              <p>{item.detail}</p>
              {item.code ? (
                <pre className="guide-code">
                  <code data-language={item.code.language}>{item.code.source}</code>
                </pre>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {guide.hyperparameters.length ? (
        <div className="guide-block">
          <h4>{t.hyperparameters}</h4>
          <div className="guide-scroll">
            <table className="guide-table">
              <thead>
                <tr>
                  <th scope="col">{t.guideParameter}</th>
                  <th scope="col">{t.guidePaperValue}</th>
                  <th scope="col">{t.guideRange}</th>
                  <th scope="col">{t.guideHowToChoose}</th>
                </tr>
              </thead>
              <tbody>
                {guide.hyperparameters.map((item) => (
                  <tr key={item.name}>
                    <th scope="row"><code>{item.name}</code></th>
                    <td>{item.paperValue}</td>
                    <td>{item.range}</td>
                    <td>{item.guidance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {guide.pitfalls.length ? (
        <div className="guide-block">
          <h4>{t.pitfalls}</h4>
          <ul className="guide-pitfalls">
            {guide.pitfalls.map((pitfall, index) => (
              <li key={index}>
                <strong className="pitfall-symptom">{pitfall.symptom}</strong>
                <p className="pitfall-cause">
                  <em>{t.pitfallCause}</em> {pitfall.cause}
                </p>
                <p className="pitfall-fix">
                  <em>{t.pitfallFix}</em> {pitfall.fix}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="guide-block guide-warning">
        <h4>{t.whenNotToUse}</h4>
        <ul>
          {guide.whenNotToUse.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
