"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Highlighter, Layers, NotebookPen, Pencil, Star, Trash2, Users, X } from "lucide-react";
import { addHighlightCard, clozeCandidates, highlightCardOf, removeHighlightCard } from "@/lib/highlight-cards";
import {
  cleanQuote,
  groupNotes,
  MAX_NOTE_TEXT,
  NOTE_COLORS,
  NOTE_PLACES,
  notesFileName,
  notesMarkdown,
  sameTarget,
  sectionMark,
  type NoteColor,
  type NotePlace,
  type NoteTarget,
  type ReaderNote,
} from "@/lib/reader-notes";
import { describeDue } from "@/lib/review-schedule";
import type { ResearchProject } from "@/lib/schema";
import type { StudyProgress } from "@/lib/study-path";
import { useTeamMember } from "./team";

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

const colorNames: Record<NoteColor, string> = { yellow: "yellow", green: "green", blue: "blue", pink: "pink", purple: "purple" };
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
    update: (id, patch) => commit((current) => current.map((note) => (note.id === id && !isOthersNote(note) ? { ...note, ...patch, ...(patch.text !== undefined ? { text: patch.text.trim().slice(0, MAX_NOTE_TEXT) } : {}), updatedAt: new Date().toISOString() } : note))),
    remove: (id) => commit((current) => current.filter((note) => note.id !== id || isOthersNote(note))),
    share: (id, shared) => commit((current) => current.map((note) => (note.id === id && !isOthersNote(note) ? { ...note, shared, updatedAt: new Date().toISOString() } : note))),
    team,
  }), [commit, notes, saveError, state, team]);

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
 * Araç çubuğunun yeri, fareyle: seçimin altında; sığmıyorsa üstünde; ne
 * olursa olsun ekranın içinde.
 */
function placeAt(picked: Picked, height: number, width: number) {
  const room = window.innerHeight - 12;
  const top = picked.below + height <= room ? picked.below : picked.above - height;
  const half = Math.min(width, window.innerWidth - 24) / 2;
  return { top: Math.max(12, Math.min(top, room - height)), left: Math.max(12 + half, Math.min(picked.left, window.innerWidth - 12 - half)) };
}

/**
 * Dokunmatik ekranda seçimin hemen üstünde telefonun kendi menüsü (Kopyala,
 * Paylaş), hemen altında seçimi büyütüp küçülten tutamaçlar duruyor. Çubuk
 * seçimin yanına konunca ikisinden birini örtüyordu; burada ekranın altına
 * yaslanıyor, görünür alana göre (açılan klavye de sayılıyor). Seçim alttaki
 * yere kadar iniyorsa çubuk ekranın üstüne geçiyor.
 */
const HANDLE_ROOM = 48;

function dockAt(picked: Picked, height: number) {
  const view = window.visualViewport;
  const top = view?.offsetTop ?? 0;
  const bottom = top + (view?.height ?? window.innerHeight);
  const left = (view?.offsetLeft ?? 0) + (view?.width ?? window.innerWidth) / 2;
  // Altta `bottom` ile: çubuğun gerçek yüksekliği ne olursa olsun kenara oturuyor; `height` yalnızca yer hesabı için.
  if (picked.below + HANDLE_ROOM > bottom - height - 12) return { style: { top: top + 12, left }, edge: "top" as const };
  return { style: { bottom: window.innerHeight - bottom + 12, left }, edge: "bottom" as const };
}

/** Parmakla mı kullanılıyor: telefon ve tablet. Fare bağlı bir tablette `false`. */
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(query.matches);
    const first = setTimeout(update, 0);
    query.addEventListener("change", update);
    return () => {
      clearTimeout(first);
      query.removeEventListener("change", update);
    };
  }, []);
  return coarse;
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
  if (!NOTE_PLACES.includes(place as NotePlace) || !rest.length) return undefined;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const left = Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2));
  return { target: { kind: "section", place: place as NotePlace, sectionId: rest.join(":") }, quote, above: rect.top - 10, below: rect.bottom + 10, left };
}

/** Klavyeyle vurgunun rengi: araç çubuğunda en son seçilen, ilk seferde sarı. Bu cihaza ait. */
const LAST_COLOR_KEY = "trace-note-color";

function lastColor(): NoteColor {
  try {
    const stored = window.localStorage.getItem(LAST_COLOR_KEY);
    return NOTE_COLORS.find((color) => color === stored) ?? "yellow";
  } catch {
    return "yellow";
  }
}

