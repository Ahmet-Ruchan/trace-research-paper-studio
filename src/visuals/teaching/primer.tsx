import { useState, type ReactNode } from "react";
import { useStrings } from "../language-context";
import type { Primer } from "@/lib/schema";
import { sectionMark } from "@/lib/reader-notes";
import { orderByPrerequisites } from "@/lib/study-path";
import { MathText } from "../math";

/**
 * Ön bilgi. Kavramlar ön koşul zincirine göre sıralanır: bir kavram, ona
 * dayanan kavramdan önce gelir. Böylece okuyucu listeyi baştan sona takip
 * edebilir.
 */
/**
 * `renderAction` stüdyoda kavram başına bir eylem (yeniden üretim) ekler;
 * `renderNote` kavramın kütüphanedeki başka makalelerde nerede çalışıldığını.
 * Görüntüleyici ikisini de vermez.
 */
export function PrimerView({
  primer,
  renderAction,
  renderNote,
  initialOpenId,
}: {
  primer: Primer;
  renderAction?: (conceptId: string) => ReactNode;
  renderNote?: (conceptId: string) => ReactNode;
  /** Açık başlayacak kavram (notlardan "Show it"); verilmezse ilki. */
  initialOpenId?: string;
}) {
  const t = useStrings();
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? primer.concepts[0]?.id ?? null);
  const ordered = orderByPrerequisites(primer.concepts);

  return (
    <section className="primer" aria-label={primer.title}>
      <header className="primer-head">
        <h3>{primer.title}</h3>
        <p>{primer.overview}</p>
      </header>

      <ol className="primer-list">
        {ordered.map((concept, index) => {
          const open = openId === concept.id;
          const prerequisites = prerequisiteTerms(primer, concept);
          return (
            <li key={concept.id} className={open ? "primer-item is-open" : "primer-item"}>
              <button type="button" onClick={() => setOpenId(open ? null : concept.id)} aria-expanded={open}>
                <span className="primer-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="primer-term">{concept.term}</span>
                <span className={`primer-level level-${concept.level}`}>{t.levels[concept.level]}</span>
              </button>
              {open ? (
                <div className="primer-body">
                  {/* Vurgu ve not için işaret (`reader-notes.ts`); Study'deki aynı kavramla aynı yer. */}
                  <div data-note-section={sectionMark("concept", concept.id)}>
                    <ConceptBody concept={concept} prerequisites={prerequisites} />
                  </div>
                  {renderNote?.(concept.id)}
                  {renderAction?.(concept.id)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function prerequisiteTerms(primer: Primer, concept: Primer["concepts"][number]) {
  return concept.prerequisiteIds.flatMap((id) => primer.concepts.find((item) => item.id === id)?.term ?? []);
}

/** Bir kavramın içeriği; ön bilgi listesi ve çalışma modu aynı biçimi kullanıyor. */
export function ConceptBody({ concept, prerequisites }: { concept: Primer["concepts"][number]; prerequisites: readonly string[] }) {
  const t = useStrings();
  return (
    <>
      <p className="primer-intuition">{concept.intuition}</p>
      {concept.formal ? (
        <div className="primer-formal">
          <MathText latex={concept.formal} display />
        </div>
      ) : null}
      <p className="primer-why">
        <strong>{t.whyItMatters}</strong> {concept.whyItMatters}
      </p>
      {prerequisites.length ? (
        <p className="primer-prereq">
          {t.readFirst} {prerequisites.join(", ")}
        </p>
      ) : null}
    </>
  );
}
