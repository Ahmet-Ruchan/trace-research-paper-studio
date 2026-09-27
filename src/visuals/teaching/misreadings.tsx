import { useState } from "react";
import { useStrings } from "../language-context";
import { misreadingTrapLabels } from "@/lib/misreadings";
import type { Claim, Misreadings } from "@/lib/schema";

/**
 * Sık yapılan yanlış okumalar. Düzeltme hemen gösterilmiyor: okuyucu önce
 * cümleye bakıp neden yanlış olduğunu düşünüyor, sonra açıyor. Hazır verilen
 * bir düzeltme okunup geçiliyor; önce kendi başına fark etmeye çalışmak
 * ayrımı (ölçülen mi yorumlanan mı, denenen mi genellenen mi) öğretiyor.
 */
export function MisreadingsView({ misreadings, claims }: { misreadings: Misreadings; claims: readonly Claim[] }) {
  const t = useStrings();
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());

  return (
    <section className="misreadings" aria-label={misreadings.title}>
      <header className="quiz-head">
        <h3>{misreadings.title}</h3>
        <p>{misreadings.intro}</p>
      </header>
      <ol className="misreading-list">
        {misreadings.items.map((item) => {
          const open = shown.has(item.id);
          const linked = item.claimIds.flatMap((id) => claims.find((claim) => claim.id === id) ?? []);
          const page = linked.flatMap((claim) => claim.sourceRefs.flatMap((reference) => reference.page ?? []))[0];
          return (
            <li key={item.id} className={open ? "misreading is-open" : "misreading"}>
              <span className="misreading-trap">{misreadingTrapLabels[item.trap]}</span>
              <p className="misreading-text">
                <span className="misreading-label">{t.misreadingTempting}</span>{" "}
                <span className="misreading-sentence">{item.misreading}</span>
              </p>
              {open ? (
                <div className="misreading-correction">
                  <strong>{t.misreadingActually}</strong>
                  <p>{item.correction}</p>
                  {linked.length ? (
                    <details className="evidence-note">
                      <summary>
                        {t.evidenceLabel}
                        {page ? ` · ${t.page(page)}` : ""}
                      </summary>
                      {linked.map((claim) => (
                        <div key={claim.id}>
                          <p>{claim.statement}</p>
                          <blockquote>{claim.sourceRefs[0]?.excerpt}</blockquote>
                        </div>
                      ))}
                    </details>
                  ) : null}
                </div>
              ) : (
                <button type="button" className="misreading-reveal" onClick={() => setShown((previous) => new Set(previous).add(item.id))}>
                  {t.misreadingReveal}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
