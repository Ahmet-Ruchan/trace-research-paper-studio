"use client";

import { useEffect, useState } from "react";
import { Copy, Link2, RefreshCw } from "lucide-react";
import type { ReadingShareSummary } from "@/lib/reading-share";

/**
 * Okuma listesini bağlantıyla paylaşmak (`reading-share.ts`): listenin o
 * anki kopyası `/r/<kimlik>` adresinde. Güncellemek yeni kopyayı alıyor;
 * yayından kaldırmak bağlantıyı hemen kapatıyor.
 */

const endpoint = "/api/reading-list/share";
const stateLabel = { live: "Live", unpublished: "Taken down", expired: "Expired" } as const;
const date = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

async function call(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = (await response.json().catch(() => undefined)) as { error?: string; share?: ReadingShareSummary; shares?: ReadingShareSummary[] } | undefined;
  if (!response.ok) throw new Error(data?.error ?? "The shared list could not be changed.");
  return data ?? {};
}

export function ReadingSharePanel({ saved }: { saved: number }) {
  const [shares, setShares] = useState<ReadingShareSummary[]>();
  const [title, setTitle] = useState("My reading list");
  const [includePapers, setIncludePapers] = useState(false);
  const [days, setDays] = useState<string>("never");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let cancelled = false;
    const start = setTimeout(() => setOrigin(window.location.origin), 0);
    call(endpoint)
      .then((data) => {
        if (!cancelled) setShares(data.shares ?? []);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage({ text: error instanceof Error ? error.message : "The shared lists could not be read.", error: true });
      });
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, []);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
      setShares((await call(endpoint)).shares ?? []);
      setMessage({ text: done });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "The shared list could not be changed.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const expiresInDays = days === "never" ? null : Number(days);

  return (
    <section className="reading-share" aria-label="Share the reading list">
      <h3><Link2 size={15} aria-hidden="true" /> Share the list</h3>
      <p>
        A link to the list as it is now, in the reading order and with the reason for each place. Only the list goes out: no notes
        and no reading progress. The link opens wherever this studio runs, on this computer only unless it is on a server others
        can reach.
      </p>
      {shares?.map((share) => {
        const url = `${origin}${share.path}`;
        return (
          <article key={share.id} className={`reading-share-item is-${share.state}`}>
            <div className="reading-share-head">
              <strong>{share.title}</strong>
              <span className="reading-share-state">{stateLabel[share.state]}</span>
            </div>
            <small>
              {share.count} {share.count === 1 ? "work" : "works"}{share.includePapers ? " and your papers" : ""} · updated {date.format(new Date(share.updatedAt))}
              {share.expiresAt ? ` · ${share.state === "expired" ? "expired" : "until"} ${date.format(new Date(share.expiresAt))}` : ""}
            </small>
            {share.state === "live" ? (
              <div className="reading-share-link">
                <input readOnly value={url} aria-label={`Link to ${share.title}`} onFocus={(event) => event.target.select()} />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url).then(() => setMessage({ text: "Link copied." }), () => setMessage({ text: "Select the link and copy it.", error: true }));
                  }}
                >
                  <Copy size={13} /> Copy
                </button>
              </div>
            ) : null}
            <div className="reading-share-actions">
              <button type="button" disabled={busy} onClick={() => run(() => call(`${endpoint}?id=${share.id}`, { method: "PATCH", body: JSON.stringify({ refresh: true, status: "live" }) }), "The link shows the list as it is now.")}>
                <RefreshCw size={13} /> Update to the current list
              </button>
              {share.state === "live" ? (
                <button type="button" disabled={busy} onClick={() => run(() => call(`${endpoint}?id=${share.id}`, { method: "PATCH", body: JSON.stringify({ status: "unpublished" }) }), "The link no longer opens.")}>Take down</button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => run(() => call(`${endpoint}?id=${share.id}`, { method: "DELETE" }), "The shared list was deleted.")}>Delete</button>
            </div>
          </article>
        );
      })}
      <form
        className="reading-share-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => call(endpoint, { method: "POST", body: JSON.stringify({ title, includePapers, expiresInDays }) }), "The link is ready.");
        }}
      >
        <label>
          <span>Title</span>
          <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>Link works for</span>
          <select value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="never">Until taken down</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </label>
        <label className="reading-share-check">
          <input type="checkbox" checked={includePapers} onChange={(event) => setIncludePapers(event.target.checked)} />
          <span>Include the papers in my library, in their place in the order</span>
        </label>
        <button type="submit" disabled={busy || !saved}>{shares?.length ? "Share another link" : "Share a link"}</button>
      </form>
      {message ? <p className={message.error ? "regen-error" : "reading-share-message"} role="status">{message.text}</p> : null}
    </section>
  );
}
