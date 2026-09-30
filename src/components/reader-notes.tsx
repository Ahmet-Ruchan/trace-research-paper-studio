"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Highlighter, NotebookPen, Pencil, Star, Trash2, X } from "lucide-react";
import {
  cleanQuote,
  groupNotes,
  MAX_NOTE_TEXT,
  NOTE_COLORS,
  notesFileName,
  notesMarkdown,
  sameTarget,
  sectionMark,
  type NoteColor,
  type NoteTarget,
  type ReaderNote,
} from "@/lib/reader-notes";
import type { ResearchProject } from "@/lib/schema";

/**
 * Okuyucunun notları ve vurguları (`reader-notes.ts`), stüdyoda.
 *
 * Bir makale açıkken notları sağlayıcı tutuyor; yazmalar kısa bir gecikmeyle
 * toplanıp sırayla gidiyor (`study-progress.ts` ile aynı düzen). Vurgular
 * sayfaya CSS Custom Highlight API ile çiziliyor: metne `<mark>` eklenmiyor,
 * bölümlerin DOM'u değişmiyor; tarayıcı desteklemiyorsa vurgu görünmüyor ama
 * not listesi ve dışa aktarım çalışıyor.
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
};

const NotesContext = createContext<NotesValue | undefined>(undefined);

export function useReaderNotes() {
  return useContext(NotesContext);
}

const colorNames: Record<NoteColor, string> = { yellow: "yellow", green: "green", blue: "blue", pink: "pink", purple: "purple" };
const endpoint = (projectId: string) => `/api/library/notes?id=${encodeURIComponent(projectId)}`;
const newId = () => `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function ReaderNotesProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [state, setState] = useState<Status>({ status: "loading" });
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [saveError, setSaveError] = useState<string>();
  const pending = useRef<ReaderNote[] | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<ReaderNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint(projectId), { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => undefined)) as { notes?: ReaderNote[]; error?: string } | undefined;
        if (!response.ok) throw new Error(data?.error ?? "Your notes could not be read.");
        if (cancelled) return;
        latest.current = data?.notes ?? [];
        setNotes(latest.current);
        setState({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "failed", message: error instanceof Error ? error.message : "Your notes could not be read." });
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
          throw new Error(data?.error ?? "Your notes could not be saved.");
        }
        setSaveError(undefined);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Your notes could not be saved.");
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
    update: (id, patch) => commit((current) => current.map((note) => (note.id === id ? { ...note, ...patch, ...(patch.text !== undefined ? { text: patch.text.trim().slice(0, MAX_NOTE_TEXT) } : {}), updatedAt: new Date().toISOString() } : note))),
    remove: (id) => commit((current) => current.filter((note) => note.id !== id)),
  }), [commit, notes, saveError, state]);

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

/* ---------------------------- Vurgular ---------------------------- */

type HighlightRegistry = { set: (name: string, value: unknown) => void; delete: (name: string) => void };

/** Bölümün metninde alıntıyı bulur; boşluklar sayfada nasıl dağılmış olursa olsun. */
function findQuote(root: Element, quote: string): Range | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const map: Array<{ node: Text; offset: number }> = [];
  let text = "";
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.data;
    for (let index = 0; index < value.length; index += 1) {
      const space = /\s/.test(value[index]);
      if (space && (!text.length || text.endsWith(" "))) continue;
      text += space ? " " : value[index];
      map.push({ node, offset: index });
    }
  }
  const at = text.indexOf(quote);
  if (at < 0) return undefined;
  const start = map[at];
  const end = map[at + quote.length - 1];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/** Bölümlerdeki vurgular; sayfa değiştikçe (bölüm açılınca, yeniden çizilince) yeniden. */
export function NoteHighlights() {
  const context = useReaderNotes();
  const notes = context?.notes;
  useEffect(() => {
    const registry = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
    const HighlightType = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightType || !notes) return;
    const paint = () => {
      const byColor = new Map<NoteColor, Range[]>();
      for (const note of notes) {
        if (!note.quote || note.target.kind !== "section") continue;
        const root = document.querySelector(`[data-note-section="${CSS.escape(sectionMark(note.target.place, note.target.sectionId))}"]`);
        const range = root ? findQuote(root, note.quote) : undefined;
        if (range) byColor.set(note.color, [...(byColor.get(note.color) ?? []), range]);
      }
      for (const color of NOTE_COLORS) {
        const ranges = byColor.get(color);
        if (ranges?.length) registry.set(`trace-note-${color}`, new HighlightType(...ranges));
        else registry.delete(`trace-note-${color}`);
      }
    };
    paint();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(paint, 120);
    });
    // Yalnızca makalenin alanı: başlıktaki saat her saniye değişiyor, orayı izlemek boşuna yeniden çizerdi.
    observer.observe(document.querySelector(".workspace-content") ?? document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const color of NOTE_COLORS) registry.delete(`trace-note-${color}`);
    };
  }, [notes]);
  return null;
}

/* ------------------------- Seçim araç çubuğu ------------------------- */

type Picked = { target: NoteTarget; quote: string; above: number; below: number; left: number };