function rememberColor(color: NoteColor) {
  try {
    window.localStorage.setItem(LAST_COLOR_KEY, color);
  } catch {
    // Depolama kapalı: bir sonraki kısayol yine sarı.
  }
}

/** Yazı alanındayken harfler yazıya gidiyor, kısayola değil. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Bir bölümde metin seçilince: renkle vurgula ya da vurgulayıp not yaz.
 * Klavyeden de: seçim varken H son rengiyle vurguluyor, N not kutusunu açıyor.
 */
export function SelectionNoteBar() {
  const context = useReaderNotes();
  const [picked, setPicked] = useState<Picked>();
  const [writing, setWriting] = useState<Picked>();
  const [draft, setDraft] = useState("");
  const [shortcutColor, setShortcutColor] = useState<NoteColor>("yellow");
  const coarse = useCoarsePointer();
  // Dokunmatikte görünür alan değişince (klavye açılınca, yakınlaştırınca) çubuk yeniden yaslanıyor.
  const [, setViewport] = useState(0);

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

  // Seçim o anda okunuyor: araç çubuğu kısa bir gecikmeyle çıkıyor, kısayol onu beklemiyor.
  useEffect(() => {
    if (!context || context.state.status !== "ready" || writing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || typing(event.target)) return;
      const key = event.key.toLowerCase();
      if (key !== "h" && key !== "n") return;
      const selected = pickedSelection();
      if (!selected) return;
      event.preventDefault();
      if (key === "n") {
        setPicked(selected);
        setWriting(selected);
        return;
      }
      context.add({ target: selected.target, quote: selected.quote, color: lastColor() });
      window.getSelection()?.removeAllRanges();
      setPicked(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [context, writing]);

  useEffect(() => {
    const view = window.visualViewport;
    if (!coarse || !view || !(picked || writing)) return;
    const update = () => setViewport((tick) => tick + 1);
    view.addEventListener("resize", update);
    view.addEventListener("scroll", update);
    return () => {
      view.removeEventListener("resize", update);
      view.removeEventListener("scroll", update);
    };
  }, [coarse, picked, writing]);

  // Araç çubuğu açılınca H'nin rengi gösteriliyor.
  useEffect(() => {
    if (!picked) return;
    const read = setTimeout(() => setShortcutColor(lastColor()), 0);
    return () => clearTimeout(read);
  }, [picked]);

  if (!context || context.state.status !== "ready") return null;
  const place = writing ?? picked;
  if (!place) return null;
  const dock = coarse ? dockAt(place, writing ? 250 : 56) : undefined;
  const style = dock ? dock.style : placeAt(place, writing ? 250 : 44, writing ? 360 : 250);
  const docked = dock ? ` is-docked is-docked-${dock.edge}` : "";
  const done = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(undefined);
    setWriting(undefined);
    setDraft("");
  };

  if (writing) {
    return (
      <form
        className={`note-bar is-writing${docked}`}
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
    <div className={`note-bar${docked}`} style={style} role="toolbar" aria-label="Highlight the selected text" onMouseDown={(event) => event.preventDefault()}>
      <Highlighter size={14} aria-hidden="true" />
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`note-swatch is-${color}`}
          aria-label={`Highlight in ${colorNames[color]}`}
          title={`Highlight in ${colorNames[color]}${color === shortcutColor ? " (H)" : ""}`}
          aria-keyshortcuts={color === shortcutColor ? "H" : undefined}
          onClick={() => {
            context.add({ target: place.target, quote: place.quote, color });
            rememberColor(color);
            done();
          }}
        />
      ))}
      <button type="button" className="note-bar-write" onClick={() => setWriting(place)} title="Write a note (N)" aria-keyshortcuts="N"><NotebookPen size={14} /> Note</button>
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
  const mark = mine.find((note) => !note.text && !note.quote && !isOthersNote(note));
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

/** Lab'in çalışma kaydı: vurgudan kart yapmak ve silinen vurgunun kartını kaldırmak için. */
export type NoteStudy = { progress?: StudyProgress; save: (progress: StudyProgress | undefined) => void };
type CardSource = { project: ResearchProject; study: NoteStudy; where: string };

/**
 * Vurgudan tekrar kartı (`highlight-cards.ts`): gizlenecek kelime seçiliyor,
 * kart Review'a giriyor. Kart varsa ne gizlediği ve ne zaman döneceği.
 */
