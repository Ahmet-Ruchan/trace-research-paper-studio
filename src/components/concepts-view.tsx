"use client";

import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { libraryPaperFor, suggestReferences, type ConceptLink, type ReferenceSuggestion } from "@/lib/concept-links";
import { loadCitationGraph } from "@/lib/paper-lookup";
import type { ReadFirst, StudyStatus } from "@/lib/reading-order";
import type { ResearchProject } from "@/lib/schema";
import { PaperLink, paperHref } from "./concept-note";

type Lookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; suggestions: ReferenceSuggestion[]; references: number }
  | { status: "failed"; message: string };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export const studyStatusLabel: Record<StudyStatus, string> = { finished: "Studied", started: "Studying", new: "Not studied yet" };

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
      if (!graph.ok) throw new Error(graph.skipped ? `OpenAlex has no certain record of this paper (${graph.skipped}).` : graph.error ?? "The references could not be loaded.");
      setLookup({ status: "done", suggestions: suggestReferences(links, graph.references), references: graph.references.length });
    } catch (error) {
      setLookup({ status: "failed", message: error instanceof Error ? error.message : "The references could not be loaded." });
    }
  }

  return (
    <div className="concepts">
      {readFirst.length ? (
        <section className="read-first" aria-label="Read first">
          <h4>Read first</h4>
          <p>
            {readFirst.length === 1
              ? "One paper in your library defines, in its glossary, concepts this paper assumes. Reading it first"
              : `${readFirst.length} papers in your library define, in their glossaries, concepts this paper assumes. Reading them first`}{" "}
            means this one builds on something you know.
          </p>
          <ul className="read-first-list">
            {readFirst.map((item) => (
              <li key={item.project.id} className={`is-${item.status}`}>
                <span className="read-first-paper">
                  <PaperLink projectId={item.project.id} title={item.project.evidence.paper.title} />
                  <small>
                    {item.project.evidence.paper.year ? `${item.project.evidence.paper.year} · ` : ""}defines{" "}
                    {item.concepts.map((concept) => concept.definedAs).join(", ")}
                  </small>
                </span>
                <span className="read-first-status">{studyStatusLabel[item.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="concepts-summary" role="status">
        Of {plural(links.length, "concept")} this paper assumes, you studied {studiedHere} here and {studiedElsewhere} in other papers;
        {" "}{inOtherPapers} {inOtherPapers === 1 ? "is" : "are"} explained in other papers you have not studied yet.
      </p>
      <ul className="concept-rows">
        {links.map((link) => {
          const status = link.here?.studied
            ? { label: "Studied here", tone: "is-studied" }
            : link.studiedIn
              ? { label: "Studied in another paper", tone: "is-studied" }
              : link.elsewhere.length
                ? { label: `In ${plural(link.elsewhere.length, "other paper")}, not studied yet`, tone: "is-elsewhere" }
                : { label: "Only in this paper", tone: "" };
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

      <section className="concept-suggest" aria-label="Papers that teach what you have not studied yet">
        <h4>Papers that teach what you have not studied yet</h4>
        <p>
          Looks through the works this paper cites (the 50 most-cited, from OpenAlex) for a title, then an abstract, that names one
          of the {plural(unknown.length, "concept")} you have not studied in any paper. It is a match on the words, not a judgement
          of the work, and an abstract match shows the sentence it rests on: open the work and decide.
        </p>
        {lookup.status === "idle" || lookup.status === "failed" ? (
          <button type="button" className="concept-look" onClick={() => { void look(); }} disabled={!unknown.length}>
            <Search size={14} /> Look in the references
          </button>
        ) : null}
        {lookup.status === "loading" ? <p role="status">Reading the reference list…</p> : null}
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
                        {item.reference.citationCount !== undefined ? ` · cited ${item.reference.citationCount.toLocaleString("en")} times` : ""}
                        {item.where === "title" ? ` · the title names “${item.phrase}”` : ` · its abstract names “${item.phrase}”`}
                        {owned ? " · already in your library" : ""}
                      </small>
                      {item.excerpt ? <q className="concept-excerpt" cite={item.reference.url}>{item.excerpt}</q> : null}
                    </span>
                    <span className="concept-actions">
                      {owned ? (
                        <a className="concept-open" href={paperHref(owned.id)}>Open it</a>
                      ) : onAnalyse && item.reference.identifier ? (
                        <button type="button" onClick={() => onAnalyse({ identifier: item.reference.identifier!, title: item.reference.title })}>Analyze it</button>
                      ) : null}
                      {item.reference.url ? (
                        <a href={item.reference.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.reference.title}`}><ExternalLink size={13} /></a>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>None of the {plural(lookup.references, "reference")} OpenAlex lists names these concepts in its title or abstract.</p>
          )
        ) : null}
      </section>
    </div>
  );
}
