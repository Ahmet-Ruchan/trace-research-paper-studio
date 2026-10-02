"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { useT } from "@/i18n/client";
import { PALETTE_GROUPS, rankPaletteCommands, type PaletteCommand, type PaletteTarget } from "@/lib/command-palette";

/**
 * Komut paleti (`command-palette.ts`): Ctrl+K (Mac'te ⌘K) her ekranda açıyor.
 * Yazılan sorgu makaleleri, açık makalenin bölümlerini ve eylemleri süzüyor;
 * oklar seçiyor, Enter çalıştırıyor, Escape kapatıyor.
 *
 * Komutlar açılırken bir kez kuruluyor (`build`): palet kapalıyken stüdyonun
 * her çiziminde liste hesaplanmıyor.
 */

export const OPEN_PALETTE_EVENT = "trace:open-palette";

/** Üst menüdeki düğme ve başka yerler paleti bu olayla açıyor. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

export function CommandPalette({ build, onRun }: { build: () => PaletteCommand[]; onRun: (target: PaletteTarget) => void }) {
  const t = useT().studio.commandPalette;
  const [open, setOpen] = useState(false);
  const [commands, setCommands] = useState<PaletteCommand[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const buildRef = useRef(build);
  const openRef = useRef(open);
  useEffect(() => {
    buildRef.current = build;
    openRef.current = open;
  });

  useEffect(() => {
    const show = () => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCommands(buildRef.current());
      setQuery("");
      setActive(0);
      setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      // Açıkken aynı kısayol kapatıyor.
      if (openRef.current) {
        setOpen(false);
        const target = returnFocus.current;
        setTimeout(() => { if (target?.isConnected) target.focus(); }, 0);
      } else show();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, show);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const focus = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(focus);
  }, [open]);

  const words = t.words;
  const results = useMemo(() => rankPaletteCommands(commands, query, undefined, words), [commands, query, words]);
  // Sorgu boşken gruplar sırayla; bir sorguda en iyi eşleşme önce, grup başlığı her değişimde.
  const rows = useMemo(() => {
    const ordered = query.trim() ? results : PALETTE_GROUPS.flatMap((group) => results.filter((command) => command.group === group));
    return ordered.map((command, index) => ({ command, index, heading: index === 0 || ordered[index - 1].group !== command.group ? command.group : undefined }));
  }, [results, query]);
  const current = Math.min(active, Math.max(0, rows.length - 1));

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, open]);

  function close(restore = true) {
    setOpen(false);
    if (restore) {
      const target = returnFocus.current;
      setTimeout(() => {
        if (target?.isConnected) target.focus();
      }, 0);
    }
  }

  function run(command: PaletteCommand | undefined) {
    if (!command) return;
    close(false);
    onRun(command.target);
  }

  if (!open) return null;
  const activeRow = rows[current];

  return (
    <div className="palette-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t.dialog}>
        <div className="palette-field">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={activeRow ? `palette-${activeRow.index}` : undefined}
            aria-autocomplete="list"
            aria-label={t.input}
            placeholder={t.placeholder}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!rows.length) return;
                setActive((current + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
              } else if (event.key === "Home" && event.ctrlKey) {
                event.preventDefault();
                setActive(0);
              } else if (event.key === "End" && event.ctrlKey) {
                event.preventDefault();
                setActive(Math.max(0, rows.length - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(activeRow?.command);
              } else if (event.key === "Escape") {
                // Arkadaki bir panel de Escape'i dinliyor olabilir; yalnızca palet kapansın.
                event.preventDefault();
                event.stopPropagation();
                close();
              } else if (event.key === "Tab") {
                event.preventDefault();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" aria-label={t.results} ref={list}>
          {rows.map(({ command, index, heading }) => (
            <li key={command.id} role="none">
              {heading ? <span className="palette-group" aria-hidden="true">{words.groups[heading]}</span> : null}
              <div
                id={`palette-${index}`}
                role="option"
                aria-selected={index === current}
                data-index={index}
                className={`palette-option${index === current ? " is-active" : ""}`}
                onMouseMove={() => { if (index !== current) setActive(index); }}
                onClick={() => run(command)}
              >
                <span className="palette-label">{command.label}</span>
                {command.detail ? <small>{command.detail}</small> : null}
                {index === current ? <CornerDownLeft size={13} aria-hidden="true" /> : null}
              </div>
            </li>
          ))}
        </ul>
        {!rows.length ? <p className="palette-empty" role="status">{t.nothingMatches(query.trim())}</p> : null}
        <p className="palette-hint" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd>{t.hintChoose}<kbd>Enter</kbd>{t.hintOpen}<kbd>Ctrl</kbd> <kbd>K</kbd>{t.hintAnywhere}</p>
      </div>
    </div>
  );
}
