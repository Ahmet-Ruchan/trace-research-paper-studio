"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ScanSearch, X } from "lucide-react";
import type { HighlightRect } from "@/lib/excerpt-boxes";

type Located = { page: number; found: boolean; image: string; rects: HighlightRect[] };

/**
 * Alıntı, sayfasının görüntüsü üzerinde.
 *
 * "Sayfa 8" demek okuyucuya bir sayfa dolusu metin aratıyor. Burada cümlenin
 * kendisi işaretleniyor. Bulunamadıysa sayfa yine gösteriliyor ve bu açıkça
 * söyleniyor: alıntının orada olmadığını görmek de bir doğrulamadır.
 */
export function ExcerptOnPage({ fileUrl, page, excerpt, onClose }: { fileUrl: string; page: number; excerpt: string; onClose: () => void }) {
  const [located, setLocated] = useState<Located>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const form = new FormData();
        form.set("paper", new File([await (await fetch(fileUrl)).blob()], "paper.pdf", { type: "application/pdf" }));
        form.set("page", String(page));
        form.set("excerpt", excerpt);
        const response = await fetch("/api/locate-excerpt", { method: "POST", body: form, signal: controller.signal });
        const data = (await response.json().catch(() => undefined)) as (Located & { error?: string }) | undefined;
        if (!response.ok || !data?.image) throw new Error(data?.error ?? "The quote could not be located.");
        setLocated(data);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The quote could not be located.");
      }
    })();
    return () => controller.abort();
  }, [fileUrl, page, excerpt]);

  // Çekmece kendi yığın bağlamını kuruyor; pencere orada kalırsa sayfa başlığının altında kalıyor.
  return createPortal(
    <div className="regen-overlay" role="dialog" aria-modal="true" aria-labelledby="excerpt-page-title" onClick={onClose}>
      <div className="regen-panel wide excerpt-page-panel" onClick={(event) => event.stopPropagation()}>
        <header className="regen-header">
          <div>
            <span><ScanSearch size={13} /> Quote on the page</span>
            <h2 id="excerpt-page-title">Page {located?.page ?? page}</h2>
            <p>“{excerpt}”</p>
          </div>
          <button className="regen-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="regen-body">
          {error && <p className="regen-error" role="alert">{error}</p>}
          {!located && !error && <p className="history-empty">Finding the quote on page {page}…</p>}
          {located && !located.found && (
            <p className="regen-error" role="status">
              These words were not found on page {page} or the pages next to it. The quote may be paraphrased, or it may sit in a table, an equation or a figure that text extraction cannot read. The page is shown so you can look.
            </p>
          )}
          {located && located.found && located.page !== page && (
            <p className="health-note">The project cites page {page}; the quote was found on page {located.page}.</p>
          )}
          {located && (
            <div className="excerpt-page">
              {/* eslint-disable-next-line @next/next/no-img-element -- sunucunun ürettiği veri adresi; optimize edilecek bir kaynak yok */}
              <img src={located.image} alt={`Page ${located.page} of the paper`} />
              {located.rects.map((rect, index) => (
                <mark
                  key={index}
                  style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
