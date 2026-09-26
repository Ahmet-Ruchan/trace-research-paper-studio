"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Columns2, FileText, FileUp, Gauge, LayoutGrid, List, Plus, Quote, Search, Tag, Trash2, X } from "lucide-react";
import { MAX_MAP_PAPERS } from "@/lib/literature-map";
import {
  LIBRARY_LAYOUT_KEY,
  LIBRARY_SORT_KEY,
  librarySorts,
  parseLibraryLayout,
  parseLibrarySort,
  readStored,
  sortLibrary,
  writeStored,
  type LibraryLayout,
  type LibrarySort,
} from "@/lib/library-order";
import { buildClaimIndex, excerptAround, highlightSegments, searchClaims, type ClaimHit, type ClaimSearch } from "@/lib/library-search";
import { MAX_TAG_LENGTH, addTag, hasTag, removeTag, tagCounts, tagKey } from "@/lib/library-tags";
import { UNDO_WINDOW_MS } from "@/lib/pending-deletion";
import { listLibraryTags, saveProjectTags } from "@/lib/project-library";
import type { ResearchProject } from "@/lib/schema";
import { foldForSearch } from "@/lib/search-text";
import { claimKindLabels } from "./evidence-drawer";
import { DisplayControl } from "./display-control";

type LibraryViewProps = {
  projects: ResearchProject[];
  onOpen: (project: ResearchProject) => void;
  /** Bir arama sonucundan projeye, doğrudan o iddianın üstüne. */
  onOpenClaim: (project: ResearchProject, claimId: string) => void;
  /** Modellerin alıntı karnesi: kütüphanedeki bütün projelerden hesaplanıyor. */
  onModelRecord: () => void;
  /** Kart hemen kayboluyor; silme geri alma süresi dolunca sunucuya gidiyor. */
  onDelete: (projectId: string) => void;
  pendingDeletion?: ResearchProject;
  onUndoDelete: () => void;
  /** Bildirimi kapatmak: beklemeden sil. */
  onConfirmDelete: () => void;
  deleteError?: string;
  onDismissDeleteError: () => void;
  onHome: () => void;
  onNew: () => void;
  onImport: (file: File) => Promise<void>;
  /** İki proje yan yana karşılaştırılır; üç ve fazlası literatür haritasına gider. */
  onCompare: (projects: ResearchProject[]) => void;
};

type SearchScope = "papers" | "claims";

const TAG_OPTIONS_ID = "library-tag-options";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(value));
}

function generationLabel(project: ResearchProject) {
  const assignments = project.generation?.assignments;
  if (!assignments) return project.generation?.model;
  const models = new Set(Object.values(assignments).map((assignment) => `${assignment.provider}:${assignment.model}`));
  return models.size > 1 ? `${models.size}-model team` : [...models][0]?.split(":").slice(1).join(":");
}

