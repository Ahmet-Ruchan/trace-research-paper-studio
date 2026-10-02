"use client";

import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { useUiLanguage } from "@/i18n/client";
import { uiLocale } from "@/i18n/languages";
import { libraryPaperFor, suggestReferences, type ConceptLink, type ReferenceSuggestion } from "@/lib/concept-links";
import { loadCitationGraph } from "@/lib/paper-lookup";
import type { ReadFirst } from "@/lib/reading-order";
import type { ResearchProject } from "@/lib/schema";
import { PaperLink, paperHref } from "./concept-note";
import { ReadLaterButton } from "./reading-list";

type Lookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; suggestions: ReferenceSuggestion[]; references: number }
  | { status: "failed"; message: string };

/**
 * Lab'de "Concepts": makalenin varsaydığı kavramlar ve kütüphanedeki izleri
 * (bkz. `concept-links.ts`). Henüz hiçbir yerde çalışılmamış kavramlar için
 * makalenin kaynakları arasında o kavramı başlığında anan çalışmalar
 * aranıyor. Bu bir başlık eşleşmesi, çalışmanın niteliği hakkında bir yargı
 * değil; panel bunu söylüyor. Önerilen çalışma kütüphanede zaten varsa
 * analiz yerine o makale açılıyor.
 */
export function ConceptsView({
  project,
  links,
  readFirst = [],
  library = [],
  onAnalyse,
}: {
  project: ResearchProject;
  links: readonly ConceptLink[];
  /** Kütüphanede bu makalenin varsaydığını tanımlayan makaleler (`reading-order.ts`). */
  readFirst?: readonly ReadFirst[];
  library?: readonly ResearchProject[];
  onAnalyse?: (work: { identifier: string; title: string }) => void;
}) {
  const { language, t: messages } = useUiLanguage();
  const t = messages.learning.conceptsView;
  const studyStatus = messages.learning.studyStatus;
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const studiedHere = links.filter((link) => link.here?.studied).length;
  const studiedElsewhere = links.filter((link) => !link.here?.studied && link.studiedIn).length;
  const inOtherPapers = links.filter((link) => !link.here?.studied && !link.studiedIn && link.elsewhere.length).length;
  const unknown = links.filter((link) => !link.here?.studied && !link.studiedIn);

  async function look() {
    setLookup({ status: "loading" });
    try {
      const { paper } = project.evidence;
      const graph = await loadCitationGraph({ doi: paper.doi, title: paper.title, authors: paper.authors, limit: 50, abstracts: true });
      if (!graph.ok) throw new Error(graph.skipped ? t.noRecord(graph.skipped) : graph.error ?? t.referencesFailed);
      setLookup({ status: "done", suggestions: suggestReferences(links, graph.references), references: graph.references.length });
    } catch (error) {
      setLookup({ status: "failed", message: error instanceof Error ? error.message : t.referencesFailed });
    }
  }

  return (
    <div className="concepts">
      {readFirst.length ? (
        <section className="read-first" aria-label={t.readFirst}>
          <h4>{t.readFirst}</h4>
          <p>
            {t.readFirstNote(readFirst.length)}
          </p>
          <ul className="read-first-list">
            {readFirst.map((item) => (
              <li key={item.project.id} className={`is-${item.status}`}>
                <span className="read-first-paper">
                  <PaperLink projectId={item.project.id} title={item.project.evidence.paper.title} />
                  <small>
                    {item.project.evidence.paper.year ? `${item.project.evidence.paper.year} · ` : ""}{t.defines(item.concepts.map((concept) => concept.definedAs).join(", "))}
                  </small>
                </span>
                <span className="read-first-status">{studyStatus[item.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="concepts-summary" role="status">
        {t.summary(links.length, studiedHere, studiedElsewhere, inOtherPapers)}
      </p>
      <ul className="concept-rows">
        {links.map((link) => {
          const status = link.here?.studied
            ? { label: t.studiedHere, tone: "is-studied" }
            : link.studiedIn
              ? { label: t.studiedElsewhere, tone: "is-studied" }
              : link.elsewhere.length
                ? { label: t.inOtherPapers(link.elsewhere.length), tone: "is-elsewhere" }
                : { label: t.onlyHere, tone: "" };
          return (
            <li key={link.conceptId} className={status.tone}>
              <strong lang={project.language}>{link.term}</strong>
              <span className="concept-status">{status.label}</span>
              {link.elsewhere.length ? (
                <span className="concept-where">
                  {link.elsewhere.map((source, index) => (
                    <span key={source.projectId}>
                      {index ? " · " : ""}
                      <PaperLink projectId={source.projectId} title={source.paperTitle} />
                      {source.knowledge?.studied ? " ✓" : ""}
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <section className="concept-suggest" aria-label={t.suggestTitle}>
        <h4>{t.suggestTitle}</h4>
        <p>
          {t.suggestNote(unknown.length)}
        </p>
        {lookup.status === "idle" || lookup.status === "failed" ? (
          <button type="button" className="concept-look" onClick={() => { void look(); }} disabled={!unknown.length}>
            <Search size={14} /> {t.look}
          </button>
        ) : null}
        {lookup.status === "loading" ? <p role="status">{t.reading}</p> : null}
        {lookup.status === "failed" ? <p className="regen-error" role="alert">{lookup.message}</p> : null}
        {lookup.status === "done" ? (
          lookup.suggestions.length ? (
            <ul className="concept-suggestions">
              {lookup.suggestions.map((item) => {
                const owned = libraryPaperFor(item.reference, library.filter((paper) => paper.id !== project.id));
                return (
                  <li key={`${item.conceptId}-${item.reference.title}`}>
                    <span className="concept-for" lang={project.language}>{item.term}</span>
                    <span className="concept-work">
                      <strong>{item.reference.title}</strong>
                      <small>
                        {item.reference.year ?? "—"}
                        {item.reference.citationCount !== undefined ? t.cited(item.reference.citationCount.toLocaleString(uiLocale(language))) : ""}
                        {item.where === "title" ? t.titleNames(item.phrase) : t.abstractNames(item.phrase)}
                        {owned ? t.alreadyOwned : ""}
                      </small>
                      {item.excerpt ? <q className="concept-excerpt" cite={item.reference.url}>{item.excerpt}</q> : null}
                    </span>
                    <span className="concept-actions">
                      {owned ? (
                        <a className="concept-open" href={paperHref(owned.id)}>{t.openIt}</a>
                      ) : onAnalyse && item.reference.identifier ? (
                        <button type="button" onClick={() => onAnalyse({ identifier: item.reference.identifier!, title: item.reference.title })}>{t.analyze}</button>
                      ) : null}
                      {!owned ? <ReadLaterButton work={item.reference} from={{ projectId: project.id, relation: "concept", concept: item.term }} /> : null}
                      {item.reference.url ? (
                        <a href={item.reference.url} target="_blank" rel="noreferrer" aria-label={t.openWork(item.reference.title)}><ExternalLink size={13} /></a>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>{t.noneMatch(lookup.references)}</p>
          )
        ) : null}
      </section>
    </div>
  );
}
