"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Highlighter, Layers, NotebookPen, Pencil, Star, Trash2, Users, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { addHighlightCard, clozeCandidates, highlightCardOf, removeHighlightCard } from "@/lib/highlight-cards";
import {
  cleanQuote,
  groupNotes,
  MAX_NOTE_TEXT,
  NOTE_COLORS,
  notesFileName,
  PAPER_BLOCKS,
  ORPHAN_HEADING,
  notesMarkdown,
  sameTarget,
  type NoteColor,
  type NotePlace,
  type NoteTarget,
  type ReaderNote,
} from "@/lib/reader-notes";
import { describeDue } from "@/lib/review-schedule";
import type { ResearchProject } from "@/lib/schema";
import type { StudyProgress } from "@/lib/study-path";
import { paintNotes, SelectionBar, useHighlightHint, type NoteBarWords } from "@/visuals/note-bar";
import { useTeamMember } from "./team";

/**
 * Okuyucunun notları ve vurguları (`reader-notes.ts`), stüdyoda.
 *
 * Bir makale açıkken notları sağlayıcı tutuyor; yazmalar kısa bir gecikmeyle
 * toplanıp sırayla gidiyor (`study-progress.ts` ile aynı düzen). Seçim
 * çubuğu ve vurguların sayfaya çizilmesi eklentinin bağımsız sitesiyle ortak
 * (`@/visuals/note-bar`).
 */

type Status = { status: "loading" } | { status: "ready" } | { status: "failed"; message: string };
type NewNote = { target: NoteTarget; quote?: string; text?: string; color?: NoteColor };
type NotesValue = {
  state: Status;
  notes: ReaderNote[];
  saveError?: string;
  add: (input: NewNote) => void;
  update: (id: string, patch: Partial<Pick<ReaderNote, "text" | "color">>) => void;
  remove: (id: string) => void;
  /** Ekip kipinde: notu ekiple paylaşmak ya da geri almak. */
  share: (id: string, shared: boolean) => void;
  /** Ekip kipinde mi (paylaşma düğmesi yalnızca orada). */
  team: boolean;
};

/** Başka bir üyenin paylaştığı not: sunucu ona yazarının adını koyuyor; okunuyor, değiştirilmiyor. */
export const isOthersNote = (note: ReaderNote) => Boolean(note.authorName);

const NotesContext = createContext<NotesValue | undefined>(undefined);

export function useReaderNotes() {
  return useContext(NotesContext);
}