function count(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

export function LibraryView({ projects, onOpen, onOpenClaim, onModelRecord, onDelete, pendingDeletion, onUndoDelete, onConfirmDelete, deleteError, onDismissDeleteError, onHome, onNew, onImport, onCompare }: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("papers");
  // Kütüphane yalnızca istemcide, açılış ekranından sonra çiziliyor; depolama okunabilir.
  const [sort, setSort] = useState<LibrarySort>(() => readStored(LIBRARY_SORT_KEY, parseLibrarySort));
  const [layout, setLayout] = useState<LibraryLayout>(() => readStored(LIBRARY_LAYOUT_KEY, parseLibraryLayout));
  /**
   * Karşılaştırma için seçim. İki proje yan yana iki sütuna sığıyor; üç ve
   * fazlası sütun değil zaman çizgisi olarak (literatür haritası) gösteriliyor.
   * Sınırı aşan tıklama en eski seçimi düşürüyor — kullanıcıyı önce bir şeyin
   * işaretini kaldırmaya zorlamak, bir kısıtı iş yüküne çevirmek olurdu.
   */
  const [selected, setSelected] = useState<string[]>([]);
  function toggleSelected(projectId: string) {
    setSelected((current) =>
      current.includes(projectId)
        ? current.filter((item) => item !== projectId)
        : [...current, projectId].slice(-MAX_MAP_PAPERS),
    );
  }
  const chosen = selected
    .map((id) => projects.find((project) => project.id === id))
    .filter((project): project is ResearchProject => Boolean(project));
  const [importError, setImportError] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null);

  const [tags, setTags] = useState<Map<string, string[]>>(() => new Map());
  const [activeTag, setActiveTag] = useState<string>();
  const [editingTags, setEditingTags] = useState<string>();
  const [tagDraft, setTagDraft] = useState("");
  /** Doğrulama hatası kartın içinde: sayfanın tepesindeki şerit, aşağıdaki bir kartı düzenlerken görünmüyor. */
  const [tagError, setTagError] = useState<string>();
  /**
   * Etiket kayıtları sıraya giriyor. Her istek listenin tamamını yazıyor;
   * arka arkaya iki ekleme sunucuya ters sırada varırsa ilki ikincisini
   * silerdi.
   */
  const tagSaves = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    listLibraryTags()
      .then((loaded) => { if (active) setTags(loaded); })
      .catch((error: unknown) => {
        if (active) setImportError(error instanceof Error ? error.message : "Could not read the library tags.");
      });
    return () => { active = false; };
  }, []);

  const tagSummary = useMemo(() => tagCounts(projects.map((project) => project.id), tags), [projects, tags]);
  const knownTags = useMemo(() => tagSummary.map((entry) => entry.tag), [tagSummary]);
  // Son makaleden de kaldırılan bir etiket artık bir koleksiyon değil; süzgeç kendiliğinden kalkıyor.
  const collection = activeTag ? knownTags.find((tag) => tagKey(tag) === tagKey(activeTag)) : undefined;
  const inCollection = useMemo(
    () => (collection ? projects.filter((project) => hasTag(tags.get(project.id), collection)) : projects),
    [projects, tags, collection],
  );

  const filtered = useMemo(() => {
    const needle = foldForSearch(query.trim());
    const ordered = sortLibrary(inCollection, sort);
    if (!needle) return ordered;
    return ordered.filter((project) =>
      foldForSearch(
        [
          project.evidence.paper.title,
          project.evidence.paper.authors.join(" "),
          project.evidence.paper.venue,
          ...(tags.get(project.id) ?? []),
        ].join(" "),
      ).includes(needle),
    );
  }, [inCollection, query, tags, sort]);

  const claimIndex = useMemo(() => (scope === "claims" ? buildClaimIndex(inCollection) : []), [scope, inCollection]);
  const claimSearch = useMemo(() => searchClaims(claimIndex, query), [claimIndex, query]);

  function persistTags(projectId: string, next: string[]) {
    setTags((current) => {
      const updated = new Map(current);
      if (next.length) updated.set(projectId, next);
      else updated.delete(projectId);
      return updated;
    });
    tagSaves.current = tagSaves.current
      .then(() => saveProjectTags(projectId, next))
      .catch(async (error: unknown) => {
        setImportError(error instanceof Error ? error.message : "Could not save the tags.");
        // Ekrandaki hâl kaydedilmemiş olabilir; sunucudakine dön.
        const loaded = await listLibraryTags().catch(() => undefined);
        if (loaded) setTags(loaded);
      });
  }

  function submitTag(projectId: string) {
    const current = tags.get(projectId) ?? [];
    const result = addTag(current, tagDraft, knownTags);
    if (!result.ok) {
      setTagError(result.error);
      return;
    }
    setTagError(undefined);
    setTagDraft("");
    if (result.tags.length !== current.length) persistTags(projectId, result.tags);
  }

  function startEditingTags(projectId: string) {
    setEditingTags(projectId);
    setTagDraft("");
    setTagError(undefined);
  }

  const toolbarCount = scope === "papers"
    ? count(filtered.length, "result")
    : claimSearch.terms.length
      ? `${count(claimSearch.total, "claim")} in ${count(claimSearch.papers, "paper")}`
      : count(claimIndex.length, "claim");

  return (
    <main className="library-page">
      <header className="library-header">
        <button className="brand" onClick={onHome} aria-label="Trace home">
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>research studio</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onHome}><ArrowLeft size={15} /> Home</button>
          <input ref={importRef} type="file" accept=".json,.trace.json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setImportError(undefined);
            void onImport(file).catch((error) => setImportError(error instanceof Error ? error.message : "Could not import the Trace project."));
          }} />
          <DisplayControl />
          <button className="library-import-button" title="How each model’s quotes held up" onClick={onModelRecord}><Gauge size={15} /> Model record</button>
          <button className="library-import-button" onClick={() => importRef.current?.click()}><FileUp size={15} /> Trace JSON</button>
          <button className="library-new-button" onClick={onNew}><Plus size={16} /> New paper</button>
        </div>
      </header>

      {importError && <div className="library-import-error">{importError}<button onClick={() => setImportError(undefined)}>Close</button></div>}
      {deleteError && <div className="library-import-error" role="alert">{deleteError} The project is back in the library.<button onClick={onDismissDeleteError}>Close</button></div>}

      <section className="library-hero">
        <div>
          <p className="landing-eyebrow"><span /> Personal research archive</p>
          <h1>Your paper library.</h1>
          <p>Every evidence map, deep report and interactive explanation you have produced, in one place.</p>
        </div>
        <div className="library-stat"><strong>{projects.length}</strong><span>saved projects</span></div>
      </section>

      <section className="library-toolbar">
        <div className="library-scope" role="group" aria-label="Search in">
          <button aria-pressed={scope === "papers"} onClick={() => setScope("papers")}>Papers</button>
          <button aria-pressed={scope === "claims"} onClick={() => setScope("claims")}>Claims</button>
        </div>
        <label>
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={scope === "papers" ? "Search papers" : "Search claims"}
            placeholder={scope === "papers" ? "Search title, author, venue or tag" : "Search what your papers claim"}
          />
        </label>
        {scope === "papers" && (
          <div className="library-arrange">
            <label>
              <span>Sort</span>
              <select value={sort} onChange={(event) => { const next = parseLibrarySort(event.target.value); setSort(next); writeStored(LIBRARY_SORT_KEY, next); }}>
                {librarySorts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <div className="library-layout" role="group" aria-label="Layout">
              {([["grid", "Grid", LayoutGrid], ["list", "List", List]] as const).map(([id, label, Icon]) => (
                <button key={id} aria-pressed={layout === id} aria-label={label} title={label} onClick={() => { setLayout(id); writeStored(LIBRARY_LAYOUT_KEY, id); }}>
                  <Icon size={15} />
                </button>
              ))}
            </div>
          </div>
        )}
        <span>{toolbarCount}</span>
      </section>

      {tagSummary.length > 0 && (
        <nav className="library-tags" aria-label="Collections">
          <button aria-pressed={!collection} onClick={() => setActiveTag(undefined)}>All papers <i>{projects.length}</i></button>
          {tagSummary.map((entry) => (
            <button
              key={tagKey(entry.tag)}
              aria-pressed={collection === entry.tag}
              onClick={() => setActiveTag(collection === entry.tag ? undefined : entry.tag)}
            >
              <Tag size={11} /> {entry.tag} <i>{entry.count}</i>
            </button>
          ))}
          {collection && inCollection.length >= 2 && inCollection.length <= MAX_MAP_PAPERS && (
            <button className="library-open library-collection-action" onClick={() => onCompare(inCollection)}>
              {inCollection.length > 2 ? `Map these ${inCollection.length} papers` : "Compare these two"} <ArrowRight size={14} />
            </button>
          )}
          {collection && inCollection.length > MAX_MAP_PAPERS && (
            <small>Select up to {MAX_MAP_PAPERS} of these to map them.</small>
          )}
        </nav>
      )}
      <datalist id={TAG_OPTIONS_ID}>
        {knownTags.map((tag) => <option key={tagKey(tag)} value={tag} />)}
      </datalist>

      {chosen.length > 0 && (
        <div className="compare-bar">
          <Columns2 size={16} />
          <span>
            {chosen.map((project) => project.evidence.paper.title).join("  ·  ")}
            {chosen.length === 1 ? "  ·  pick one more" : chosen.length < MAX_MAP_PAPERS ? `  ·  add up to ${MAX_MAP_PAPERS} for a literature map` : ""}
          </span>
          <div>
            <button className="text-button" onClick={() => setSelected([])}>Clear</button>
            <button className="library-open" disabled={chosen.length < 2} onClick={() => chosen.length >= 2 && onCompare(chosen)}>
              {chosen.length > 2 ? `Map ${chosen.length} papers` : "Compare"} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {projects.length > 0 && scope === "claims" ? (
        <ClaimResults search={claimSearch} claimCount={claimIndex.length} paperCount={inCollection.length} collection={collection} onOpenClaim={onOpenClaim} />
      ) : filtered.length ? (
        <section className={layout === "list" ? "library-grid is-list" : "library-grid"} aria-label="Papers">
          {filtered.map((project, index) => {
            const projectTags = tags.get(project.id) ?? [];
            const editing = editingTags === project.id;
            return (
              <article className={selected.includes(project.id) ? "library-card is-selected" : "library-card"} key={project.id} style={{ "--card-accent": project.story.accent } as React.CSSProperties}>
                <label className="library-select" title="Select for comparison">
                  <input type="checkbox" checked={selected.includes(project.id)} onChange={() => toggleSelected(project.id)} />
                  <span aria-hidden="true" />
                </label>
                <button className="library-card-main" onClick={() => onOpen(project)}>
                  <div className="library-cover">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <FileText size={25} />
                    <i />
                  </div>
                  <div className="library-card-copy">
                    <span>{project.evidence.paper.venue || "Research paper"} · {project.evidence.paper.year}</span>
                    <h2>{project.evidence.paper.title}</h2>
                    <p>{project.evidence.plainSummary}</p>
                    <div className="library-card-meta">
                      <span>{project.story.sections.length} story</span>
                      <span>{project.evidence.claims.length} claim</span>
                      {project.deepReport && <span>{project.deepReport.sections.length} report</span>}
                      {project.technicalAppendix && <span>technical appendix</span>}
                    </div>
                  </div>
                </button>
                <div className={editing ? "library-card-tags is-editing" : "library-card-tags"}>
                  {projectTags.map((tag) => editing ? (
                    <span className="library-tag" key={tagKey(tag)}>
                      {tag}
                      <button aria-label={`Remove the tag ${tag}`} onClick={() => persistTags(project.id, removeTag(projectTags, tag))}><X size={11} /></button>
                    </span>
                  ) : (
                    <button className="library-tag" key={tagKey(tag)} title="Show the papers with this tag" onClick={() => setActiveTag(tag)}>{tag}</button>
                  ))}
                  {editing ? (
                    <form onSubmit={(event) => { event.preventDefault(); submitTag(project.id); }}>
                      <input
                        autoFocus
                        list={TAG_OPTIONS_ID}
                        value={tagDraft}
                        maxLength={MAX_TAG_LENGTH}
                        onChange={(event) => { setTagDraft(event.target.value); setTagError(undefined); }}
                        onKeyDown={(event) => { if (event.key === "Escape") setEditingTags(undefined); }}
                        placeholder="Add a tag"
                        aria-label={`Add a tag to ${project.evidence.paper.title}`}
                      />
                      <button type="submit" disabled={!tagDraft.trim()}>Add</button>
                      <button type="button" onClick={() => setEditingTags(undefined)}>Done</button>
                      {tagError && <small className="library-tag-error" role="alert">{tagError}</small>}
                    </form>
                  ) : (
                    <button className="library-tag-edit" onClick={() => startEditingTags(project.id)}>
                      <Tag size={11} /> {projectTags.length ? "Edit tags" : "Add tags"}
                    </button>
                  )}
                </div>
                <footer>
                  <span>{formatDate(project.updatedAt)}{generationLabel(project) ? ` · ${generationLabel(project)}` : ""}</span>
                  <div>
                    <button className="library-delete" title="Delete from library" aria-label={`Delete ${project.evidence.paper.title} from the library`} onClick={() => {
                      setImportError(undefined);
                      onDelete(project.id);
                    }}><Trash2 size={15} /></button>
                    <button className="library-open" onClick={() => onOpen(project)}>Open <ArrowRight size={15} /></button>
                  </div>
                </footer>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="library-empty">
          <BookOpen size={30} />
          <h2>{projects.length ? "No paper matches your search." : "Your library is waiting for its first paper."}</h2>
          <p>Add a PDF, or import a Trace JSON produced by Codex, Claude Code or Antigravity CLI.</p>
          <button onClick={onNew}>Add a paper <ArrowRight size={16} /></button>
        </section>
      )}
      {pendingDeletion && <UndoToast key={pendingDeletion.id} project={pendingDeletion} onUndo={onUndoDelete} onConfirm={onConfirmDelete} />}
    </main>
  );
}

/**
 * Silmeden sonra birkaç saniye. Ctrl/⌘+Z da geri alıyor; bir metin kutusunun
 * içindeyken değil, orada kullanıcının kendi yazısını geri alıyor.
 */
function UndoToast({ project, onUndo, onConfirm }: { project: ResearchProject; onUndo: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        event.preventDefault();
        onUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo]);

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <i className="undo-toast-timer" style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }} aria-hidden="true" />
      <span>Deleted “{project.evidence.paper.title}” with its history.</span>
      <button className="undo-action" onClick={onUndo}>Undo</button>
      <button className="undo-dismiss" aria-label="Delete now" title="Delete now" onClick={onConfirm}><X size={15} /></button>
    </div>
  );
}

function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((segment, index) =>
        segment.match ? <mark key={index}>{segment.text}</mark> : <Fragment key={index}>{segment.text}</Fragment>,
      )}
    </>
  );
}

