"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookmarkCheck, BookmarkPlus, ExternalLink, Trash2 } from "lucide-react";
import { useT } from "@/i18n/client";
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
  /** Birçoğunu birden (Zotero ya da .bib); başarısızsa hata fırlatıyor. */
  addAll: (items: ReadingItem[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Liste başka bir yoldan değişti (yedeğin içe aktarılması): yeniden okunuyor. */
  reload: () => Promise<void>;
};

const ReadingContext = createContext<ReadingValue | undefined>(undefined);

export function useReadingList() {
  return useContext(ReadingContext);
}

/** `failed`: sunucu bir hata yazmadığında. */
async function send(request: Promise<Response>, failed: string) {
  const response = await request;
  const data = (await response.json().catch(() => undefined)) as { items?: ReadingItem[]; error?: string } | undefined;
  if (!response.ok || !data?.items) throw new Error(data?.error ?? failed);
  return data.items;
}

export function ReadingListProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  // Hata metinleri ref'te: liste dil değişince yeniden okunmasın.
  const t = useT().learning.readingList;
  const text = useRef(t);
  useEffect(() => {
    text.current = t;
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    send(fetch("/api/library/reading-list", { cache: "no-store" }), text.current.saveFailed)
      .then((next) => {
        if (cancelled) return;
        setItems(next);
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : text.current.readFailed);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (request: Promise<Response>) => {
    try {
      setItems(await send(request, text.current.saveFailed));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.current.saveFailed);
    }
  }, []);

  const value = useMemo<ReadingValue>(() => ({
    items,
    ready,
    error,
    has: (id) => items.some((item) => item.id === id),
    add: (item) => run(fetch("/api/library/reading-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) })),
    remove: (id) => run(fetch(`/api/library/reading-list?id=${encodeURIComponent(id)}`, { method: "DELETE" })),
    addAll: async (incoming) => {
      setItems(await send(fetch("/api/library/reading-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: incoming }) }), text.current.saveFailed));
      setError(undefined);
    },
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
  const t = useT().learning.readingList;
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
      title={saved ? t.onListTitle : t.saveTitle}
      onClick={async () => {
        setBusy(true);
        await (saved ? list.remove(id) : list.add(readingItemFor(work, from)));
        setBusy(false);
      }}
    >
      {saved ? <BookmarkCheck size={13} /> : <BookmarkPlus size={13} />} {saved ? t.onList : t.readLater}
    </button>
  );
}

/** Okuma listesindeki bir çalışma: başlık, bilgi, neden burada, analiz et / aç / çıkar. */
export function SavedWork({ place, inOrder, onOpen, onAnalyse }: { place: SavedPlace; inOrder: boolean; onOpen: (project: ResearchProject) => void; onAnalyse?: (work: { identifier: string; title: string }) => void }) {
  const messages = useT();
  const learning = messages.learning;
  const t = learning.readingList;
  const list = useReadingList();
  const { item, owned, why } = place;
  const meta = [item.authors.length ? `${item.authors.slice(0, 3).join(", ")}${item.authors.length > 3 ? t.etAl : ""}` : "", item.year, item.venue].filter(Boolean).join(" · ");
  return (
    <>
      <div className="reading-head">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="reading-title">{item.title} <ExternalLink size={12} aria-hidden="true" /></a>
        ) : (
          <span className="reading-title">{item.title}</span>
        )}
        <strong className="reading-saved">{t.readLater}</strong>
      </div>
      {meta ? <p className="reading-meta">{meta}</p> : null}
      <p className="reading-why">{owned ? t.nowOwned : why ? (inOrder ? savedReason(why, learning.words.savedReason) : savedFrom(why, learning.words.savedReason)) : item.from.length ? t.orphan : t.alone}</p>
      <div className="reading-actions">
        {owned ? (
          <button type="button" onClick={() => onOpen(owned)}>{t.openIt}</button>
        ) : onAnalyse ? (
          <button type="button" onClick={() => onAnalyse({ identifier: item.identifier ?? item.title, title: item.title })}>{item.pdfAvailable === false ? t.lookUp : t.analyze}</button>
        ) : null}
        <button type="button" className="reading-remove" onClick={() => void list?.remove(item.id)} aria-label={t.removeLabel(item.title)}><Trash2 size={13} /> {messages.common.remove}</button>
      </div>
    </>
  );
}
