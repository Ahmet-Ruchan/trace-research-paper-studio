"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { getProvider, localizedProvider } from "@/lib/model-providers";
import type { ResearchProject } from "@/lib/schema";
import type { StudyHandle } from "@/visuals/teaching/study";
import { ModelKeyFields, useRememberedAssignment } from "./model-key-fields";
import { useT } from "@/i18n/client";

type Result = { feedback: ExplanationFeedback; coverage: { covered: number; total: number }; model: string; change?: ExplanationChange };

/** Tarih arayüzün dilinde: "1 Eki 2026 14:05". */
function useWhen() {
  const { locale } = useT().common;
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    return (at: string) => format.format(new Date(at));
  }, [locale]);
}

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
  const messages = useT();
  const t = messages.paper.explain;
  const { claimStatus } = messages.paper;
  const when = useWhen();
  const provider = getProvider(assignment.provider)!;
  const length = text.trim().length;
  const history = study ? explanationHistory(study.progress, target) : [];
  const signature = explainedSectionSignature(project, target);

  async function check() {
    if (busy || length < MIN_EXPLANATION_LENGTH) return;
    if (!provider.local && !apiKey.trim()) return setError(messages.paper.modelRequest.keyRequired(localizedProvider(provider, messages.studio.models.providers).keyLabel));
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, target, text: text.trim(), assignment, apiKey: apiKey.trim() }),
      });
      const data = (await response.json().catch(() => undefined)) as (Result & { error?: string }) | undefined;
      if (!response.ok || !data?.feedback) throw new Error(data?.error ?? t.failed);
      const now = new Date().toISOString();
      const record = explanationRecord(project, target, text, data.feedback, data.coverage, data.model, now);
      const previous = history[0];
      setResult({ feedback: data.feedback, coverage: data.coverage, model: data.model, change: previous ? compareExplanations(previous, record) : undefined });
      study?.update((current) => recordExplanation(current, record, now));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.failed);
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
        <small lang={messages.common.locale}>{found.sourceRefs[0]?.page ? messages.common.page(found.sourceRefs[0].page) : "web"} · {found.confidence === "verified" ? claimStatus.verifiedInline : claimStatus.needsReviewInline}</small>
      </>
    );
    return onClaimSelect ? (
      <button type="button" onClick={() => onClaimSelect(id)} lang={project.language} title={claimStatus.openEvidence}>{label}</button>
    ) : (
      <span lang={project.language}>{label}</span>
    );
  };

  return (
    <details className="explain">
      <summary><MessageSquareText size={15} aria-hidden="true" /> {t.summary}</summary>
      <p className="explain-intro">
        {t.intro}{" "}
        {study ? t.kept : t.nothingSaved}
      </p>
      <div className="explain-field">
        <textarea
          aria-label={t.aria}
          value={text}
          maxLength={MAX_EXPLANATION_LENGTH}
          rows={5}
          placeholder={t.placeholder}
          onChange={(event) => setText(event.target.value)}
        />
        <small className="regen-count">{length < MIN_EXPLANATION_LENGTH ? t.moreCharacters(MIN_EXPLANATION_LENGTH - length) : `${text.length}/${MAX_EXPLANATION_LENGTH}`}</small>
      </div>
      <ModelKeyFields assignment={assignment} onAssignment={choose} apiKey={apiKey} onApiKey={setApiKey} />
      <button type="button" className="regen-primary" disabled={busy || length < MIN_EXPLANATION_LENGTH} onClick={() => { void check(); }}>
        {busy ? t.reading : t.check}
      </button>
      {error ? <p className="regen-error" role="alert">{error}</p> : null}

      {result ? (
        <section className="explain-result" aria-live="polite" aria-label={t.resultAria}>
          <p className="explain-coverage">
            {t.coverageBefore}<strong>{t.coverage(result.coverage.covered, result.coverage.total)}</strong>{t.coverageAfter}
          </p>
          <p className="explain-summary" lang={project.language}>{result.feedback.summary}</p>

          {result.change ? <ChangeSince change={result.change} claimButton={claimButton} /> : null}

          {result.feedback.covered.length ? (
            <div className="explain-group is-covered">
              <h5>{t.conveyed}</h5>
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
              <h5>{t.leftOut}</h5>
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
              <h5>{t.misstated}</h5>
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
              <h5>{t.unsupported}</h5>
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

          <small className="ask-model">{t.checkedBy(result.model)}</small>
        </section>
      ) : null}

      {history.length ? (
        <details className="explain-history">
          <summary>{t.earlier(history.length)}</summary>
          <ol>
            {history.map((item) => (
              <li key={item.at}>
                <p className="explain-history-meta">
                  <strong>{when(item.at)}</strong>{t.historyConveyed(item.covered.length, item.total)}
                  {item.misstated ? t.historyMisstated(item.misstated) : ""}
                  {item.sig !== signature ? t.historyEarlierVersion : ""}
                </p>
                <blockquote className="explain-history-text">{item.text}</blockquote>
              </li>
            ))}
          </ol>
          {confirmForget ? (
            <p className="explain-forget" role="group" aria-label={t.forgetAria}>
              {t.forgetQuestion(history.length)}{" "}
              <button type="button" onClick={() => { study?.update((current) => forgetExplanations(current, target, new Date().toISOString())); setConfirmForget(false); }}>{t.forget}</button>
              <button type="button" onClick={() => setConfirmForget(false)}>{t.keep}</button>
            </p>
          ) : (
            <button type="button" className="explain-forget-open" onClick={() => setConfirmForget(true)}>{t.forgetThese}</button>
          )}
        </details>
      ) : null}
    </details>
  );
}

/** Önceki anlatıştan bu yana: ne eklendi, ne düştü, ne hâlâ eksik. Kod karşılaştırıyor, model değil. */
function ChangeSince({ change, claimButton }: { change: ExplanationChange; claimButton: (id: string) => ReactNode }) {
  const t = useT().paper.explain;
  const when = useWhen();
  const list = (ids: string[]) => (
    <ul className="ask-claims">
      {ids.map((id) => <li key={id}>{claimButton(id)}</li>)}
    </ul>
  );
  return (
    <section className="explain-change" aria-label={t.sinceAria}>
      <h5>{t.since(when(change.previous.at))}</h5>
      <p className="explain-change-coverage">
        {t.changeBefore(change.before.covered, change.before.total)}<strong>{t.changeAfter(change.after.covered, change.after.total)}</strong>{t.changeTail}
        {change.sameSection ? "" : t.rewritten}
      </p>
      {change.gained.length ? <div className="explain-group is-covered"><h5>{t.gained}</h5>{list(change.gained)}</div> : null}
      {change.lost.length ? <div className="explain-group is-missed"><h5>{t.lost}</h5>{list(change.lost)}</div> : null}
      {change.stillMissed.length ? <div className="explain-group is-missed"><h5>{t.stillMissed}</h5>{list(change.stillMissed)}</div> : null}
      {!change.gained.length && !change.lost.length ? <p className="explain-note">{t.same}</p> : null}
    </section>
  );
}
