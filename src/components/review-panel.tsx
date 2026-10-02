"use client";

import { useMemo, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { reviewSummary, setClaimReview, type ReviewItem } from "@/lib/claim-review";
import { castVote } from "@/lib/team";
import { useTeamMember } from "./team";
import type { RevisionReason } from "@/lib/project-revisions";
import type { ResearchProject } from "@/lib/schema";
import { useT } from "@/i18n/client";

const REVIEWER_KEY = "trace-reviewer-name";

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
  const messages = useT();
  const t = messages.paper.review;
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
  // Ekip kipinde ad oturumdan geliyor; karar üyelerin oylarından (`team.ts`).
  const team = useTeamMember();
  const name = team ? team.me.name : reviewer.trim();
  const votesOf = (item: ReviewItem) => project.claimReviewVotes?.[item.claim.id] ?? [];
  const myVote = (item: ReviewItem) => (team ? votesOf(item).find((vote) => vote.memberId === team.me.id) : undefined);

  function decide(item: ReviewItem, status?: "approved" | "rejected") {
    const note = notes[item.claim.id]?.trim();
    if (team) {
      onProjectChange(castVote(project, item.claim.id, team.me, status ? { status, at: new Date().toISOString(), ...(note ? { note } : {}) } : undefined, team.approvalsNeeded), "edit");
      return;
    }
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
        <article className="health-stat"><strong>{summary.pending}</strong><span>{t.waiting}</span><small>{t.waitingNote}</small></article>
        <article className="health-stat"><strong>{summary.approved}</strong><span>{t.approved}</span><small>{t.approvedNote}</small></article>
        <article className="health-stat"><strong>{summary.rejected}</strong><span>{t.rejected}</span><small>{t.rejectedNote}</small></article>
      </div>

      {team ? (
        <p className="review-name">
          {t.reviewingAsBefore}<strong>{team.me.name}</strong>{t.reviewingAsAfter}{" "}
          <small>{t.teamRule(team.approvalsNeeded)}</small>
        </p>
      ) : (
      <label className="review-name">
        {t.reviewingAs}
        <input
          value={reviewer}
          maxLength={80}
          placeholder={t.namePlaceholder}
          onChange={(event) => {
            setReviewer(event.target.value);
            try {
              window.localStorage.setItem(REVIEWER_KEY, event.target.value);
            } catch {
              // Depolama kapalıysa ad yalnızca bu oturumda kalır.
            }
          }}
        />
        <small>{t.nameNote}</small>
      </label>
      )}

      {summary.sectionsOnRejected.length ? (
        <section className="health-block">
          <h4>{t.onRejected}</h4>
          <ul className="health-thin">
            {summary.sectionsOnRejected.map((section) => (
              <li key={`${section.area}-${section.id}`}>
                <span className="health-area">{section.area === "story" ? t.story : t.report}</span>
                <span className="health-thin-title" lang={project.language}>{section.title}</span>
                <span className="health-thin-count">{t.rejectedCount(section.claimIds.length)}</span>
                {onRewrite ? <button type="button" className="health-strengthen" onClick={() => onRewrite(section)}>{t.rewrite}</button> : null}
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
                placeholder={t.notePlaceholder}
                onChange={(event) => setNotes((current) => ({ ...current, [item.claim.id]: event.target.value }))}
              />
              {team ? <VoteLine votes={votesOf(item)} needed={team.approvalsNeeded} /> : null}
              <div className="review-actions">
                {myVote(item) ? (
                  <button onClick={() => decide(item)}><RotateCcw size={13} /> {t.withdraw(myVote(item)!.status === "approved")}</button>
                ) : (
                  <>
                    <button disabled={!name} title={name ? undefined : t.nameFirst} className="review-approve" onClick={() => decide(item, "approved")}><Check size={13} /> {t.approve}</button>
                    <button disabled={!name} title={name ? undefined : t.nameFirst} className="review-reject" onClick={() => decide(item, "rejected")}><X size={13} /> {t.reject}</button>
                  </>
                )}
              </div>
            </ReviewCard>
          </li>
        ))}
        {!pending.length && <li className="history-empty">{t.allDone}</li>}
      </ol>

      {decided.length ? (
        <section className="health-block">
          <button className="text-button" onClick={() => setShowDecided((value) => !value)}>
            {t.toggleDecided(showDecided, decided.length)}
          </button>
          {showDecided && (
            <ol className="review-list">
              {decided.map((item) => (
                <li key={item.claim.id}>
                  <ReviewCard item={item} language={project.language} onClaimSelect={onClaimSelect}>
                    {team ? <VoteLine votes={votesOf(item)} needed={team.approvalsNeeded} /> : null}
                    <div className="review-actions">
                      {!team ? <button onClick={() => decide(item)}><RotateCcw size={13} /> {messages.common.undo}</button> : myVote(item) ? <button onClick={() => decide(item)}><RotateCcw size={13} /> {t.withdrawVote}</button> : null}
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

/** Ekip kipinde bir iddianın oyları: kim ne dedi, kaç onay daha gerekiyor. */
function VoteLine({ votes, needed }: { votes: ReadonlyArray<{ by: string; status: "approved" | "rejected" }>; needed: number }) {
  const t = useT().paper.review;
  const approvals = votes.filter((vote) => vote.status === "approved").length;
  const rejected = votes.some((vote) => vote.status === "rejected");
  return (
    <p className="review-votes">
      {votes.length ? votes.map((vote) => t.vote(vote.by, vote.status === "approved")).join(" · ") : t.noVotes}
      {!rejected ? t.approvals(Math.min(approvals, needed), needed) : ""}
    </p>
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
  const messages = useT();
  const t = messages.paper.review;
  const { claimStatus } = messages.paper;
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(messages.common.locale, { day: "numeric", month: "short", year: "numeric" }), [messages.common.locale]);
  const reference = item.claim.sourceRefs[0];
  return (
    <article className={`review-card ${item.review ? `is-${item.review.status}` : ""}`}>
      <header>
        <span className={`review-reason reason-${item.reason}`}>{t.reasons[item.reason]}</span>
        {item.review && (
          <span className={`review-decision is-${item.review.status}`}>
            {claimStatus.reviewedBy(item.review.status === "approved", item.review.by)} · {dateFormat.format(new Date(item.review.at))}
          </span>
        )}
      </header>
      <button className="review-statement" onClick={() => onClaimSelect(item.claim.id)} lang={language} title={claimStatus.openEvidence}>
        {item.claim.statement}
      </button>
      {reference && (
        <blockquote>
          “{reference.excerpt}” <small>{reference.page ? messages.common.page(reference.page) : reference.sourceId}</small>
        </blockquote>
      )}
      {item.review?.note && <p className="review-saved-note">{item.review.note}</p>}
      {item.usedIn.length ? <p className="review-used">{t.usedIn(item.usedIn.map((section) => section.title).join(" · "))}</p> : null}
      {children}
    </article>
  );
}
