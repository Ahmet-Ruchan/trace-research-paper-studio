"use client";

import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { MAX_EXPLANATION_LENGTH, MIN_EXPLANATION_LENGTH, type ExplainTarget, type ExplanationFeedback } from "@/lib/explain-back";
import { getProvider } from "@/lib/model-providers";
import type { ResearchProject } from "@/lib/schema";
import { ModelKeyFields, useRememberedAssignment } from "./model-key-fields";

type Result = { feedback: ExplanationFeedback; coverage: { covered: number; total: number }; model: string };

/**
 * "Kendi cümlelerinle anlat" (bkz. `explain-back.ts`). Okuyucu bölümü
 * kendi cümleleriyle yazıyor; yalnızca kanıtı gören bir model hangi iddiaları
 * aktardığını, neyi atladığını ve neyi kanıttan farklı söylediğini gösteriyor.
 * Bu bir not değil, bir modelin okuması: panel bunu açıkça söylüyor. Metin ve
 * geri bildirim saklanmıyor.
 */
export function ExplainPanel({
  project,
  target,
  onClaimSelect,
}: {
  project: ResearchProject;
  target: ExplainTarget;
  onClaimSelect?: (claimId: string) => void;
}) {
  const [assignment, choose] = useRememberedAssignment();
  const [apiKey, setApiKey] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Result>();
  const provider = getProvider(assignment.provider)!;
  const length = text.trim().length;

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
      setResult({ feedback: data.feedback, coverage: data.coverage, model: data.model });
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
        something the evidence does not. It is a model&apos;s reading, not a grade, and nothing is saved.
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
    </details>
  );
}