function HighlightCard({ note, source, choosing, onChoosing }: { note: ReaderNote; source: CardSource; choosing: boolean; onChoosing: (open: boolean) => void }) {
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
        <Layers size={13} aria-hidden="true" /> In review, hiding “{card.cloze.answer}”: it comes back {describeDue(card.due, now)}.
      </p>
    );
  }
  const chosen = candidates[pick];
  if (!chosen) return null;
  return (
    <div className="note-card-maker" role="group" aria-label="A review card from this highlight">
      <p className="note-card-preview">
        {quote.slice(0, chosen.at)}
        <span className="cloze-blank"><span aria-label="blank">_____</span></span>
        {quote.slice(chosen.at + chosen.answer.length)}
      </p>
      <div className="note-card-words" role="radiogroup" aria-label="The word to hide">
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
          {card ? "Save the card" : "Add to review"}
        </button>
        {card ? (
          <button
            type="button"
            onClick={() => {
              source.study.save(removeHighlightCard(source.study.progress, note.id, new Date().toISOString()));
              onChoosing(false);
            }}
          >
            Stop reviewing it
          </button>
        ) : null}
        <button type="button" onClick={() => onChoosing(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** Bir not: vurgu, metin; düzenle, renk, sil; vurgudan tekrar kartı. */
function NoteItem({ note, source }: { note: ReaderNote; source?: CardSource }) {
  const context = useReaderNotes()!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [choosing, setChoosing] = useState(false);
  const canCard = Boolean(source && note.quote && clozeCandidates(note.quote, source.project).length);
  const hasCard = Boolean(source && highlightCardOf(source.study.progress, note.id));
  if (isOthersNote(note)) {
    return (
      <article className={`note-item is-${note.color} is-shared-by-other`}>
        <p className="note-author">Shared by {note.authorName}</p>
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
          {context.team && (note.text || note.quote) ? (
            <button type="button" aria-pressed={Boolean(note.shared)} onClick={() => context.share(note.id, !note.shared)} title={note.shared ? "The team can read this note" : "Only you can read this note"}>
              <Users size={13} /> {note.shared ? "Shared with the team" : "Share with the team"}
            </button>
          ) : null}
          {canCard && !choosing ? (
            <button type="button" onClick={() => setChoosing(true)}><Layers size={13} /> {hasCard ? "Change the card" : "Make a review card"}</button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              // Silinen vurgunun kartı da gidiyor: artık olmayan bir vurguyu sormak anlamsız.
              if (source && hasCard) source.study.save(removeHighlightCard(source.study.progress, note.id, new Date().toISOString()));
              context.remove(note.id);
            }}
            aria-label="Delete this note"
          >
            <Trash2 size={13} /> Delete
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
  const context = useReaderNotes();
  const [targetKey, setTargetKey] = useState("");
  const [draft, setDraft] = useState("");
  const groups = useMemo(() => (context ? groupNotes(project, context.notes) : []), [context, project]);
  const targets = useMemo(() => [
    ...project.story.sections.map((section) => ({ key: `story:${section.id}`, label: `Story · ${section.title}`, target: { kind: "section", place: "story", sectionId: section.id } as NoteTarget })),
    ...(project.deepReport?.sections ?? []).map((section) => ({ key: `report:${section.id}`, label: `Deep report · ${section.title}`, target: { kind: "section", place: "report", sectionId: section.id } as NoteTarget })),
    ...(project.primer?.concepts ?? []).map((concept) => ({ key: `concept:${concept.id}`, label: `Primer · ${concept.term}`, target: { kind: "section", place: "concept", sectionId: concept.id } as NoteTarget })),
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
        Select any text in the Deep report, the Story preview, a Study step or a Primer concept to highlight it (or press H, and N for a note), or open a claim to write a note on it. Your notes are
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
                <button type="button" onClick={() => onShowSection((group.target as { place: NotePlace }).place, (group.target as { sectionId: string }).sectionId)}>Show it</button>
              )
            ) : null}
          </header>
          {group.notes.map((note) => (note.text || note.quote ? <NoteItem key={note.id} note={note} source={study ? { project, study, where: group.heading === "No longer in the paper" ? "" : group.heading } : undefined} /> : (
            <p key={note.id} className="notes-marked"><Star size={13} /> Marked as important <button type="button" onClick={() => context.remove(note.id)} aria-label="Remove the mark"><X size={13} /></button></p>
          )))}
        </section>
      ))}
    </div>
  );
}
