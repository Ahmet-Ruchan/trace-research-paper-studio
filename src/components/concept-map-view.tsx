"use client";

import { useMemo } from "react";
import { ArrowLeft, Waypoints } from "lucide-react";
import { libraryConceptIndex, sharedConcepts } from "@/lib/concept-links";
import type { ResearchProject } from "@/lib/schema";
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
