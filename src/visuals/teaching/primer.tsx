import { useState } from "react";
import { useStrings } from "../language-context";
import type { Primer } from "@/lib/schema";
import { MathText } from "../math";

/**
 * Ön bilgi. Kavramlar ön koşul zincirine göre sıralanır: bir kavram, ona
 * dayanan kavramdan önce gelir. Böylece okuyucu listeyi baştan sona takip
 * edebilir.
 */
export function PrimerView({ primer }: { primer: Primer }) {
  const t = useStrings();
  const [openId, setOpenId] = useState<string | null>(primer.concepts[0]?.id ?? null);
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
          const prerequisites = concept.prerequisiteIds
            .map((id) => primer.concepts.find((item) => item.id === id)?.term)
            .filter(Boolean);
          return (
            <li key={concept.id} className={open ? "primer-item is-open" : "primer-item"}>
              <button type="button" onClick={() => setOpenId(open ? null : concept.id)} aria-expanded={open}>
                <span className="primer-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="primer-term">{concept.term}</span>
                <span className={`primer-level level-${concept.level}`}>{t.levels[concept.level]}</span>
              </button>
              {open ? (
                <div className="primer-body">
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
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Ön koşulları önce gelecek şekilde topolojik sıralama. Doğrulayıcı döngüyü
 * zaten reddediyor; yine de burada ziyaret seti tutulur, böylece bozuk bir
 * veri sonsuz döngüye değil orijinal sıraya düşer.
 */
function orderByPrerequisites(concepts: Primer["concepts"]): Primer["concepts"] {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const result: Primer["concepts"] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();

  const visit = (concept: Primer["concepts"][number]) => {
    if (placed.has(concept.id) || visiting.has(concept.id)) return;
    visiting.add(concept.id);
    for (const id of concept.prerequisiteIds) {
      const prerequisite = byId.get(id);
      if (prerequisite) visit(prerequisite);
    }
    visiting.delete(concept.id);
    placed.add(concept.id);
    result.push(concept);
  };

  concepts.forEach(visit);
  return result.length === concepts.length ? result : concepts;
}
