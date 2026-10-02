import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cleanQuote,
  groupNotes,
  MAX_NOTE_TEXT,
  MAX_NOTES_PER_PAPER,
  notesFileName,
  notesMarkdown,
  ORPHAN_HEADING,
  readerNoteSchema,
  type NoteTarget,
  type ReaderNote,
} from "@/lib/reader-notes";
import type { ResearchProject } from "@/lib/schema";
import { useStrings } from "@/visuals";
import { paintNotes, SelectionBar, useHighlightHint, type NewHighlight, type NoteBarWords } from "@/visuals/note-bar";

/**
 * Bağımsız sitede (deliver'ın açtığı yerel site, tek dosyalık çıktı,
 * yayınlanmış sayfa) vurgular ve notlar.
 *
 * Çubuk ve boyama stüdyoyla ortak (`@/visuals/note-bar`). Notlar bu
 * tarayıcıda kalıyor: sayfa paylaşılabilir ve hiçbir sunucuya yazamaz; sıkı
 * CSP'si de ağa çıkmasına izin vermiyor. Proje dosyasına ya da sayfaya hiçbir
 * şey yazılmıyor; okuyucu saklamak isterse Markdown olarak indiriyor.
 * Depolama kapalıysa (gizli pencere, dosya izinleri) vurgular sayfa açık
 * kaldıkça duruyor ve panel bunu söylüyor.
 */
const notesKey = (projectId: string) => `trace-notes-v1:${projectId}`;
const newId = () => `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Kayıttaki notlar, tek tek doğrulanarak: bozuk bir kayıt ötekileri götürmüyor. */
function readNotes(projectId: string): ReaderNote[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(notesKey(projectId)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .flatMap((item) => {
        const parsed = readerNoteSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, MAX_NOTES_PER_PAPER);
  } catch {
    return [];
  }
}

/** Yazabildiyse `true`. */
function writeNotes(projectId: string, notes: readonly ReaderNote[]) {
  try {
    if (notes.length) window.localStorage.setItem(notesKey(projectId), JSON.stringify(notes));
    else window.localStorage.removeItem(notesKey(projectId));
    return true;
  } catch {
    return false;
  }
}

export function useViewerNotes(projectId: string) {
  const [notes, setNotes] = useState<ReaderNote[]>(() => readNotes(projectId));
  const [kept, setKept] = useState(true);

  // Aynı sayfa başka bir sekmede de açıksa orada yapılanlar buraya da geliyor.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === notesKey(projectId)) setNotes(readNotes(projectId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  const commit = useCallback((next: ReaderNote[]) => {
    setNotes(next);
    setKept(writeNotes(projectId, next));
  }, [projectId]);

  const add = useCallback((input: NewHighlight) => {
    const quote = cleanQuote(input.quote);
    if (!quote || notes.length >= MAX_NOTES_PER_PAPER) return;
    const at = new Date().toISOString();
    commit([...notes, { id: newId(), target: input.target, quote, text: (input.text ?? "").trim().slice(0, MAX_NOTE_TEXT), color: input.color ?? "yellow", createdAt: at, updatedAt: at }]);
  }, [commit, notes]);

  const remove = useCallback((id: string) => commit(notes.filter((note) => note.id !== id)), [commit, notes]);

  return { notes, kept, add, remove };
}

/** Seçim çubuğu, sitenin dilinde. */
export function ViewerSelectionBar({ onAdd }: { onAdd: (note: NewHighlight) => void }) {
  const t = useStrings();
  const words = useMemo<NoteBarWords>(
    () => ({ toolbar: t.noteToolbar, highlightIn: t.highlightIn, colors: t.noteColors, note: t.noteAction, writeNote: t.writeNote, form: t.noteForm, yourNote: t.yourNote, save: t.save, cancel: t.cancel }),
    [t],
  );
  return <SelectionBar words={words} onAdd={onAdd} />;
}

/** Vurgular sayfanın içeriğine çiziliyor; sekme değişince yeniden. */
export function ViewerNoteHighlights({ notes }: { notes: readonly ReaderNote[] }) {
  useEffect(() => paintNotes(notes, document.querySelector(".viewer-main") ?? document.body), [notes]);
  return null;
}

/** Vurgulamanın nasıl yapıldığı; "Anladım" denince bu tarayıcıda bir daha gösterilmiyor. */
export function ViewerHighlightHint() {
  const t = useStrings();
  const [seen, dismiss] = useHighlightHint();
  if (seen) return null;
  return (
    <div className="viewer-hint">
      <aside className="highlight-hint" role="note">
        <p>{t.highlightHint}</p>
        <button type="button" onClick={dismiss}>{t.highlightHintDismiss}</button>
      </aside>
    </div>
  );
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Notlar paneli: makaledeki sırayla, yerine götüren düğmeyle; Markdown ve Obsidian için indirme. */
export function ViewerNotesPanel({
  project,
  notes,
  kept,
  onRemove,
  onShow,
  onClose,
}: {
  project: ResearchProject;
  notes: readonly ReaderNote[];
  kept: boolean;
  onRemove: (id: string) => void;
  onShow: (target: NoteTarget) => void;
  onClose: () => void;
}) {
  const t = useStrings();
  const groups = useMemo(() => groupNotes(project, notes, t.paperBlocks), [project, notes, t.paperBlocks]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const exportAs = (obsidian: boolean) => download(notesFileName(project), notesMarkdown(project, notes, { obsidian, exportedAt: new Date().toISOString() }));

  return (
    <div className="viewer-notes-overlay" onClick={onClose}>
      <aside className="viewer-notes-panel" role="dialog" aria-modal="true" aria-label={t.notesTitle} onClick={(event) => event.stopPropagation()}>
        <header className="viewer-notes-head">
          <h2>{t.notesTitle}</h2>
          <button type="button" onClick={onClose}>{t.close}</button>
        </header>
        <p className="viewer-notes-private" role={kept ? undefined : "status"}>{kept ? t.notesPrivate : t.notesNotKept}</p>
        {groups.length ? (
          groups.map((group, index) => {
            const orphan = group.heading === ORPHAN_HEADING && index === groups.length - 1;
            return (
              <section className="viewer-notes-group" key={`${group.place}-${index}`}>
                <header>
                  <span className="viewer-notes-place">{t.notePlaces[group.place]}</span>
                  <h3>{orphan ? t.notesOrphans : group.heading}</h3>
                  {!orphan && group.target.kind === "section" ? (
                    <button type="button" onClick={() => onShow(group.target)}>{t.notesShow}</button>
                  ) : null}
                </header>
                {group.notes.map((note) => (
                  <article className={`note-item is-${note.color}`} key={note.id}>
                    {note.quote ? <blockquote>{note.quote}</blockquote> : null}
                    {note.text ? <p>{note.text}</p> : null}
                    <div className="note-item-actions">
                      <button type="button" onClick={() => onRemove(note.id)}>{t.notesDelete}</button>
                    </div>
                  </article>
                ))}
              </section>
            );
          })
        ) : (
          <p className="viewer-notes-empty">{t.notesEmpty}</p>
        )}
        {notes.length ? (
          <div className="viewer-notes-export">
            <button type="button" onClick={() => exportAs(false)}>{t.notesMarkdown}</button>
            <button type="button" onClick={() => exportAs(true)}>{t.notesObsidian}</button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
