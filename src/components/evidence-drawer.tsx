"use client";

import { Check, ExternalLink, FileText, X } from "lucide-react";
import type { Claim, PaperEvidence } from "@/lib/schema";
import { useStrings } from "@/visuals";

type EvidenceDrawerProps = {
  claim?: Claim;
  evidence: PaperEvidence;
  fileUrl?: string;
  onClose?: () => void;
  persistent?: boolean;
};

const kindLabels: Record<Claim["kind"], string> = {
  "reported-result": "Raporlanan sonuç",
  "author-interpretation": "Yazar yorumu",
  method: "Yöntem",
  background: "Arka plan",
  limitation: "Sınırlılık",
};

export function EvidenceDrawer({ claim, evidence, fileUrl, onClose, persistent = false }: EvidenceDrawerProps) {
  const t = useStrings();
  return (
    <aside className={`evidence-drawer ${persistent ? "is-persistent" : ""}`} aria-label="Kanıt ayrıntısı">
      <div className="drawer-header">
        <div>
          <span>Evidence</span>
          <strong>{claim ? kindLabels[claim.kind] : t.pickAClaim}</strong>
        </div>
        {onClose && (
          <button className="icon-button" onClick={onClose} aria-label="Kanıt panelini kapat">
            <X size={17} />
          </button>
        )}
      </div>

      {!claim ? (
        <div className="drawer-empty">
          <FileText size={22} />
          <p>{t.pickAClaimHint}</p>
        </div>
      ) : (
        <div className="drawer-content">
          <div className="claim-status">
            <span className={claim.confidence === "verified" ? "verified" : "review"}>
              <Check size={13} /> {claim.confidence === "verified" ? "Doğrulandı" : "İnceleme gerekli"}
            </span>
            <small>{kindLabels[claim.kind]}</small>
          </div>

          <h3>{claim.statement}</h3>

          <div className="reference-list">
            {claim.sourceRefs.map((reference, index) => {
              const source = evidence.sources.find((item) => item.id === reference.sourceId);
              const href =
                source?.type === "paper" && fileUrl
                  ? `${fileUrl}#page=${reference.page ?? 1}`
                  : source?.url;
              return (
                <article className="reference-card" key={`${reference.sourceId}-${index}`}>
                  <div className="reference-meta">
                    <span>{source?.type === "paper" ? "PDF" : "WEB"}</span>
                    <span>{reference.page ? `Sayfa ${reference.page}` : reference.locator ?? "Kaynak"}</span>
                  </div>
                  <blockquote>“{reference.excerpt}”</blockquote>
                  <div className="reference-source">
                    <span>{source?.title ?? reference.sourceId}</span>
                    {href && (
                      <a href={href} target="_blank" rel="noreferrer" aria-label="Kaynağı aç">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}

