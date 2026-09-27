"use client";

import { useState, type ReactNode } from "react";
import { MessageSquareText } from "lucide-react";
import { MAX_EXPLANATION_LENGTH, MIN_EXPLANATION_LENGTH, type ExplainTarget, type ExplanationFeedback } from "@/lib/explain-back";
import {
  compareExplanations,
  explainedSectionSignature,
  explanationHistory,
  explanationRecord,
  forgetExplanations,
  recordExplanation,
  type ExplanationChange,
} from "@/lib/explanation-history";
import { getProvider } from "@/lib/model-providers";
import type { ResearchProject } from "@/lib/schema";
import type { StudyHandle } from "@/visuals/teaching/study";
import { ModelKeyFields, useRememberedAssignment } from "./model-key-fields";

type Result = { feedback: ExplanationFeedback; coverage: { covered: number; total: number }; model: string; change?: ExplanationChange };

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const when = (at: string) => dateFormat.format(new Date(at));

/**
 * "Kendi cümlelerinle anlat" (bkz. `explain-back.ts`). Okuyucu bölümü
 * kendi cümleleriyle yazıyor; yalnızca kanıtı gören bir model hangi iddiaları
 * aktardığını, neyi atladığını ve neyi kanıttan farklı söylediğini gösteriyor.
 * Bu bir not değil, bir modelin okuması: panel bunu açıkça söylüyor.
 *
 * Çalışma ilerlemesi verildiyse (`study`) her denetlenen anlatış oraya
 * kaydediliyor (`explanation-history.ts`) ve bir öncekiyle karşılaştırılıyor:
 * okuyucu bir hafta sonra aynı bölümü anlattığında neyi eklediğini görüyor.
 */