type ClaimResultsProps = {
  search: ClaimSearch;
  claimCount: number;
  paperCount: number;
  collection?: string;
  onOpenClaim: (project: ResearchProject, claimId: string) => void;
};

function ClaimResults({ search, claimCount, paperCount, collection, onOpenClaim }: ClaimResultsProps) {
  if (!search.terms.length) {
    return (
      <section className="library-empty">
        <Quote size={30} />
        <h2>Search what your papers claim.</h2>
        <p>
          Type a word or two to search the {count(claimCount, "claim")} of {count(paperCount, "paper")}
          {collection ? ` tagged “${collection}”` : ""}. Every match opens on its quote and page.
        </p>
      </section>
    );
  }
  if (!search.hits.length) {
    return (
      <section className="library-empty">
        <Quote size={30} />
        <h2>No claim mentions every word you typed.</h2>
        <p>The search reads the claims and their quotes, not the full text of the papers.</p>
      </section>
    );
  }
  return (
    <section className="claim-results" aria-label="Matching claims">
      {search.hits.map((hit) => (
        <ClaimResult key={JSON.stringify([hit.project.id, hit.claim.id])} hit={hit} terms={search.terms} onOpen={onOpenClaim} />
      ))}
      {search.total > search.hits.length && (
        <p className="claim-results-more">
          Showing the first {search.hits.length} of {search.total} claims. Add a word to narrow the search.
        </p>
      )}
    </section>
  );
}

