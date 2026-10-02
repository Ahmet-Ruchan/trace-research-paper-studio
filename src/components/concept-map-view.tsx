"use client";

import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, ListOrdered, Waypoints } from "lucide-react";
import { useT } from "@/i18n/client";
import { conceptKeys, libraryConceptIndex, sharedConcepts } from "@/lib/concept-links";
import { mergeReadingOrder } from "@/lib/reading-list";
import { readingOrder } from "@/lib/reading-order";
import type { ResearchProject } from "@/lib/schema";
import { ConceptAliasesPanel } from "./concept-aliases-panel";
import { useConceptAliases, useLibraryStudy } from "./study-progress";
import { StudioNav } from "./focus/studio-nav";
import { SavedWork, useReadingList } from "./reading-list";
import { ReadingImportPanel } from "./reading-import-panel";
import { ReadingSharePanel } from "./reading-share-panel";

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
  const learning = useT().learning;
  const t = learning.conceptMap;
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
        <button className="brand" onClick={onBack} aria-label={learning.shell.backToLibrary}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>{learning.shell.brandTagline}</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> {learning.shell.library}</button>
          <StudioNav />
        </div>
      </header>

      <section className="compare-hero">
        <p className="landing-eyebrow"><span /> {t.eyebrow}</p>
        <h1>{t.heading(shared.length)}</h1>
        <p>
          {t.intro(total)}
        </p>
      </section>

      {/* Liste boşken de duruyor: Zotero'dan içe aktarma buradan başlıyor. */}
        <section ref={readingRef} className="reading-order" aria-label={t.orderTitle}>
          <div className="block-title"><ListOrdered size={16} /> {t.orderTitle}</div>
          {!order.steps.length && !merged.others.length ? (
            <p>
              {t.orderEmpty}
            </p>
          ) : (
          <p>
            {t.orderNote}{" "}
            {order.unconnected ? t.unconnected(order.unconnected) : ""}
          </p>
          )}
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
                      {next ? <strong className="reading-next">{t.next}</strong> : null}
                      <span className="reading-status">{learning.studyStatus[step.status]}</span>
                    </div>
                    {step.after.map((item) => (
                      <p key={item.project.id} className="reading-why">
                        {t.after.before}<em>{item.project.evidence.paper.title}</em>{t.after.rest(item.concepts.map((concept) => concept.term).join(", "))}
                      </p>
                    ))}
                    {step.together.length ? (
                      <p className="reading-why">
                        {t.together(step.together.map((item) => item.evidence.paper.title))}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {merged.others.length ? (
            <>
              <h3 className="reading-others">{merged.entries.length ? t.alsoOnList : t.yourList}</h3>
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
          {reading?.ready && reading.items.length ? <ReadingSharePanel saved={reading.items.length} /> : null}
          <ReadingImportPanel projects={projects} />
        </section>

      <ConceptAliasesPanel aliases={aliases} />

      {shared.length ? (
        <ul className="shared-concepts">
          {shared.map((concept) => (
            <li key={concept.key} className={concept.studied ? "is-studied" : ""}>
              <div className="shared-concept-head">
                <Waypoints size={15} aria-hidden="true" />
                <strong>{concept.term}</strong>
                <span>{t.papers(concept.papers)}</span>
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
                        {source.kind === "primer" ? t.primer : t.glossary}{source.year ? ` · ${source.year}` : ""}
                        {otherName(concept.term, source.term) ? t.as(source.term) : ""}
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
          <p>{t.empty}</p>
          <button onClick={onBack}>{learning.shell.library}</button>
        </section>
      )}
    </main>
  );
}
