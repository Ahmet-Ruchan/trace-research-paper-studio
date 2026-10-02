"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Link2, RefreshCw } from "lucide-react";
import { useUiLanguage } from "@/i18n/client";
import { uiLocale } from "@/i18n/languages";
import type { ReadingShareSummary } from "@/lib/reading-share";

/**
 * Okuma listesini bağlantıyla paylaşmak (`reading-share.ts`): listenin o
 * anki kopyası `/r/<kimlik>` adresinde. Güncellemek yeni kopyayı alıyor;
 * yayından kaldırmak bağlantıyı hemen kapatıyor.
 */

const endpoint = "/api/reading-list/share";

/** `failed`: sunucu bir hata yazmadığında. */
async function call(failed: string, input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = (await response.json().catch(() => undefined)) as { error?: string; share?: ReadingShareSummary; shares?: ReadingShareSummary[] } | undefined;
  if (!response.ok) throw new Error(data?.error ?? failed);
  return data ?? {};
}

export function ReadingSharePanel({ saved }: { saved: number }) {
  const { language, t: messages } = useUiLanguage();
  const t = messages.learning.readingShare;
  const date = useMemo(() => new Intl.DateTimeFormat(uiLocale(language), { day: "numeric", month: "short", year: "numeric" }), [language]);
  // Hata metni ref'te: paylaşılanlar dil değişince yeniden okunmasın.
  const text = useRef(t);
  useEffect(() => {
    text.current = t;
  }, [t]);
  const [shares, setShares] = useState<ReadingShareSummary[]>();
  // Okuyucu başlığa dokunana kadar varsayılan başlık arayüzün dilinde.
  const [typedTitle, setTitle] = useState<string>();
  const title = typedTitle ?? t.defaultTitle;
  const [includePapers, setIncludePapers] = useState(false);
  const [days, setDays] = useState<string>("never");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let cancelled = false;
    const start = setTimeout(() => setOrigin(window.location.origin), 0);
    call(text.current.changeFailed, endpoint)
      .then((data) => {
        if (!cancelled) setShares(data.shares ?? []);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage({ text: error instanceof Error ? error.message : text.current.readFailed, error: true });
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
      setShares((await call(t.changeFailed, endpoint)).shares ?? []);
      setMessage({ text: done });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t.changeFailed, error: true });
    } finally {
      setBusy(false);
    }
  }

  const expiresInDays = days === "never" ? null : Number(days);

  return (
    <section className="reading-share" aria-label={t.title}>
      <h3><Link2 size={15} aria-hidden="true" /> {t.heading}</h3>
      <p>
        {t.intro}
      </p>
      {shares?.map((share) => {
        const url = `${origin}${share.path}`;
        return (
          <article key={share.id} className={`reading-share-item is-${share.state}`}>
            <div className="reading-share-head">
              <strong>{share.title}</strong>
              <span className="reading-share-state">{t.states[share.state]}</span>
            </div>
            <small>
              {t.meta(share.count, share.includePapers, date.format(new Date(share.updatedAt)))}
              {share.expiresAt ? t.expiry(share.state === "expired", date.format(new Date(share.expiresAt))) : ""}
            </small>
            {share.state === "live" ? (
              <div className="reading-share-link">
                <input readOnly value={url} aria-label={t.linkTo(share.title)} onFocus={(event) => event.target.select()} />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url).then(() => setMessage({ text: t.copiedLink }), () => setMessage({ text: t.copyYourself, error: true }));
                  }}
                >
                  <Copy size={13} /> {messages.common.copy}
                </button>
              </div>
            ) : null}
            <div className="reading-share-actions">
              <button type="button" disabled={busy} onClick={() => run(() => call(t.changeFailed, `${endpoint}?id=${share.id}`, { method: "PATCH", body: JSON.stringify({ refresh: true, status: "live" }) }), t.refreshed)}>
                <RefreshCw size={13} /> {t.refresh}
              </button>
              {share.state === "live" ? (
                <button type="button" disabled={busy} onClick={() => run(() => call(t.changeFailed, `${endpoint}?id=${share.id}`, { method: "PATCH", body: JSON.stringify({ status: "unpublished" }) }), t.takenDown)}>{t.takeDown}</button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => run(() => call(t.changeFailed, `${endpoint}?id=${share.id}`, { method: "DELETE" }), t.deleted)}>{messages.common.delete}</button>
            </div>
          </article>
        );
      })}
      <form
        className="reading-share-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => call(t.changeFailed, endpoint, { method: "POST", body: JSON.stringify({ title, includePapers, expiresInDays }) }), t.ready);
        }}
      >
        <label>
          <span>{t.titleField}</span>
          <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>{t.worksFor}</span>
          <select value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="never">{t.untilTakenDown}</option>
            <option value="7">{t.days(7)}</option>
            <option value="30">{t.days(30)}</option>
            <option value="90">{t.days(90)}</option>
          </select>
        </label>
        <label className="reading-share-check">
          <input type="checkbox" checked={includePapers} onChange={(event) => setIncludePapers(event.target.checked)} />
          <span>{t.includePapers}</span>
        </label>
        <button type="submit" disabled={busy || !saved}>{shares?.length ? t.shareAnother : t.share}</button>
      </form>
      {message ? <p className={message.error ? "regen-error" : "reading-share-message"} role="status">{message.text}</p> : null}
    </section>
  );
}