export function ExplainPanel({
  project,
  target,
  study,
  onClaimSelect,
}: {
  project: ResearchProject;
  target: ExplainTarget;
  study?: StudyHandle;
  onClaimSelect?: (claimId: string) => void;
}) {
  const [assignment, choose] = useRememberedAssignment();
  const [apiKey, setApiKey] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Result>();
  const [confirmForget, setConfirmForget] = useState(false);
  const provider = getProvider(assignment.provider)!;
  const length = text.trim().length;
  const history = study ? explanationHistory(study.progress, target) : [];
  const signature = explainedSectionSignature(project, target);

  async function check() {
    if (busy || length < MIN_EXPLANATION_LENGTH) return;
    if (!provider.local && !apiKey.trim()) return setError(`${provider.keyLabel} is required.`);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, target, text: text.trim(), assignment, apiKey: apiKey.trim() }),
      });
      const data = (await response.json().catch(() => undefined)) as (Result & { error?: string }) | undefined;
      if (!response.ok || !data?.feedback) throw new Error(data?.error ?? "Your explanation could not be checked.");
      const now = new Date().toISOString();
      const record = explanationRecord(project, target, text, data.feedback, data.coverage, data.model, now);
      const previous = history[0];
      setResult({ feedback: data.feedback, coverage: data.coverage, model: data.model, change: previous ? compareExplanations(previous, record) : undefined });
      study?.update((current) => recordExplanation(current, record, now));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your explanation could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  const claim = (id: string) => project.evidence.claims.find((item) => item.id === id);
  const claimButton = (id: string) => {
    const found = claim(id);
    if (!found) return null;
    const label = (
      <>
        {found.statement}
        <small>{found.sourceRefs[0]?.page ? `p. ${found.sourceRefs[0].page}` : "web"} · {found.confidence === "verified" ? "verified" : "needs review"}</small>
      </>
    );
    return onClaimSelect ? (
      <button type="button" onClick={() => onClaimSelect(id)} lang={project.language} title="Open the evidence for this claim">{label}</button>
    ) : (
      <span lang={project.language}>{label}</span>
    );
  };

  return (
    <details className="explain">
      <summary><MessageSquareText size={15} aria-hidden="true" /> Explain it in your own words</summary>
      <p className="explain-intro">
        Write what this section says, as you would to a friend, without looking back. A model that sees only the collected
        evidence (not the paper) says which of the section&apos;s claims you conveyed, what you left out and where you said
        something the evidence does not. It is a model&apos;s reading, not a grade.{" "}
        {study
          ? "Each explanation you check is kept with your study progress (never in the project), so next time you see what you added."
          : "Nothing is saved."}
      </p>
      <div className="explain-field">
        <textarea
          aria-label="Your explanation"
          value={text}
          maxLength={MAX_EXPLANATION_LENGTH}
          rows={5}
          placeholder="In my own words: …"
          onChange={(event) => setText(event.target.value)}
        />
        <small className="regen-count">{length < MIN_EXPLANATION_LENGTH ? `${MIN_EXPLANATION_LENGTH - length} more characters` : `${text.length}/${MAX_EXPLANATION_LENGTH}`}</small>
      </div>
      <ModelKeyFields assignment={assignment} onAssignment={choose} apiKey={apiKey} onApiKey={setApiKey} />
      <button type="button" className="regen-primary" disabled={busy || length < MIN_EXPLANATION_LENGTH} onClick={() => { void check(); }}>
        {busy ? "Reading your explanation…" : "Check my explanation"}
      </button>
      {error ? <p className="regen-error" role="alert">{error}</p> : null}

      {result ? (
        <section className="explain-result" aria-live="polite" aria-label="How your explanation compares with the evidence">
          <p className="explain-coverage">
            <strong>{result.coverage.covered} of {result.coverage.total}</strong> claims this section rests on are in your explanation.
          </p>
          <p className="explain-summary" lang={project.language}>{result.feedback.summary}</p>

          {result.change ? <ChangeSince change={result.change} claimButton={claimButton} /> : null}

          {result.feedback.covered.length ? (
            <div className="explain-group is-covered">
              <h5>What you conveyed</h5>
              <ul className="ask-claims">
                {result.feedback.covered.map((item) => (
                  <li key={item.claimId}>
                    {claimButton(item.claimId)}
                    <p className="explain-note" lang={project.language}>{item.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.feedback.missed.length ? (
            <div className="explain-group is-missed">
              <h5>What you left out</h5>
              <ul className="ask-claims">
                {result.feedback.missed.map((item) => (
                  <li key={item.claimId}>
                    {claimButton(item.claimId)}
                    <p className="explain-note" lang={project.language}>{item.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.feedback.misstated.length ? (
            <div className="explain-group is-misstated">
              <h5>Where the evidence says otherwise</h5>
              <ul className="ask-claims">
                {result.feedback.misstated.map((item, index) => (
                  <li key={`${item.claimId}-${index}`}>
                    <blockquote className="explain-quote">“{item.quote}”</blockquote>
                    <p className="explain-note" lang={project.language}>{item.correction}</p>
                    {claimButton(item.claimId)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.feedback.unsupported.length ? (
            <div className="explain-group is-unsupported">
              <h5>Not in the collected evidence</h5>
              <ul className="ask-claims">
                {result.feedback.unsupported.map((item, index) => (
                  <li key={index}>
                    <blockquote className="explain-quote">“{item.quote}”</blockquote>
                    <p className="explain-note" lang={project.language}>{item.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <small className="ask-model">Checked by {result.model} against the evidence only; it has not read the paper.</small>
        </section>
      ) : null}

      {history.length ? (
        <details className="explain-history">
          <summary>Your earlier explanations ({history.length})</summary>
          <ol>
            {history.map((item) => (
              <li key={item.at}>
                <p className="explain-history-meta">
                  <strong>{when(item.at)}</strong> · conveyed {item.covered.length} of {item.total} claims
                  {item.misstated ? ` · ${item.misstated} said otherwise` : ""}
                  {item.sig !== signature ? " · for an earlier version of this section" : ""}
                </p>
                <blockquote className="explain-history-text">{item.text}</blockquote>
              </li>
            ))}
          </ol>
          {confirmForget ? (
            <p className="explain-forget" role="group" aria-label="Forget these explanations">
              Forget {history.length === 1 ? "this explanation" : `these ${history.length} explanations`}?{" "}
              <button type="button" onClick={() => { study?.update((current) => forgetExplanations(current, target, new Date().toISOString())); setConfirmForget(false); }}>Forget</button>
              <button type="button" onClick={() => setConfirmForget(false)}>Keep</button>
            </p>
          ) : (
            <button type="button" className="explain-forget-open" onClick={() => setConfirmForget(true)}>Forget these</button>
          )}
        </details>
      ) : null}
    </details>
  );
}

/** Önceki anlatıştan bu yana: ne eklendi, ne düştü, ne hâlâ eksik. Kod karşılaştırıyor, model değil. */
function ChangeSince({ change, claimButton }: { change: ExplanationChange; claimButton: (id: string) => ReactNode }) {
  const list = (ids: string[]) => (
    <ul className="ask-claims">
      {ids.map((id) => <li key={id}>{claimButton(id)}</li>)}
    </ul>
  );
  return (
    <section className="explain-change" aria-label="Since your last explanation">
      <h5>Since your explanation on {when(change.previous.at)}</h5>
      <p className="explain-change-coverage">
        {change.before.covered} of {change.before.total} → <strong>{change.after.covered} of {change.after.total}</strong> claims conveyed.
        {change.sameSection ? "" : " The section was rewritten since then, so the claims it rests on may differ."}
      </p>
      {change.gained.length ? <div className="explain-group is-covered"><h5>Conveyed this time, not last time</h5>{list(change.gained)}</div> : null}
      {change.lost.length ? <div className="explain-group is-missed"><h5>Conveyed last time, not this time</h5>{list(change.lost)}</div> : null}
      {change.stillMissed.length ? <div className="explain-group is-missed"><h5>Left out both times</h5>{list(change.stillMissed)}</div> : null}
      {!change.gained.length && !change.lost.length ? <p className="explain-note">The same claims as last time.</p> : null}
    </section>
  );
}
