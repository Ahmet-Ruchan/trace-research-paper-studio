"use client";

import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, ListOrdered, Waypoints } from "lucide-react";
import { conceptKeys, libraryConceptIndex, sharedConcepts } from "@/lib/concept-links";
import { mergeReadingOrder } from "@/lib/reading-list";
import { readingOrder } from "@/lib/reading-order";
import type { ResearchProject } from "@/lib/schema";
import { studyStatusLabel } from "./concepts-view";
import { ConceptAliasesPanel } from "./concept-aliases-panel";
import { useConceptAliases, useLibraryStudy } from "./study-progress";
import { StudioNav } from "./focus/studio-nav";
import { SavedWork, useReadingList } from "./reading-list";

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
  onAnalyse,
  focusReading = false,
}: {
  projects: ResearchProject[];
  onBack: () => void;
  onOpen: (project: ResearchProject) => void;
  /** Okuma listesindeki bir çalışmayı analiz etmek (ana ekrandaki arama). */
  onAnalyse?: (work: { identifier: string; title: string }) => void;
  /** Kütüphanedeki "Reading list" düğmesinden: okuma sırasına kaydırılarak açılıyor. */
  focusReading?: boolean;
}) {
  const study = useLibraryStudy();
  const aliases = useConceptAliases();
  const shared = useMemo(() => sharedConcepts(projects, study ?? new Map(), aliases.map), [projects, study, aliases.map]);
  const total = useMemo(() => libraryConceptIndex(projects, aliases.map).size, [projects, aliases.map]);
  const order = useMemo(() => readingOrder(projects, study ?? new Map(), aliases.map), [projects, study, aliases.map]);
  const reading = useReadingList();
  const merged = useMemo(() => mergeReadingOrder(order, reading?.items ?? [], projects), [order, reading?.items, projects]);
  const readingRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusReading && reading?.ready) readingRef.current?.scrollIntoView({ block: "start" });
  }, [focusReading, reading?.ready]);
  // Kartta başka bir adla geçen kaynak ("as …"): eşleşme okuyucunun bağından geliyor.
  const otherName = (cardTerm: string, sourceTerm: string) => conceptKeys(cardTerm)[0] !== conceptKeys(sourceTerm)[0];
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
          <StudioNav />
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

      {order.steps.length || merged.others.length ? (
        <section ref={readingRef} className="reading-order" aria-label="A reading order">
          <div className="block-title"><ListOrdered size={16} /> A reading order</div>
          <p>
            Each paper comes after the papers that define, in their glossary, a concept it assumes. Where nothing decides, the
            older paper comes first. Papers you saved to read later take their place: before the paper that builds on them or
            needs a concept they explain, after the paper they cite.{" "}
            {order.unconnected
              ? `${order.unconnected === 1 ? "One paper is" : `${order.unconnected} papers are`} not connected to the others this way and ${order.unconnected === 1 ? "is" : "are"} left out.`
              : ""}
          </p>
          {merged.entries.length ? (
            <ol>
              {merged.entries.map((entry) => {
                if (entry.kind === "saved") {
                  return (
                    <li key={`saved-${entry.place.item.id}`} className="is-saved">
                      <SavedWork place={entry.place} inOrder onOpen={onOpen} onAnalyse={onAnalyse} />
                    </li>
                  );
                }
                const step = entry.step;
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
          ) : null}
          {merged.others.length ? (
            <>
              <h3 className="reading-others">{merged.entries.length ? "Also on your reading list" : "Your reading list"}</h3>
              <ul className="reading-list">
                {merged.others.map((place) => (
                  <li key={place.item.id} className="is-saved">
                    <SavedWork place={place} inOrder={false} onOpen={onOpen} onAnalyse={onAnalyse} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {reading?.error ? <p className="regen-error" role="status">{reading.error}</p> : null}
        </section>
      ) : null}

      <ConceptAliasesPanel aliases={aliases} />

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
                      <small>
                        {source.kind === "primer" ? "primer" : "glossary"}{source.year ? ` · ${source.year}` : ""}
                        {otherName(concept.term, source.term) ? ` · as “${source.term}”` : ""}
                      </small>
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
