"use client";

import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { reviewSummary, setClaimReview, type ReviewItem, type ReviewReason } from "@/lib/claim-review";
import type { RevisionReason } from "@/lib/project-revisions";
import type { ResearchProject } from "@/lib/schema";

const REVIEWER_KEY = "trace-reviewer-name";

const reasonLabels: Record<ReviewReason, string> = {
  "quote-not-found": "Quote not found on its page",
  "needs-review": "The model was not sure",
  "in-use": "Used in the narrative",
  unused: "Collected, not used",
};

const dateFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

/**
 * İnceleme kuyruğu: bir insanın iddialara tek tek bakıp karar verdiği yer.
 *
 * Onay `confidence` değerini DEĞİŞTİRMEZ. O alan modelin beyanı; bir kişinin
 * kararı ayrı kaydedilir ki "model emindi" ile "bir insan sayfaya baktı"
 * hiçbir zaman aynı rozetin arkasında kaybolmasın. Reddedilen iddia da
 * silinmez: hangi bölümlerin ona dayandığı gösterilir, yeniden yazmak
 * kullanıcıya kalır.
 */
export function ReviewPanel({
  project,
  onProjectChange,
  onClaimSelect,
  onRewrite,
}: {
  project: ResearchProject;
  onProjectChange: (project: ResearchProject, reason?: RevisionReason) => void;
  onClaimSelect: (claimId: string) => void;
  onRewrite?: (section: { area: "story" | "report"; id: string }) => void;
}) {
  const summary = reviewSummary(project);
  const [reviewer, setReviewer] = useState(() => {
    try {
      return window.localStorage.getItem(REVIEWER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showDecided, setShowDecided] = useState(false);
  const name = reviewer.trim();

  function decide(item: ReviewItem, status?: "approved" | "rejected") {
    const note = notes[item.claim.id]?.trim();
    onProjectChange(
      setClaimReview(
        project,
        item.claim.id,
        status ? { status, by: name, at: new Date().toISOString(), ...(note ? { note } : {}) } : undefined,
      ),
      "edit",
    );
  }

  const pending = summary.items.filter((item) => !item.review);
  const decided = summary.items.filter((item) => item.review);

  return (
    <div className="review">
      <div className="health-stats">
        <article className="health-stat"><strong>{summary.pending}</strong><span>waiting for a person</span><small>Ordered by where a mistake is most likely.</small></article>
        <article className="health-stat"><strong>{summary.approved}</strong><span>approved</span><small>Someone looked at the page and agreed.</small></article>
        <article className="health-stat"><strong>{summary.rejected}</strong><span>rejected</span><small>Kept in the ledger, marked as not supported.</small></article>
      </div>

      <label className="review-name">
        Reviewing as
        <input
          value={reviewer}
          maxLength={80}
          placeholder="Your name"
          onChange={(event) => {
            setReviewer(event.target.value);
            try {
              window.localStorage.setItem(REVIEWER_KEY, event.target.value);
            } catch {
              // Depolama kapalıysa ad yalnızca bu oturumda kalır.
            }
          }}
        />
        <small>Saved with every decision. Approving does not change what the model said about its own claim.</small>
      </label>

      {summary.sectionsOnRejected.length ? (
        <section className="health-block">
          <h4>Sections that still rest on a rejected claim</h4>
          <ul className="health-thin">
            {summary.sectionsOnRejected.map((section) => (
              <li key={`${section.area}-${section.id}`}>
                <span className="health-area">{section.area === "story" ? "Story" : "Report"}</span>
                <span className="health-thin-title" lang={project.language}>{section.title}</span>
                <span className="health-thin-count">{section.claimIds.length} rejected</span>
                {onRewrite ? <button type="button" className="health-strengthen" onClick={() => onRewrite(section)}>Rewrite</button> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ol className="review-list">
        {pending.map((item) => (
          <li key={item.claim.id}>
            <ReviewCard item={item} language={project.language} onClaimSelect={onClaimSelect}>
              <input
                className="review-note"
                value={notes[item.claim.id] ?? ""}
                maxLength={600}
                placeholder="Note (optional): what you saw on the page"
                onChange={(event) => setNotes((current) => ({ ...current, [item.claim.id]: event.target.value }))}
              />
              <div className="review-actions">
                <button disabled={!name} title={name ? undefined : "Enter your name first"} className="review-approve" onClick={() => decide(item, "approved")}><Check size={13} /> Approve</button>
                <button disabled={!name} title={name ? undefined : "Enter your name first"} className="review-reject" onClick={() => decide(item, "rejected")}><X size={13} /> Reject</button>
              </div>
            </ReviewCard>
          </li>
        ))}
        {!pending.length && <li className="history-empty">Every claim has been looked at by a person.</li>}
      </ol>

      {decided.length ? (
        <section className="health-block">
          <button className="text-button" onClick={() => setShowDecided((value) => !value)}>
            {showDecided ? "Hide" : "Show"} the {decided.length} decided claim{decided.length === 1 ? "" : "s"}
          </button>
          {showDecided && (
            <ol className="review-list">
              {decided.map((item) => (
                <li key={item.claim.id}>
                  <ReviewCard item={item} language={project.language} onClaimSelect={onClaimSelect}>
                    <div className="review-actions">
                      <button onClick={() => decide(item)}><RotateCcw size={13} /> Undo</button>
                    </div>
                  </ReviewCard>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ReviewCard({
  item,
  language,
  onClaimSelect,
  children,
}: {
  item: ReviewItem;
  language: string;
  onClaimSelect: (claimId: string) => void;
  children: React.ReactNode;
}) {
  const reference = item.claim.sourceRefs[0];
  return (
    <article className={`review-card ${item.review ? `is-${item.review.status}` : ""}`}>
      <header>
        <span className={`review-reason reason-${item.reason}`}>{reasonLabels[item.reason]}</span>
        {item.review && (
          <span className={`review-decision is-${item.review.status}`}>
            {item.review.status === "approved" ? "Approved" : "Rejected"} by {item.review.by} · {dateFormat.format(new Date(item.review.at))}
          </span>
        )}
      </header>
      <button className="review-statement" onClick={() => onClaimSelect(item.claim.id)} lang={language} title="Open the evidence for this claim">
        {item.claim.statement}
      </button>
      {reference && (
        <blockquote>
          “{reference.excerpt}” <small>{reference.page ? `p. ${reference.page}` : reference.sourceId}</small>
        </blockquote>
      )}
      {item.review?.note && <p className="review-saved-note">{item.review.note}</p>}
      {item.usedIn.length ? <p className="review-used">Used in: {item.usedIn.map((section) => section.title).join(" · ")}</p> : null}
      {children}
    </article>
  );
}
