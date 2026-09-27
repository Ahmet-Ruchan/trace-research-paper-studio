"use client";

import { useMemo } from "react";
import { ArrowLeft, ListOrdered, Waypoints } from "lucide-react";
import { libraryConceptIndex, sharedConcepts } from "@/lib/concept-links";
import { readingOrder } from "@/lib/reading-order";
import type { ResearchProject } from "@/lib/schema";
import { studyStatusLabel } from "./concepts-view";
import { useLibraryStudy } from "./study-progress";

/**
 * Kütüphanenin kavram haritası: birden çok makalenin anlattığı kavramlar ve
 * onları anlatan makaleler. Model yok; kavramlar adla eşleşiyor
 * (`concept-links.ts`). Çalışılmış bir kavram işaretli: okuyucu hangi
 * bağlantıların kendisinde zaten kurulu olduğunu görüyor.
 */
export function ConceptMapView({
  projects,
  onBack,
  onOpen,
}: {
  projects: ResearchProject[];
  onBack: () => void;
  onOpen: (project: ResearchProject) => void;
}) {
  const study = useLibraryStudy();
  const shared = useMemo(() => sharedConcepts(projects, study ?? new Map()), [projects, study]);
  const total = useMemo(() => libraryConceptIndex(projects).size, [projects]);
  const order = useMemo(() => readingOrder(projects, study ?? new Map()), [projects, study]);
  const byId = new Map(projects.map((project) => [project.id, project]));

  return (
    <main className="compare-page shared-concepts-page">
      <header className="library-header">
        <button className="brand" onClick={onBack} aria-label="Back to the library">
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> Library</button>
        </div>
      </header>

      <section className="compare-hero">
        <p className="landing-eyebrow"><span /> Concept map</p>
        <h1>{shared.length ? `${shared.length} ${shared.length === 1 ? "concept connects" : "concepts connect"} your papers.` : "No concept connects two papers yet."}</h1>
        <p>
          The concepts more than one paper in your library explains, from their primers and glossaries, matched by name.
          A check mark means you studied it in that paper. Spellings are compared loosely (case, hyphens, British and American
          endings, plurals), never by meaning, so two names for one idea stay apart. {total} names in all.
        </p>
      </section>

      {order.steps.length ? (
        <section className="reading-order" aria-label="A reading order">
          <div className="block-title"><ListOrdered size={16} /> A reading order</div>
          <p>
            Each paper comes after the papers that define, in their glossary, a concept it assumes. Where nothing decides, the
            older paper comes first.{" "}
            {order.unconnected
              ? `${order.unconnected === 1 ? "One paper is" : `${order.unconnected} papers are`} not connected to the others this way and ${order.unconnected === 1 ? "is" : "are"} left out.`
              : ""}
          </p>
          <ol>
            {order.steps.map((step) => {
              const next = step.project === order.next;
              return (
                <li key={step.project.id} className={`is-${step.status}${next ? " is-next" : ""}`}>
                  <div className="reading-head">
                    <button type="button" onClick={() => onOpen(step.project)}>{step.project.evidence.paper.title}</button>
                    <small>{step.project.evidence.paper.year}</small>
                    {next ? <strong className="reading-next">Next</strong> : null}
                    <span className="reading-status">{studyStatusLabel[step.status]}</span>
                  </div>
                  {step.after.map((item) => (
                    <p key={item.project.id} className="reading-why">
                      After <em>{item.project.evidence.paper.title}</em>: it assumes{" "}
                      {item.concepts.map((concept) => concept.term).join(", ")}, which that paper defines.
                    </p>
                  ))}
                  {step.together.length ? (
                    <p className="reading-why">
                      Read it alongside {step.together.map((item) => item.evidence.paper.title).join(" and ")}: each defines something
                      the other assumes.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {shared.length ? (
        <ul className="shared-concepts">
          {shared.map((concept) => (
            <li key={concept.key} className={concept.studied ? "is-studied" : ""}>
              <div className="shared-concept-head">
                <Waypoints size={15} aria-hidden="true" />
                <strong>{concept.term}</strong>
                <span>{concept.papers} papers</span>
              </div>
              <div className="shared-concept-papers">
                {concept.sources.map((source) => {
                  const project = byId.get(source.projectId);
                  return (
                    <button
                      key={source.projectId}
                      type="button"
                      className={source.knowledge?.studied ? "is-studied" : ""}
                      onClick={() => project && onOpen(project)}
                      title={source.definition}
                    >
                      {source.knowledge?.studied ? "✓ " : ""}{source.paperTitle}
                      <small>{source.kind === "primer" ? "primer" : "glossary"}{source.year ? ` · ${source.year}` : ""}</small>
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section className="review-empty">
          <Waypoints size={22} aria-hidden="true" />
          <p>Once two papers in your library explain the same concept, it appears here with both of them.</p>
          <button onClick={onBack}>Library</button>
        </section>
      )}
    </main>
  );
}
