import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cleanQuote, MAX_NOTE_TEXT, NOTE_COLORS, NOTE_PLACES, sectionMark, type NoteColor, type NotePlace, type NoteTarget, type ReaderNote } from "@/lib/reader-notes";

/**
 * Seçilen metni vurgulamak ve yanına not yazmak: stüdyo (`reader-notes.tsx`)
 * ve eklentinin bağımsız sitesi (`viewer/notes.tsx`) aynı çubuğu ve aynı
 * boyamayı kullanıyor. Notların nerede durduğu çağıranın işi (stüdyoda
 * kütüphane, sitede tarayıcı); burada yalnızca sayfa var: seçimi okumak,
 * çubuğu yerleştirmek, vurguları çizmek.
 *
 * Vurgular CSS Custom Highlight API ile çiziliyor: metne `<mark>` eklenmiyor,
 * bölümlerin DOM'u değişmiyor; tarayıcı desteklemiyorsa vurgu görünmüyor ama
 * not listesi ve dışa aktarım çalışıyor. Vurgulanabilen her yer
 * `data-note-section="<yer>:<kimlik>"` ile işaretli (`sectionMark`).
 */

/** Çubuğun metinleri; iki host da kendi sözlüğünden veriyor. */
export type NoteBarWords = {
  toolbar: string;
  highlightIn: (color: string) => string;
  colors: Record<NoteColor, string>;
  note: string;
  writeNote: string;
  form: string;
  yourNote: string;
  save: string;
  cancel: string;
};

export type NewHighlight = { target: NoteTarget; quote: string; color?: NoteColor; text?: string };

type HighlightRegistry = { set: (name: string, value: unknown) => void; delete: (name: string) => void };