function ClaimResult({ hit, terms, onOpen }: { hit: ClaimHit; terms: readonly string[]; onOpen: ClaimResultsProps["onOpenClaim"] }) {
  const { project, claim, reference, review } = hit;
  const source = project.evidence.sources.find((item) => item.id === reference.sourceId);
  const location = reference.page ? `p. ${reference.page}` : source?.type === "web" ? "web source" : undefined;
  return (
    <article className="claim-hit" style={{ "--card-accent": project.story.accent } as React.CSSProperties}>
      <button onClick={() => onOpen(project, claim.id)} title="Open this claim in its project">
        <span className="claim-hit-source">
          <b>{project.evidence.paper.title}</b>
          <small>{[project.evidence.paper.year, location].filter(Boolean).join(" · ")}</small>
        </span>
        <span className="claim-hit-statement"><Highlighted text={claim.statement} terms={terms} /></span>
        <span className="claim-hit-quote">“<Highlighted text={excerptAround(reference.excerpt, terms)} terms={terms} />”</span>
        <span className="claim-hit-marks">
          <span>{claimKindLabels[claim.kind]}</span>
          <span className={claim.confidence === "verified" ? "is-good" : "is-warn"}>
            {claim.confidence === "verified" ? "Verified" : "Needs review"}
          </span>
          {hit.quoteMissing && <span className="is-warn">Quote not found on its page</span>}
          {review && (
            <span className={review.status === "approved" ? "is-good" : "is-bad"}>
              {review.status === "approved" ? "Approved" : "Rejected"} by {review.by}
            </span>
          )}
        </span>
      </button>
    </article>
  );
}