/** `groupNotes`'un makaleden kalkmış yerlere bağlı notlar için başlığı; ekranda çevirisi gösteriliyor. */
const endpoint = (projectId: string) => `/api/library/notes?id=${encodeURIComponent(projectId)}`;
const newId = () => `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function ReaderNotesProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const team = Boolean(useTeamMember());
  const [state, setState] = useState<Status>({ status: "loading" });
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [saveError, setSaveError] = useState<string>();
  const pending = useRef<ReaderNote[] | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<ReaderNote[]>([]);
  // Hata metinleri ref'te: notlar dil değişince yeniden okunmasın.
  const t = useT().learning.readerNotes;
  const text = useRef(t);
  useEffect(() => {
    text.current = t;
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint(projectId), { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => undefined)) as { notes?: ReaderNote[]; error?: string } | undefined;
        if (!response.ok) throw new Error(data?.error ?? text.current.readFailed);
        if (cancelled) return;
        latest.current = data?.notes ?? [];
        setNotes(latest.current);
        setState({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "failed", message: error instanceof Error ? error.message : text.current.readFailed });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const flush = useCallback((keepalive = false) => {
    const next = pending.current;
    if (!next) return;
    pending.current = undefined;
    clearTimeout(timer.current);
    const body = JSON.stringify({ notes: next });
    queue.current = queue.current.then(async () => {
      try {
        const response = await fetch(endpoint(projectId), { method: "PUT", keepalive, headers: { "Content-Type": "application/json" }, body });
        if (!response.ok) {
          const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
          throw new Error(data?.error ?? text.current.saveFailed);
        }
        setSaveError(undefined);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : text.current.saveFailed);
      }
    });
  }, [projectId]);

  useEffect(() => () => flush(true), [flush]);

  const commit = useCallback((change: (current: ReaderNote[]) => ReaderNote[]) => {
    // Okuma bitmeden yazılmıyor: boş bir liste okuyucunun bütün notlarını silerdi.
    if (state.status !== "ready") return;
    const next = change(latest.current);
    latest.current = next;
    setNotes(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 400);
  }, [flush, state.status]);

  const value = useMemo<NotesValue>(() => ({
    state,
    notes,
    saveError,
    add: (input) => {
      const at = new Date().toISOString();
      const note: ReaderNote = {
        id: newId(),
        target: input.target,
        ...(input.quote ? { quote: cleanQuote(input.quote) } : {}),
        text: (input.text ?? "").trim().slice(0, MAX_NOTE_TEXT),
        color: input.color ?? "yellow",
        createdAt: at,
        updatedAt: at,
      };
      if (note.target.kind === "section" && !note.quote && !note.text) return;
      commit((current) => [...current, note]);
    },
    update: (id, patch) => commit((current) => current.map((note) => (note.id === id && !isOthersNote(note) ? { ...note, ...patch, ...(patch.text !== undefined ? { text: patch.text.trim().slice(0, MAX_NOTE_TEXT) } : {}), updatedAt: new Date().toISOString() } : note))),
    remove: (id) => commit((current) => current.filter((note) => note.id !== id || isOthersNote(note))),
    share: (id, shared) => commit((current) => current.map((note) => (note.id === id && !isOthersNote(note) ? { ...note, shared, updatedAt: new Date().toISOString() } : note))),
    team,
  }), [commit, notes, saveError, state, team]);

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

/* ---------------------------- Vurgular ---------------------------- */

/** Bölümlerdeki vurgular (`paintNotes`); yalnızca makalenin alanı izleniyor: başlıktaki saat her saniye değişiyor, orayı izlemek boşuna yeniden çizerdi. */
export function NoteHighlights() {
  const notes = useReaderNotes()?.notes;
  useEffect(() => (notes ? paintNotes(notes, document.querySelector(".workspace-content") ?? document.body) : undefined), [notes]);
  return null;
}

/* ------------------------- Seçim araç çubuğu ------------------------- */

/**
 * Vurgulamanın nasıl yapıldığı, vurgulanabilen Lab ekranlarının üstünde.
 * Özellik metni seçince açılıyor ve kimse bunu kendiliğinden bulmuyordu;
 * okuyucu "Anladım" deyince bu tarayıcıda bir daha gösterilmiyor
 * (`useHighlightHint`).
 */
export function HighlightHint() {
  const context = useReaderNotes();
  const t = useT().learning.readerNotes;
  const [seen, dismiss] = useHighlightHint();
  if (!context || seen) return null;
  return (
    <aside className="highlight-hint" role="note">
      <Highlighter size={16} aria-hidden="true" />
      <p>{t.hint}</p>
      <button type="button" onClick={dismiss}>{t.hintDismiss}</button>
    </aside>
  );
}

/**
 * Bir bölümde metin seçilince: renkle vurgula ya da vurgulayıp not yaz
 * (`SelectionBar`, bağımsız siteyle ortak). Klavyeden de: seçim varken H son
 * rengiyle vurguluyor, N not kutusunu açıyor.
 */
export function SelectionNoteBar() {
  const messages = useT();
  const context = useReaderNotes();
  const words = useMemo<NoteBarWords>(() => {
    const t = messages.learning.readerNotes;
    return { toolbar: t.highlightSelection, highlightIn: t.highlightIn, colors: t.colors, note: t.note, writeNote: t.writeNote, form: t.noteOnHighlight, yourNote: t.yourNote, save: messages.common.save, cancel: messages.common.cancel };
  }, [messages]);
  if (!context || context.state.status !== "ready") return null;
  return <SelectionBar words={words} onAdd={context.add} icon={<Highlighter size={14} aria-hidden="true" />} noteIcon={<NotebookPen size={14} />} />;
}

/* ---------------------------- İddia notları ---------------------------- */

/** Kanıt panelinde: iddiaya okuyucunun notu ve "önemli" işareti. */
export function ClaimNotes({ claimId }: { claimId: string }) {
  const t = useT().learning.readerNotes;
  const context = useReaderNotes();
  const [draft, setDraft] = useState("");
  if (!context || context.state.status === "loading") return null;
  if (context.state.status === "failed") return <p className="regen-error">{context.state.message}</p>;
  const target: NoteTarget = { kind: "claim", claimId };
  const mine = context.notes.filter((note) => sameTarget(note.target, target));
  const mark = mine.find((note) => !note.text && !note.quote && !isOthersNote(note));
  const written = mine.filter((note) => note.text || note.quote);

  return (
    <section className="claim-notes" aria-label={t.claimNotes}>
      <div className="claim-notes-head">
        <h4>{t.yourNotes}</h4>
        <button type="button" className={`claim-mark${mark ? " is-on" : ""}`} aria-pressed={Boolean(mark)} onClick={() => (mark ? context.remove(mark.id) : context.add({ target }))}>
          <Star size={13} /> {mark ? t.marked : t.mark}
        </button>
      </div>
      {written.map((note) => <NoteItem key={note.id} note={note} />)}
      <form
        className="claim-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          context.add({ target, text: draft });
          setDraft("");
        }}
      >
        <textarea rows={2} maxLength={MAX_NOTE_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.claimPlaceholder} aria-label={t.claimNoteLabel} />
        <button type="submit" disabled={!draft.trim()}>{t.saveNote}</button>
      </form>
      <small>{t.keptPrivate}</small>
      {context.saveError ? <p className="regen-error" role="status">{t.notSaved(context.saveError)}</p> : null}
    </section>
  );
}

/** Lab'in çalışma kaydı: vurgudan kart yapmak ve silinen vurgunun kartını kaldırmak için. */
export type NoteStudy = { progress?: StudyProgress; save: (progress: StudyProgress | undefined) => void };
type CardSource = { project: ResearchProject; study: NoteStudy; where: string };

/**
 * Vurgudan tekrar kartı (`highlight-cards.ts`): gizlenecek kelime seçiliyor,
 * kart Review'a giriyor. Kart varsa ne gizlediği ve ne zaman döneceği.
 */
function HighlightCard({ note, source, choosing, onChoosing }: { note: ReaderNote; source: CardSource; choosing: boolean; onChoosing: (open: boolean) => void }) {
  const messages = useT();
  const t = messages.learning.readerNotes;
  const quote = note.quote ?? "";
  const candidates = useMemo(() => clozeCandidates(quote, source.project), [quote, source.project]);
  const card = highlightCardOf(source.study.progress, note.id);
  const [now] = useState(() => new Date().toISOString());
  const current = card?.cloze ? candidates.findIndex((item) => item.at === card.cloze!.at && item.answer === card.cloze!.answer) : -1;
  const [pick, setPick] = useState(Math.max(0, current));
  if (!choosing) {
    if (!card?.cloze) return null;
    return (
      <p className="note-card-status" role="status">
        <Layers size={13} aria-hidden="true" /> {t.inReview(card.cloze.answer, describeDue(card.due, now, messages.learning.words.due))}
      </p>
    );
  }
  const chosen = candidates[pick];
  if (!chosen) return null;
  return (
    <div className="note-card-maker" role="group" aria-label={t.cardMaker}>
      <p className="note-card-preview">
        {quote.slice(0, chosen.at)}
        <span className="cloze-blank"><span aria-label={t.blank}>_____</span></span>
        {quote.slice(chosen.at + chosen.answer.length)}
      </p>
      <div className="note-card-words" role="radiogroup" aria-label={t.wordToHide}>
        {candidates.map((item, index) => (
          <button key={`${item.at}-${item.answer}`} type="button" role="radio" aria-checked={index === pick} onClick={() => setPick(index)}>{item.answer}</button>
        ))}
      </div>
      <div className="note-bar-actions">
        <button
          type="button"
          className="note-save"
          onClick={() => {
            source.study.save(addHighlightCard(source.study.progress, note, chosen, source.where, new Date().toISOString()));
            onChoosing(false);
          }}
        >
          {card ? t.saveCard : t.addToReview}
        </button>
        {card ? (
          <button
            type="button"
            onClick={() => {
              source.study.save(removeHighlightCard(source.study.progress, note.id, new Date().toISOString()));
              onChoosing(false);
            }}
          >
            {t.stopReviewing}
          </button>
        ) : null}
        <button type="button" onClick={() => onChoosing(false)}>{messages.common.cancel}</button>
      </div>
    </div>
  );
}

/** Bir not: vurgu, metin; düzenle, renk, sil; vurgudan tekrar kartı. */
function NoteItem({ note, source }: { note: ReaderNote; source?: CardSource }) {
  const messages = useT();
  const t = messages.learning.readerNotes;
  const context = useReaderNotes()!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [choosing, setChoosing] = useState(false);
  const canCard = Boolean(source && note.quote && clozeCandidates(note.quote, source.project).length);
  const hasCard = Boolean(source && highlightCardOf(source.study.progress, note.id));
  if (isOthersNote(note)) {
    return (
      <article className={`note-item is-${note.color} is-shared-by-other`}>
        <p className="note-author">{t.sharedBy(note.authorName ?? "")}</p>
        {note.quote ? <blockquote>{note.quote}</blockquote> : null}
        {note.text ? <p>{note.text}</p> : null}
      </article>
    );
  }
  return (
    <article className={`note-item is-${note.color}${note.shared ? " is-shared" : ""}`}>
      {note.quote ? <blockquote>{note.quote}</blockquote> : null}
      {editing ? (
        <form
          className="note-edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim() && !note.quote && note.target.kind === "section") context.remove(note.id);
            else context.update(note.id, { text: draft });
            setEditing(false);
          }}
        >
          <textarea autoFocus rows={3} maxLength={MAX_NOTE_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={t.editNote} />
          <div className="note-bar-actions">
            <button type="submit" className="note-save">{messages.common.save}</button>
            <button type="button" onClick={() => { setDraft(note.text); setEditing(false); }}>{messages.common.cancel}</button>
          </div>
        </form>
      ) : note.text ? (
        <p>{note.text}</p>
      ) : null}
      {!editing ? (
        <div className="note-item-actions">
          {note.quote ? (
            <span className="note-colors" role="radiogroup" aria-label={t.highlightColour}>
              {NOTE_COLORS.map((color) => (
                <button key={color} type="button" role="radio" aria-checked={note.color === color} className={`note-swatch is-${color}`} aria-label={t.colors[color]} onClick={() => context.update(note.id, { color })} />
              ))}
            </span>
          ) : null}
          <button type="button" onClick={() => setEditing(true)}><Pencil size={13} /> {note.text ? messages.common.edit : t.addNote}</button>
          {context.team && (note.text || note.quote) ? (
            <button type="button" aria-pressed={Boolean(note.shared)} onClick={() => context.share(note.id, !note.shared)} title={note.shared ? t.teamCanRead : t.onlyYou}>
              <Users size={13} /> {note.shared ? t.sharedWithTeam : t.shareWithTeam}
            </button>
          ) : null}
          {canCard && !choosing ? (
            <button type="button" onClick={() => setChoosing(true)}><Layers size={13} /> {hasCard ? t.changeCard : t.makeCard}</button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              // Silinen vurgunun kartı da gidiyor: artık olmayan bir vurguyu sormak anlamsız.
              if (source && hasCard) source.study.save(removeHighlightCard(source.study.progress, note.id, new Date().toISOString()));
              context.remove(note.id);
            }}
            aria-label={t.deleteNote}
          >
            <Trash2 size={13} /> {messages.common.delete}
          </button>
        </div>
      ) : null}
      {source && note.quote ? <HighlightCard key={String(choosing)} note={note} source={source} choosing={choosing} onChoosing={setChoosing} /> : null}
    </article>
  );
}

/* ---------------------------- Notlar paneli ---------------------------- */

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lab'de "Notes": makaledeki bütün notlar sırasıyla, dışa aktarma ve yeni not. */
export function NotesPanel({
  project,
  study,
  onClaimSelect,
  onShowSection,
}: {
  project: ResearchProject;
  /** Okunabildiyse çalışma kaydı: vurgular tekrar kartına dönüşebiliyor. */
  study?: NoteStudy;
  onClaimSelect: (claimId: string) => void;
  onShowSection: (place: NotePlace, sectionId: string) => void;
}) {
  const messages = useT();
  const t = messages.learning.readerNotes;
  const places = t.places;
  const context = useReaderNotes();
  const [targetKey, setTargetKey] = useState("");
  const [draft, setDraft] = useState("");
  const groups = useMemo(() => (context ? groupNotes(project, context.notes, t.paperBlocks) : []), [context, project, t.paperBlocks]);
  const targets = useMemo(() => [
    ...PAPER_BLOCKS.filter((block) => block !== "technical" || project.technicalAppendix).map((block) => ({ key: `paper:${block}`, label: `${places.Lab} · ${t.paperBlocks[block]}`, target: { kind: "section", place: "paper", sectionId: block } as NoteTarget })),
    ...project.story.sections.map((section) => ({ key: `story:${section.id}`, label: `${places.Story} · ${section.title}`, target: { kind: "section", place: "story", sectionId: section.id } as NoteTarget })),
    ...(project.deepReport?.sections ?? []).map((section) => ({ key: `report:${section.id}`, label: `${places["Deep report"]} · ${section.title}`, target: { kind: "section", place: "report", sectionId: section.id } as NoteTarget })),
    ...(project.primer?.concepts ?? []).map((concept) => ({ key: `concept:${concept.id}`, label: `${places.Primer} · ${concept.term}`, target: { kind: "section", place: "concept", sectionId: concept.id } as NoteTarget })),
    ...project.evidence.claims.map((claim) => ({ key: `claim:${claim.id}`, label: `${places.Claim} · ${claim.statement.length > 90 ? `${claim.statement.slice(0, 90)}…` : claim.statement}`, target: { kind: "claim", claimId: claim.id } as NoteTarget })),
  ], [places, project, t.paperBlocks]);
  if (!context) return null;
  if (context.state.status === "loading") return <p className="section-intro" role="status">{t.loading}</p>;
  if (context.state.status === "failed") return <p className="regen-error" role="alert">{context.state.message}</p>;
  const count = context.notes.length;
  const chosen = targets.find((item) => item.key === targetKey) ?? targets[0];

  return (
    <div className="notes-panel">
      <p className="section-intro">
        {t.intro}
      </p>
      <div className="notes-export">
        <button type="button" disabled={!count} onClick={() => download(notesFileName(project), notesMarkdown(project, context.notes, { exportedAt: new Date().toISOString() }))}><Download size={14} /> Markdown</button>
        <button type="button" disabled={!count} onClick={() => download(notesFileName(project), notesMarkdown(project, context.notes, { obsidian: true, exportedAt: new Date().toISOString() }))}><Download size={14} /> {t.forObsidian}</button>
        <span>{count ? t.count(count) : t.none}</span>
      </div>
      <form
        className="notes-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim() || !chosen) return;
          context.add({ target: chosen.target, text: draft });
          setDraft("");
        }}
      >
        <label className="focus-select">
          <span>{t.addNoteTo}</span>
          <select value={chosen?.key ?? ""} onChange={(event) => setTargetKey(event.target.value)}>
            {targets.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <textarea rows={3} maxLength={MAX_NOTE_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.yourNote} aria-label={t.yourNote} />
        <button type="submit" disabled={!draft.trim()}>{t.saveNote}</button>
      </form>
      {context.saveError ? <p className="regen-error" role="status">{t.notSaved(context.saveError)}</p> : null}
      {groups.map((group) => {
        const orphans = group.heading === ORPHAN_HEADING;
        const heading = orphans ? t.orphans : group.heading;
        return (
          <section key={`${group.place}-${group.heading}`} className="notes-group" aria-label={`${places[group.place]}: ${heading}`}>
            <header>
              <span className="notes-place">{places[group.place]}{group.page ? ` · ${messages.common.page(group.page)}` : ""}</span>
              <h3>{heading}</h3>
              {!orphans ? (
                group.target.kind === "claim" ? (
                  <button type="button" onClick={() => onClaimSelect((group.target as { claimId: string }).claimId)}>{t.openClaim}</button>
                ) : (
                  <button type="button" onClick={() => onShowSection((group.target as { place: NotePlace }).place, (group.target as { sectionId: string }).sectionId)}>{t.showIt}</button>
                )
              ) : null}
            </header>
            {group.notes.map((note) => (note.text || note.quote ? <NoteItem key={note.id} note={note} source={study ? { project, study, where: orphans ? "" : group.heading } : undefined} /> : (
              <p key={note.id} className="notes-marked"><Star size={13} /> {t.marked} <button type="button" onClick={() => context.remove(note.id)} aria-label={t.removeMark}><X size={13} /></button></p>
            )))}
          </section>
        );
      })}
    </div>
  );
}
