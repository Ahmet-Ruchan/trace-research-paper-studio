"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BookmarkCheck, BookmarkPlus, ExternalLink, Trash2 } from "lucide-react";
import { savedFrom, savedReason, workKey, type ReadingItem, type ReadingSource, type SavedPlace } from "@/lib/reading-list";
import type { ResearchProject } from "@/lib/schema";

/**
 * Okuma listesi (`reading-list.ts`), stüdyonun her ekranında tek kaynak:
 * atıf grafiği ve kavram önerileri ekliyor, kavram haritasındaki okuma sırası
 * gösteriyor, kütüphane sayıyor. Her değişiklik sunucuda kilitle yapılıyor
 * ve yanıt listenin son hâli.
 */

type ReadingValue = {
  items: ReadingItem[];
  ready: boolean;
  error?: string;
  has: (id: string) => boolean;
  add: (item: ReadingItem) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Liste başka bir yoldan değişti (yedeğin içe aktarılması): yeniden okunuyor. */
  reload: () => Promise<void>;
};

const ReadingContext = createContext<ReadingValue | undefined>(undefined);

export function useReadingList() {
  return useContext(ReadingContext);
}

async function send(request: Promise<Response>) {
  const response = await request;
  const data = (await response.json().catch(() => undefined)) as { items?: ReadingItem[]; error?: string } | undefined;
  if (!response.ok || !data?.items) throw new Error(data?.error ?? "The reading list could not be saved.");
  return data.items;
}

export function ReadingListProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    send(fetch("/api/library/reading-list", { cache: "no-store" }))
      .then((next) => {
        if (cancelled) return;
        setItems(next);
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The reading list could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (request: Promise<Response>) => {
    try {
      setItems(await send(request));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reading list could not be saved.");
    }
  }, []);

  const value = useMemo<ReadingValue>(() => ({
    items,
    ready,
    error,
    has: (id) => items.some((item) => item.id === id),
    add: (item) => run(fetch("/api/library/reading-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) })),
    remove: (id) => run(fetch(`/api/library/reading-list?id=${encodeURIComponent(id)}`, { method: "DELETE" })),
    reload: () => run(fetch("/api/library/reading-list", { cache: "no-store" })),
  }), [error, items, ready, run]);

  return <ReadingContext.Provider value={value}>{children}</ReadingContext.Provider>;
}

export type Work = { title: string; authors?: string[]; year?: number; venue?: string; identifier?: string; doi?: string; url?: string; pdfAvailable?: boolean; citationCount?: number };

/** Listeye girecek kayıt: yalnızca bilinen alanlar, web adresi yalnızca http(s). */
export function readingItemFor(work: Work, from: ReadingSource): ReadingItem {
  return {
    id: workKey(work),
    title: work.title.trim().slice(0, 500),
    authors: (work.authors ?? []).slice(0, 12).map((author) => author.slice(0, 200)),
    ...(work.year ? { year: work.year } : {}),
    ...(work.venue ? { venue: work.venue.slice(0, 300) } : {}),
    ...(work.identifier ? { identifier: work.identifier.slice(0, 600) } : {}),
    ...(work.url && /^https?:\/\//i.test(work.url) ? { url: work.url.slice(0, 2000) } : {}),
    ...(work.pdfAvailable !== undefined ? { pdfAvailable: work.pdfAvailable } : {}),
    ...(work.citationCount !== undefined ? { citationCount: Math.max(0, Math.round(work.citationCount)) } : {}),
    from: [from],
    addedAt: new Date().toISOString(),
  };
}

/** "Read later": listede değilse ekler, listedeyse çıkarır. */
export function ReadLaterButton({ work, from }: { work: Work; from: ReadingSource }) {
  const list = useReadingList();
  const [busy, setBusy] = useState(false);
  if (!list?.ready) return null;
  const id = workKey(work);
  const saved = list.has(id);
  return (
    <button
      type="button"
      className={`read-later${saved ? " is-saved" : ""}`}
      aria-pressed={saved}
      disabled={busy}
      title={saved ? "On your reading list; press to remove it" : "Save it to read later; it takes its place in your reading order"}
      onClick={async () => {
        setBusy(true);
        await (saved ? list.remove(id) : list.add(readingItemFor(work, from)));
        setBusy(false);
      }}
    >
      {saved ? <BookmarkCheck size={13} /> : <BookmarkPlus size={13} />} {saved ? "On your list" : "Read later"}
    </button>
  );
}

/** Okuma listesindeki bir çalışma: başlık, bilgi, neden burada, analiz et / aç / çıkar. */
export function SavedWork({ place, inOrder, onOpen, onAnalyse }: { place: SavedPlace; inOrder: boolean; onOpen: (project: ResearchProject) => void; onAnalyse?: (work: { identifier: string; title: string }) => void }) {
  const list = useReadingList();
  const { item, owned, why } = place;
  const meta = [item.authors.length ? `${item.authors.slice(0, 3).join(", ")}${item.authors.length > 3 ? " et al." : ""}` : "", item.year, item.venue].filter(Boolean).join(" · ");
  return (
    <>
      <div className="reading-head">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="reading-title">{item.title} <ExternalLink size={12} aria-hidden="true" /></a>
        ) : (
          <span className="reading-title">{item.title}</span>
        )}
        <strong className="reading-saved">Read later</strong>
      </div>
      {meta ? <p className="reading-meta">{meta}</p> : null}
      <p className="reading-why">{owned ? "Now in your library." : why ? (inOrder ? savedReason(why) : savedFrom(why)) : item.from.length ? "Saved from a paper no longer in your library." : "Saved on its own."}</p>
      <div className="reading-actions">
        {owned ? (
          <button type="button" onClick={() => onOpen(owned)}>Open it</button>
        ) : onAnalyse ? (
          <button type="button" onClick={() => onAnalyse({ identifier: item.identifier ?? item.title, title: item.title })}>{item.pdfAvailable === false ? "Look it up" : "Analyze it"}</button>
        ) : null}
        <button type="button" className="reading-remove" onClick={() => void list?.remove(item.id)} aria-label={`Remove ${item.title} from your reading list`}><Trash2 size={13} /> Remove</button>
      </div>
    </>
  );
}
