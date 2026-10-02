"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, BookMarked, BookmarkCheck, BookOpen, Columns2, FileText, FileUp, Gauge, LayoutGrid, List, NotebookPen, Plus, Quote, Search, Tag, Trash2, Waypoints, X } from "lucide-react";
import { useUiLanguage } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import { uiLocale } from "@/i18n/languages";
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
import { buildNoteIndex, searchNotes, type NoteHit, type NoteSearch } from "@/lib/note-search";
import { ORPHAN_HEADING, parseNotesFile, type ReaderNote } from "@/lib/reader-notes";
import { UNDO_WINDOW_MS } from "@/lib/pending-deletion";
import { listLibraryTags, saveProjectTags } from "@/lib/project-library";
import type { ResearchProject } from "@/lib/schema";
import { foldForSearch } from "@/lib/search-text";
import { DisplayControl } from "./display-control";
import { useReviewForecast } from "./study-progress";
import { describeDue } from "@/lib/review-schedule";
import { StudioNav } from "./focus/studio-nav";
import { useReadingList } from "./reading-list";
import { useReadingPositions } from "./reading-position";
import { positionLabel, worthContinuing, type ReadingPosition } from "@/lib/reading-position";

type LibraryViewProps = {
  projects: ResearchProject[];
  onOpen: (project: ResearchProject) => void;
  /** Bir arama sonucundan projeye, doğrudan o iddianın üstüne. */
  onOpenClaim: (project: ResearchProject, claimId: string) => void;
  /** Not aramasından projeye: Lab'in Notes bölümü. */
  onOpenNotes?: (project: ResearchProject) => void;
  /** Modellerin alıntı karnesi: kütüphanedeki bütün projelerden hesaplanıyor. */
  onModelRecord: () => void;
  /** Tekrar ekranı; kütüphanedeki bütün makalelerin kartları. */
  onReview: () => void;
  /** Kavram haritası: birden çok makalenin anlattığı kavramlar. */
  onConcepts: () => void;
  /** Okuma listesi: kavram haritasındaki okuma sırasında. */
  onReadingList?: () => void;
  /** Kaldığın yerden: makale, kalınan bölümde açılıyor. */
  onContinue?: (project: ResearchProject, position: ReadingPosition) => void;
  onProgress: () => void;
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

type SearchScope = "papers" | "claims" | "notes";
type LibraryWords = Messages["studio"]["library"];

const TAG_OPTIONS_ID = "library-tag-options";

function generationLabel(project: ResearchProject, t: LibraryWords) {
  const assignments = project.generation?.assignments;
  if (!assignments) return project.generation?.model;
  const models = new Set(Object.values(assignments).map((assignment) => `${assignment.provider}:${assignment.model}`));
  return models.size > 1 ? t.modelTeam(models.size) : [...models][0]?.split(":").slice(1).join(":");
}

export function LibraryView({ projects, onOpen, onOpenClaim, onOpenNotes, onModelRecord, onReview, onConcepts, onReadingList, onContinue, onProgress, onDelete, pendingDeletion, onUndoDelete, onConfirmDelete, deleteError, onDismissDeleteError, onHome, onNew, onImport, onCompare }: LibraryViewProps) {
  const { language, t: messages } = useUiLanguage();
  const t = messages.studio.library;
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(uiLocale(language), { day: "numeric", month: "short", year: "numeric" }), [language]);
  const reading = useReadingList();
  const positions = useReadingPositions();
  const review = useReviewForecast(projects);
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
  // Yedek hata metinleri açılışta bir kez çalışan efektlerde; arayüzün o anki dili.
  const tagsUnreadable = useRef(t.tagsUnreadable);
  const notesUnreadable = useRef(t.notesUnreadable);
  useEffect(() => {
    tagsUnreadable.current = t.tagsUnreadable;
    notesUnreadable.current = t.notesUnreadable;
  });

  useEffect(() => {
    let active = true;
    listLibraryTags()
      .then((loaded) => { if (active) setTags(loaded); })
      .catch((error: unknown) => {
        if (active) setImportError(error instanceof Error ? error.message : tagsUnreadable.current);
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
  // Notlar yalnızca not araması açılınca okunuyor; her açılışta yeniden (Lab'de yazılmış olabilir).
  const [readerNotes, setReaderNotes] = useState<{ status: "idle" | "loading" } | { status: "ready"; notes: Map<string, ReaderNote[]> } | { status: "failed"; message: string }>({ status: "idle" });
  useEffect(() => {
    if (scope !== "notes") return;
    let cancelled = false;
    const start = setTimeout(() => setReaderNotes({ status: "loading" }), 0);
    fetch("/api/library/notes", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
        if (!response.ok) throw new Error(data?.error ?? notesUnreadable.current);
        if (!cancelled) setReaderNotes({ status: "ready", notes: parseNotesFile(data) });
      })
      .catch((error: unknown) => {
        if (!cancelled) setReaderNotes({ status: "failed", message: error instanceof Error ? error.message : notesUnreadable.current });
      });
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [scope]);
  const noteIndex = useMemo(() => (scope === "notes" && readerNotes.status === "ready" ? buildNoteIndex(inCollection, readerNotes.notes) : []), [scope, inCollection, readerNotes]);
  const noteSearch = useMemo(() => searchNotes(noteIndex, query), [noteIndex, query]);

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
        setImportError(error instanceof Error ? error.message : t.tagsUnsaved);
        // Ekrandaki hâl kaydedilmemiş olabilir; sunucudakine dön.
        const loaded = await listLibraryTags().catch(() => undefined);
        if (loaded) setTags(loaded);
      });
  }

  function submitTag(projectId: string) {
    const current = tags.get(projectId) ?? [];
    const result = addTag(current, tagDraft, knownTags, t.tagWords);
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
    ? t.results(filtered.length)
    : scope === "notes"
      ? noteSearch.terms.length
        ? t.notesInPapers(noteSearch.total, noteSearch.papers)
        : t.notes(noteIndex.length)
      : claimSearch.terms.length
        ? t.claimsInPapers(claimSearch.total, claimSearch.papers)
        : t.claims(claimIndex.length);

  return (
    <main className="library-page">
      <header className="library-header">
        <button className="brand" onClick={onHome} aria-label={messages.studio.brand.home}>
          <span className="brand-glyph">t</span>
          <span><strong>trace</strong><small>{messages.studio.brand.tagline}</small></span>
        </button>
        <div className="library-header-actions">
          <button className="text-button" onClick={onHome}><ArrowLeft size={15} /> {t.home}</button>
          <input ref={importRef} type="file" accept=".json,.trace.json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setImportError(undefined);
            void onImport(file).catch((error) => setImportError(error instanceof Error ? error.message : t.importFailed));
          }} />
          <DisplayControl />
          <button className="library-import-button" title={t.progressTitle} onClick={onProgress}><BarChart3 size={15} /> {t.progress}</button>
          <button className="library-import-button" title={t.conceptsTitle} onClick={onConcepts}><Waypoints size={15} /> {t.concepts}</button>
          {/* Boşken de: Zotero'dan ya da bir .bib dosyasından içe aktarma oradan başlıyor. */}
          {onReadingList && reading?.ready ? (
            <button className="library-import-button" title={t.readingListTitle} onClick={onReadingList}><BookmarkCheck size={15} /> {t.readingList}{reading.items.length ? ` (${reading.items.length})` : ""}</button>
          ) : null}
          <button className="library-import-button" title={t.modelRecordTitle} onClick={onModelRecord}><Gauge size={15} /> {t.modelRecord}</button>
          <button className="library-import-button" onClick={() => importRef.current?.click()}><FileUp size={15} /> Trace JSON</button>
          <button className="library-new-button" onClick={onNew}><Plus size={16} /> {t.newPaper}</button>
          <StudioNav />
        </div>
      </header>

      {importError && <div className="library-import-error">{importError}<button onClick={() => setImportError(undefined)}>{messages.common.close}</button></div>}
      {deleteError && <div className="library-import-error" role="alert">{deleteError} {t.deleteRestored}<button onClick={onDismissDeleteError}>{messages.common.close}</button></div>}

      <section className="library-hero">
        <div>
          <p className="landing-eyebrow"><span /> {t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p>{t.lead}</p>
        </div>
        <div className="library-stats">
          {review?.total ? (
            <button className="library-stat library-review" onClick={onReview} title={t.reviewTitle}>
              <strong>{review.due}</strong>
              <span>
                {review.due
                  ? t.cardsToReview(review.due)
                  : t.nothingDue(review.nextDue ? describeDue(review.nextDue, review.now, messages.learning.words.due) : undefined)}
                {" "}<ArrowRight size={12} />
              </span>
            </button>
          ) : null}
          <div className="library-stat"><strong>{projects.length}</strong><span>{t.savedProjects}</span></div>
        </div>
      </section>

      <section className="library-toolbar">
        <div className="library-scope" role="group" aria-label={t.searchIn}>
          <button aria-pressed={scope === "papers"} onClick={() => setScope("papers")}>{t.scopes.papers}</button>
          <button aria-pressed={scope === "claims"} onClick={() => setScope("claims")}>{t.scopes.claims}</button>
          <button aria-pressed={scope === "notes"} onClick={() => setScope("notes")}>{t.scopes.notes}</button>
        </div>
        <label>
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t.searchLabels[scope]}
            placeholder={t.searchPlaceholders[scope]}
          />
        </label>
        {scope === "papers" && (
          <div className="library-arrange">
            <label>
              <span>{t.sort}</span>
              <select value={sort} onChange={(event) => { const next = parseLibrarySort(event.target.value); setSort(next); writeStored(LIBRARY_SORT_KEY, next); }}>
                {librarySorts.map((option) => <option key={option.id} value={option.id}>{t.sorts[option.id]}</option>)}
              </select>
            </label>
            <div className="library-layout" role="group" aria-label={t.layout}>
              {([["grid", t.grid, LayoutGrid], ["list", t.list, List]] as const).map(([id, label, Icon]) => (
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
        <nav className="library-tags" aria-label={t.collections}>
          <button aria-pressed={!collection} onClick={() => setActiveTag(undefined)}>{t.allPapers} <i>{projects.length}</i></button>
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
              {inCollection.length > 2 ? t.mapThese(inCollection.length) : t.compareTheseTwo} <ArrowRight size={14} />
            </button>
          )}
          {collection && inCollection.length > MAX_MAP_PAPERS && (
            <small>{t.selectUpTo(MAX_MAP_PAPERS)}</small>
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
            {chosen.length === 1 ? t.pickOneMore : chosen.length < MAX_MAP_PAPERS ? t.addUpTo(MAX_MAP_PAPERS) : ""}
          </span>
          <div>
            <button className="text-button" onClick={() => setSelected([])}>{t.clear}</button>
            <button className="library-open" disabled={chosen.length < 2} onClick={() => chosen.length >= 2 && onCompare(chosen)}>
              {chosen.length > 2 ? t.mapPapers(chosen.length) : t.compare} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {projects.length > 0 && scope === "notes" ? (
        <NoteResults
          state={readerNotes}
          search={noteSearch}
          noteCount={noteIndex.length}
          paperCount={inCollection.length}
          collection={collection}
          onOpen={(hit) => (hit.note.target.kind === "claim" ? onOpenClaim(hit.project, hit.note.target.claimId) : (onOpenNotes ?? onOpen)(hit.project))}
        />
      ) : projects.length > 0 && scope === "claims" ? (
        <ClaimResults search={claimSearch} claimCount={claimIndex.length} paperCount={inCollection.length} collection={collection} onOpenClaim={onOpenClaim} />
      ) : filtered.length ? (
        <section className={layout === "list" ? "library-grid is-list" : "library-grid"} aria-label={t.scopes.papers}>
          {filtered.map((project, index) => {
            const projectTags = tags.get(project.id) ?? [];
            const editing = editingTags === project.id;
            return (
              <article className={selected.includes(project.id) ? "library-card is-selected" : "library-card"} key={project.id} style={{ "--card-accent": project.story.accent } as React.CSSProperties}>
                <label className="library-select" title={t.selectForComparison}>
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
                    <span>{project.evidence.paper.venue || t.researchPaper} · {project.evidence.paper.year}</span>
                    <h2>{project.evidence.paper.title}</h2>
                    <p>{project.evidence.plainSummary}</p>
                    <div className="library-card-meta">
                      <span>{t.storyCount(project.story.sections.length)}</span>
                      <span>{t.claimCount(project.evidence.claims.length)}</span>
                      {project.deepReport && <span>{t.reportCount(project.deepReport.sections.length)}</span>}
                      {project.technicalAppendix && <span>{t.technicalAppendix}</span>}
                    </div>
                  </div>
                </button>
                <div className={editing ? "library-card-tags is-editing" : "library-card-tags"}>
                  {projectTags.map((tag) => editing ? (
                    <span className="library-tag" key={tagKey(tag)}>
                      {tag}
                      <button aria-label={t.removeTag(tag)} onClick={() => persistTags(project.id, removeTag(projectTags, tag))}><X size={11} /></button>
                    </span>
                  ) : (
                    <button className="library-tag" key={tagKey(tag)} title={t.showTag} onClick={() => setActiveTag(tag)}>{tag}</button>
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
                        placeholder={t.addTagPlaceholder}
                        aria-label={t.addTagTo(project.evidence.paper.title)}
                      />
                      <button type="submit" disabled={!tagDraft.trim()}>{messages.common.add}</button>
                      <button type="button" onClick={() => setEditingTags(undefined)}>{messages.common.done}</button>
                      {tagError && <small className="library-tag-error" role="alert">{tagError}</small>}
                    </form>
                  ) : (
                    <button className="library-tag-edit" onClick={() => startEditingTags(project.id)}>
                      <Tag size={11} /> {projectTags.length ? t.editTags : t.addTags}
                    </button>
                  )}
                </div>
                <footer>
                  <span>{dateFormat.format(new Date(project.updatedAt))}{generationLabel(project, t) ? ` · ${generationLabel(project, t)}` : ""}</span>
                  <div>
                    <button className="library-delete" title={t.deleteTitle} aria-label={t.deletePaper(project.evidence.paper.title)} onClick={() => {
                      setImportError(undefined);
                      onDelete(project.id);
                    }}><Trash2 size={15} /></button>
                    {onContinue && worthContinuing(positions[project.id]) ? (
                      <button
                        className="library-continue"
                        title={t.stoppedAt(positionLabel(positions[project.id], messages.learning.words.positionLabel))}
                        aria-label={t.continueReading(project.evidence.paper.title, positionLabel(positions[project.id], messages.learning.words.positionLabel))}
                        onClick={() => onContinue(project, positions[project.id])}
                      >
                        <BookMarked size={14} /> {t.continueAt(positions[project.id].index + 1, positions[project.id].total)}
                      </button>
                    ) : null}
                    <button className="library-open" onClick={() => onOpen(project)}>{messages.common.open} <ArrowRight size={15} /></button>
                  </div>
                </footer>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="library-empty">
          <BookOpen size={30} />
          <h2>{projects.length ? t.noMatch : t.empty}</h2>
          <p>{t.emptyHint}</p>
          <button onClick={onNew}>{t.addPaper} <ArrowRight size={16} /></button>
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
  const messages = useUiLanguage().t;
  const t = messages.studio.library;
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
      <span>{t.deleted(project.evidence.paper.title)}</span>
      <button className="undo-action" onClick={onUndo}>{messages.common.undo}</button>
      <button className="undo-dismiss" aria-label={t.deleteNow} title={t.deleteNow} onClick={onConfirm}><X size={15} /></button>
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

type NoteResultsProps = {
  state: { status: "idle" | "loading" } | { status: "ready" } | { status: "failed"; message: string };
  search: NoteSearch;
  noteCount: number;
  paperCount: number;
  collection?: string;
  onOpen: (hit: NoteHit) => void;
};

/** Okuyucunun notları ve vurguları; sonuç kartı iddia kartının düzeninde. */
function NoteResults({ state, search, noteCount, paperCount, collection, onOpen }: NoteResultsProps) {
  const messages = useUiLanguage().t;
  const t = messages.studio.library;
  if (state.status === "failed") return <p className="regen-error" role="alert">{state.message}</p>;
  if (state.status !== "ready") return <p className="review-status" role="status">{t.readingNotes}</p>;
  if (!search.terms.length) {
    return (
      <section className="library-empty">
        <NotebookPen size={30} />
        <h2>{t.searchNotesTitle}</h2>
        <p>
          {noteCount ? t.searchNotesIntro(noteCount, paperCount, collection) : t.noNotesYet}
        </p>
      </section>
    );
  }
  if (!search.hits.length) {
    return (
      <section className="library-empty">
        <NotebookPen size={30} />
        <h2>{t.noNoteMatch}</h2>
        <p>{t.noteSearchScope}</p>
      </section>
    );
  }
  const openTitle = (hit: NoteHit) => (hit.note.target.kind === "claim" ? t.openClaim : t.openNotes);
  return (
    <section className="claim-results" aria-label={t.matchingNotes}>
      {search.hits.map((hit) => (
        <article key={JSON.stringify([hit.project.id, hit.note.id])} className="claim-hit note-hit" style={{ "--card-accent": hit.project.story.accent } as React.CSSProperties}>
          <button onClick={() => onOpen(hit)} title={openTitle(hit)}>
            <span className="claim-hit-source">
              <b>{hit.project.evidence.paper.title}</b>
              <small>{t.notePlaces[hit.place]}</small>
            </span>
            <span className="note-hit-where">{hit.heading === ORPHAN_HEADING ? messages.learning.readerNotes.orphans : hit.heading}</span>
            {hit.note.quote ? <span className={`claim-hit-quote note-hit-quote is-${hit.note.color}`}>“<Highlighted text={excerptAround(hit.note.quote, search.terms)} terms={search.terms} />”</span> : null}
            {hit.note.text ? <span className="note-hit-text"><Highlighted text={excerptAround(hit.note.text, search.terms)} terms={search.terms} /></span> : null}
          </button>
        </article>
      ))}
      {search.total > search.hits.length && (
        <p className="claim-results-more">{t.moreNotes(search.hits.length, search.total)}</p>
      )}
    </section>
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
  const t = useUiLanguage().t.studio.library;
  if (!search.terms.length) {
    return (
      <section className="library-empty">
        <Quote size={30} />
        <h2>{t.searchClaimsTitle}</h2>
        <p>{t.searchClaimsIntro(claimCount, paperCount, collection)}</p>
      </section>
    );
  }
  if (!search.hits.length) {
    return (
      <section className="library-empty">
        <Quote size={30} />
        <h2>{t.noClaimMatch}</h2>
        <p>{t.claimSearchScope}</p>
      </section>
    );
  }
  return (
    <section className="claim-results" aria-label={t.matchingClaims}>
      {search.hits.map((hit) => (
        <ClaimResult key={JSON.stringify([hit.project.id, hit.claim.id])} hit={hit} terms={search.terms} onOpen={onOpenClaim} />
      ))}
      {search.total > search.hits.length && (
        <p className="claim-results-more">{t.moreClaims(search.hits.length, search.total)}</p>
      )}
    </section>
  );
}

function ClaimResult({ hit, terms, onOpen }: { hit: ClaimHit; terms: readonly string[]; onOpen: ClaimResultsProps["onOpenClaim"] }) {
  const messages = useUiLanguage().t;
  const t = messages.studio.library;
  const { project, claim, reference, review } = hit;
  const source = project.evidence.sources.find((item) => item.id === reference.sourceId);
  const location = reference.page ? messages.common.page(reference.page) : source?.type === "web" ? t.webSource : undefined;
  return (
    <article className="claim-hit" style={{ "--card-accent": project.story.accent } as React.CSSProperties}>
      <button onClick={() => onOpen(project, claim.id)} title={t.openClaim}>
        <span className="claim-hit-source">
          <b>{project.evidence.paper.title}</b>
          <small>{[project.evidence.paper.year, location].filter(Boolean).join(" · ")}</small>
        </span>
        <span className="claim-hit-statement"><Highlighted text={claim.statement} terms={terms} /></span>
        <span className="claim-hit-quote">“<Highlighted text={excerptAround(reference.excerpt, terms)} terms={terms} />”</span>
        <span className="claim-hit-marks">
          <span>{t.claimKinds[claim.kind]}</span>
          <span className={claim.confidence === "verified" ? "is-good" : "is-warn"}>
            {claim.confidence === "verified" ? t.verified : t.needsReview}
          </span>
          {hit.quoteMissing && <span className="is-warn">{t.quoteMissing}</span>}
          {review && (
            <span className={review.status === "approved" ? "is-good" : "is-bad"}>
              {review.status === "approved" ? t.approvedBy(review.by) : t.rejectedBy(review.by)}
            </span>
          )}
        </span>
      </button>
    </article>
  );
}