/**
 * Araç çubuğunun yeri: seçimin altında (telefonların kendi seçim menüsü
 * üstte açılıyor); sığmıyorsa üstünde; ne olursa olsun ekranın içinde.
 */
function placeAt(picked: Picked, height: number, width: number) {
  const room = window.innerHeight - 12;
  const top = picked.below + height <= room ? picked.below : picked.above - height;
  const half = Math.min(width, window.innerWidth - 24) / 2;
  return { top: Math.max(12, Math.min(top, room - height)), left: Math.max(12 + half, Math.min(picked.left, window.innerWidth - 12 - half)) };
}

function pickedSelection(): Picked | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return undefined;
  const element = (node: Node | null) => (node instanceof Element ? node : node?.parentElement ?? null);
  const root = element(selection.anchorNode)?.closest("[data-note-section]");
  if (!root || root !== element(selection.focusNode)?.closest("[data-note-section]")) return undefined;
  const quote = cleanQuote(selection.toString());
  if (quote.length < 2) return undefined;
  const [place, ...rest] = (root.getAttribute("data-note-section") ?? "").split(":");
  if ((place !== "story" && place !== "report") || !rest.length) return undefined;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const left = Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2));
  return { target: { kind: "section", place, sectionId: rest.join(":") }, quote, above: rect.top - 10, below: rect.bottom + 10, left };
}

/** Bir bölümde metin seçilince: renkle vurgula ya da vurgulayıp not yaz. */
export function SelectionNoteBar() {
  const context = useReaderNotes();
  const [picked, setPicked] = useState<Picked>();
  const [writing, setWriting] = useState<Picked>();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!context || context.state.status !== "ready") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setPicked(pickedSelection()), 180);
    };
    document.addEventListener("selectionchange", check);
    window.addEventListener("scroll", check, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", check);
      window.removeEventListener("scroll", check, true);
    };
  }, [context]);

  if (!context || context.state.status !== "ready") return null;
  const place = writing ?? picked;
  if (!place) return null;
  const style = placeAt(place, writing ? 250 : 44, writing ? 360 : 250);
  const done = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(undefined);
    setWriting(undefined);
    setDraft("");
  };

  if (writing) {
    return (
      <form
        className="note-bar is-writing"
        style={style}
        aria-label="Note on the highlight"
        onSubmit={(event) => {
          event.preventDefault();
          context.add({ target: writing.target, quote: writing.quote, text: draft });
          done();
        }}
      >
        <blockquote>{writing.quote.length > 140 ? `${writing.quote.slice(0, 140)}…` : writing.quote}</blockquote>
        <textarea autoFocus rows={3} maxLength={MAX_NOTE_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Your note" aria-label="Your note" />
        <div className="note-bar-actions">
          <button type="submit" className="note-save">Save</button>
          <button type="button" onClick={done}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className="note-bar" style={style} role="toolbar" aria-label="Highlight the selected text" onMouseDown={(event) => event.preventDefault()}>
      <Highlighter size={14} aria-hidden="true" />
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`note-swatch is-${color}`}
          aria-label={`Highlight in ${colorNames[color]}`}
          title={`Highlight in ${colorNames[color]}`}
          onClick={() => {
            context.add({ target: place.target, quote: place.quote, color });
            done();
          }}
        />
      ))}
      <button type="button" className="note-bar-write" onClick={() => setWriting(place)}><NotebookPen size={14} /> Note</button>
    </div>
  );
}

/* ---------------------------- İddia notları ---------------------------- */