/** Bölümün metninde alıntıyı bulur; boşluklar sayfada nasıl dağılmış olursa olsun. */
export function findQuote(root: Element, quote: string): Range | undefined {
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

/**
 * Notların vurgularını `scope` içindeki bölümlere çizer ve sayfa değiştikçe
 * (bölüm açılınca, sekme değişince, yeniden çizilince) yeniden çizer.
 * Temizleyiciyi döndürüyor; tarayıcı desteklemiyorsa hiçbir şey yapmıyor.
 */
export function paintNotes(notes: readonly ReaderNote[], scope: Element): () => void {
  const registry = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
  const HighlightType = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightType) return () => undefined;
  const paint = () => {
    const byColor = new Map<NoteColor, Range[]>();
    for (const note of notes) {
      if (!note.quote || note.target.kind !== "section") continue;
      const root = scope.querySelector(`[data-note-section="${CSS.escape(sectionMark(note.target.place, note.target.sectionId))}"]`);
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
  observer.observe(scope, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const color of NOTE_COLORS) registry.delete(`trace-note-${color}`);
  };
}

/* ------------------------- Seçim araç çubuğu ------------------------- */

export type Picked = { target: NoteTarget; quote: string; above: number; below: number; left: number };

/**
 * Araç çubuğunun yeri, fareyle: seçimin altında; sığmıyorsa üstünde; ne
 * olursa olsun ekranın içinde.
 */
export function placeAt(picked: Picked, height: number, width: number) {
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

export function dockAt(picked: Picked, height: number) {
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

export function pickedSelection(): Picked | undefined {
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

export function lastColor(): NoteColor {
  try {
    const stored = window.localStorage.getItem(LAST_COLOR_KEY);
    return NOTE_COLORS.find((color) => color === stored) ?? "yellow";
  } catch {
    return "yellow";
  }
}

export function rememberColor(color: NoteColor) {
  try {
    window.localStorage.setItem(LAST_COLOR_KEY, color);
  } catch {
    // Depolama kapalı: bir sonraki kısayol yine sarı.
  }
}

/** Yazı alanındayken harfler yazıya gidiyor, kısayola değil. */
export const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Bir bölümde metin seçilince: renkle vurgula ya da vurgulayıp not yaz.
 * Klavyeden de: seçim varken H son rengiyle vurguluyor, N not kutusunu açıyor.
 */
export function SelectionBar({ words: t, onAdd, icon, noteIcon }: { words: NoteBarWords; onAdd: (note: NewHighlight) => void; icon?: ReactNode; noteIcon?: ReactNode }) {
  // Ekleme ref'te: notlar her değiştiğinde dinleyiciler yeniden kurulmasın.
  const add = useRef(onAdd);
  useEffect(() => {
    add.current = onAdd;
  }, [onAdd]);
  const [picked, setPicked] = useState<Picked>();
  const [writing, setWriting] = useState<Picked>();
  const [draft, setDraft] = useState("");
  const [shortcutColor, setShortcutColor] = useState<NoteColor>("yellow");
  const coarse = useCoarsePointer();
  // Dokunmatikte görünür alan değişince (klavye açılınca, yakınlaştırınca) çubuk yeniden yaslanıyor.
  const [, setViewport] = useState(0);

  useEffect(() => {
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
  }, []);

  // Seçim o anda okunuyor: araç çubuğu kısa bir gecikmeyle çıkıyor, kısayol onu beklemiyor.
  useEffect(() => {
    if (writing) return;
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
      add.current({ target: selected.target, quote: selected.quote, color: lastColor() });
      window.getSelection()?.removeAllRanges();
      setPicked(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [writing]);

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
        aria-label={t.form}
        onSubmit={(event) => {
          event.preventDefault();
          add.current({ target: writing.target, quote: writing.quote, text: draft });
          done();
        }}
      >
        <blockquote>{writing.quote.length > 140 ? `${writing.quote.slice(0, 140)}…` : writing.quote}</blockquote>
        <textarea autoFocus rows={3} maxLength={MAX_NOTE_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.yourNote} aria-label={t.yourNote} />
        <div className="note-bar-actions">
          <button type="submit" className="note-save">{t.save}</button>
          <button type="button" onClick={done}>{t.cancel}</button>
        </div>
      </form>
    );
  }

  return (
    <div className={`note-bar${docked}`} style={style} role="toolbar" aria-label={t.toolbar} onMouseDown={(event) => event.preventDefault()}>
      {icon}
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`note-swatch is-${color}`}
          aria-label={t.highlightIn(t.colors[color])}
          title={`${t.highlightIn(t.colors[color])}${color === shortcutColor ? " (H)" : ""}`}
          aria-keyshortcuts={color === shortcutColor ? "H" : undefined}
          onClick={() => {
            add.current({ target: place.target, quote: place.quote, color });
            rememberColor(color);
            done();
          }}
        />
      ))}
      <button type="button" className="note-bar-write" onClick={() => setWriting(place)} title={t.writeNote} aria-keyshortcuts="N">{noteIcon}{noteIcon ? " " : null}{t.note}</button>
    </div>
  );
}

/* -------------------------- Nasıl yapıldığı -------------------------- */

const HINT_KEY = "trace-highlight-hint-seen";
const hintListeners = new Set<() => void>();
let hintDismissed = false;

function hintSeen() {
  if (hintDismissed) return true;
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Vurgulamanın nasıl yapıldığını söyleyen ipucu gösterilmeli mi, ve onu
 * kapatmak. Okuyucu "Anladım" deyince bu tarayıcıda bir daha gösterilmiyor;
 * depolama kapalıysa bu oturumda gizli kalıyor. Sunucuda ve ilk çizimde
 * gösterilmiyor (tarayıcının kaydı orada okunamıyor).
 */
export function useHighlightHint(): [seen: boolean, dismiss: () => void] {
  const seen = useSyncExternalStore(
    (listener) => {
      hintListeners.add(listener);
      return () => {
        hintListeners.delete(listener);
      };
    },
    hintSeen,
    () => true,
  );
  return [seen, dismissHint];
}

function dismissHint() {
  hintDismissed = true;
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Kaydedilemedi: bu oturumda yine de gizli.
  }
  hintListeners.forEach((listener) => listener());
}
