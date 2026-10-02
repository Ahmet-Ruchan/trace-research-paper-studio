"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { MAX_QUESTION_LENGTH } from "@/lib/evidence-qa";
import { getProvider, localizedProvider } from "@/lib/model-providers";
import type { ResearchProject } from "@/lib/schema";
import { ModelKeyFields, useRememberedAssignment } from "./model-key-fields";
import { useT } from "@/i18n/client";

type Exchange = { question: string; answerable: boolean; answer: string; claimIds: string[]; model: string };

/**
 * Makaleye soru sormak — ama cevap yalnızca toplanmış kanıttan gelir.
 *
 * Genel bir sohbet kutusu her soruya akıcı bir cevap verir; burada model
 * makaleyi görmüyor, kanıt defterini görüyor ve dayandığı iddiaları göstermek
 * zorunda. Defterde olmayan şey için doğru cevap "toplanan kanıt bunu
 * söylemiyor". Sorular ve cevaplar saklanmaz; sayfa yenilenince giderler.
 */
export function AskPanel({ project, onClaimSelect }: { project: ResearchProject; onClaimSelect: (claimId: string) => void }) {
  const [assignment, choose] = useRememberedAssignment();
  const [apiKey, setApiKey] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const provider = getProvider(assignment.provider)!;
  const messages = useT();
  const t = messages.paper.ask;
  const { claimStatus } = messages.paper;

  async function ask() {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    if (!provider.local && !apiKey.trim()) return setError(messages.paper.modelRequest.keyRequired(localizedProvider(provider, messages.studio.models.providers).keyLabel));
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, question: text, assignment, apiKey: apiKey.trim() }),
      });
      const data = (await response.json().catch(() => undefined)) as (Omit<Exchange, "question"> & { error?: string }) | undefined;
      if (!response.ok || !data?.answer) throw new Error(data?.error ?? t.failed);
      setExchanges((current) => [{ question: text, answerable: data.answerable, answer: data.answer, claimIds: data.claimIds ?? [], model: data.model }, ...current]);
      setQuestion("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <ModelKeyFields assignment={assignment} onAssignment={choose} apiKey={apiKey} onApiKey={setApiKey} />

      <div className="ask-box">
        <textarea
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          rows={2}
          aria-label={t.aria}
          placeholder={t.placeholder}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
        />
        <button className="regen-primary" disabled={busy || question.trim().length < 3} onClick={() => { void ask(); }}>
          <Send size={14} /> {busy ? t.reading : t.ask}
        </button>
      </div>
      {error && <p className="regen-error" role="alert">{error}</p>}

      <ol className="ask-list" aria-live="polite">
        {exchanges.map((exchange, index) => (
          <li key={exchanges.length - index} className={exchange.answerable ? "" : "is-unanswered"}>
            <h4>{exchange.question}</h4>
            {!exchange.answerable && <span className="ask-flag">{t.notCovered}</span>}
            <p lang={project.language}>{exchange.answer}</p>
            {exchange.claimIds.length ? (
              <ul className="ask-claims">
                {exchange.claimIds.map((id) => {
                  const claim = project.evidence.claims.find((item) => item.id === id);
                  if (!claim) return null;
                  return (
                    <li key={id}>
                      <button onClick={() => onClaimSelect(id)} lang={project.language} title={claimStatus.openEvidence}>
                        {claim.statement}
                        <small lang={messages.common.locale}>{claim.sourceRefs[0]?.page ? messages.common.page(claim.sourceRefs[0].page) : "web"} · {claim.confidence === "verified" ? claimStatus.verifiedInline : claimStatus.needsReviewInline}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <small className="ask-model">{exchange.model}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}