/** Kanıt panelinde: iddiaya okuyucunun notu ve "önemli" işareti. */
export function ClaimNotes({ claimId }: { claimId: string }) {
  const context = useReaderNotes();
  const [draft, setDraft] = useState("");
  if (!context || context.state.status === "loading") return null;
  if (context.state.status === "failed") return <p className="regen-error">{context.state.message}</p>;
  const target: NoteTarget = { kind: "claim", claimId };
  const mine = context.notes.filter((note) => sameTarget(note.target, target));
  const mark = mine.find((note) => !note.text && !note.quote);
  const written = mine.filter((note) => note.text || note.quote);

  return (
    <section className="claim-notes" aria-label="Your notes on this claim">
      <div className="claim-notes-head">
        <h4>Your notes</h4>
        <button type="button" className={`claim-mark${mark ? " is-on" : ""}`} aria-pressed={Boolean(mark)} onClick={() => (mark ? context.remove(mark.id) : context.add({ target }))}>
          <Star size={13} /> {mark ? "Marked as important" : "Mark as important"}
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
        <textarea rows={2} maxLength={MAX_NOTE_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a note on this claim…" aria-label="A note on this claim" />
        <button type="submit" disabled={!draft.trim()}>Save note</button>
      </form>
      <small>Kept in your library, never in the project, its exports or published pages.</small>
      {context.saveError ? <p className="regen-error" role="status">Not saved: {context.saveError}</p> : null}
    </section>
  );
}

/** Bir not: vurgu, metin; düzenle, renk, sil. */
function NoteItem({ note }: { note: ReaderNote }) {
  const context = useReaderNotes()!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  return (
    <article className={`note-item is-${note.color}`}>
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
          <textarea autoFocus rows={3} maxLength={MAX_NOTE_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Edit the note" />
          <div className="note-bar-actions">
            <button type="submit" className="note-save">Save</button>
            <button type="button" onClick={() => { setDraft(note.text); setEditing(false); }}>Cancel</button>
          </div>
        </form>
      ) : note.text ? (
        <p>{note.text}</p>
      ) : null}
      {!editing ? (
        <div className="note-item-actions">
          {note.quote ? (
            <span className="note-colors" role="radiogroup" aria-label="Highlight colour">
              {NOTE_COLORS.map((color) => (
                <button key={color} type="button" role="radio" aria-checked={note.color === color} className={`note-swatch is-${color}`} aria-label={colorNames[color]} onClick={() => context.update(note.id, { color })} />
              ))}
            </span>
          ) : null}
          <button type="button" onClick={() => setEditing(true)}><Pencil size={13} /> {note.text ? "Edit" : "Add a note"}</button>
          <button type="button" onClick={() => context.remove(note.id)} aria-label="Delete this note"><Trash2 size={13} /> Delete</button>
        </div>
      ) : null}
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
export function NotesPanel({ project, onClaimSelect, onShowSection }: { project: ResearchProject; onClaimSelect: (claimId: string) => void; onShowSection: (place: "story" | "report", sectionId: string) => void }) {
  const context = useReaderNotes();
  const [targetKey, setTargetKey] = useState("");
  const [draft, setDraft] = useState("");
  const groups = useMemo(() => (context ? groupNotes(project, context.notes) : []), [context, project]);
  const targets = useMemo(() => [
    ...project.story.sections.map((section) => ({ key: `story:${section.id}`, label: `Story · ${section.title}`, target: { kind: "section", place: "story", sectionId: section.id } as NoteTarget })),
    ...(project.deepReport?.sections ?? []).map((section) => ({ key: `report:${section.id}`, label: `Deep report · ${section.title}`, target: { kind: "section", place: "report", sectionId: section.id } as NoteTarget })),
    ...project.evidence.claims.map((claim) => ({ key: `claim:${claim.id}`, label: `Claim · ${claim.statement.length > 90 ? `${claim.statement.slice(0, 90)}…` : claim.statement}`, target: { kind: "claim", claimId: claim.id } as NoteTarget })),
  ], [project]);
  if (!context) return null;
  if (context.state.status === "loading") return <p className="section-intro" role="status">Reading your notes…</p>;
  if (context.state.status === "failed") return <p className="regen-error" role="alert">{context.state.message}</p>;
  const count = context.notes.length;
  const chosen = targets.find((item) => item.key === targetKey) ?? targets[0];

  return (
    <div className="notes-panel">
      <p className="section-intro">
        Select any text in the Deep report or the Story preview to highlight it, or open a claim to write a note on it. Your notes are
        kept in your library, never in the project file, so exports and published pages do not carry them.
      </p>
      <div className="notes-export">
        <button type="button" disabled={!count} onClick={() => download(notesFileName(project), notesMarkdown(project, context.notes, { exportedAt: new Date().toISOString() }))}><Download size={14} /> Markdown</button>
        <button type="button" disabled={!count} onClick={() => download(notesFileName(project), notesMarkdown(project, context.notes, { obsidian: true, exportedAt: new Date().toISOString() }))}><Download size={14} /> For Obsidian</button>
        <span>{count ? `${count} ${count === 1 ? "note" : "notes and highlights"}` : "No notes yet"}</span>
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
          <span>Add a note to</span>
          <select value={chosen?.key ?? ""} onChange={(event) => setTargetKey(event.target.value)}>
            {targets.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <textarea rows={3} maxLength={MAX_NOTE_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Your note" aria-label="Your note" />
        <button type="submit" disabled={!draft.trim()}>Save note</button>
      </form>
      {context.saveError ? <p className="regen-error" role="status">Not saved: {context.saveError}</p> : null}
      {groups.map((group) => (
        <section key={`${group.place}-${group.heading}`} className="notes-group" aria-label={`${group.place}: ${group.heading}`}>
          <header>
            <span className="notes-place">{group.place}{group.page ? ` · p. ${group.page}` : ""}</span>
            <h3>{group.heading}</h3>
            {group.heading !== "No longer in the paper" ? (
              group.target.kind === "claim" ? (
                <button type="button" onClick={() => onClaimSelect((group.target as { claimId: string }).claimId)}>Open the claim</button>
              ) : (
                <button type="button" onClick={() => onShowSection((group.target as { place: "story" | "report" }).place, (group.target as { sectionId: string }).sectionId)}>Show it</button>
              )
            ) : null}
          </header>
          {group.notes.map((note) => (note.text || note.quote ? <NoteItem key={note.id} note={note} /> : (
            <p key={note.id} className="notes-marked"><Star size={13} /> Marked as important <button type="button" onClick={() => context.remove(note.id)} aria-label="Remove the mark"><X size={13} /></button></p>
          )))}
        </section>
      ))}
    </div>
  );
}
