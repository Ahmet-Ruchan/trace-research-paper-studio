"use client";

import { useState } from "react";
import { KeyRound, Send, Server } from "lucide-react";
import { MAX_QUESTION_LENGTH } from "@/lib/evidence-qa";
import { defaultModelByProvider, getProvider, providerCatalog, resolveProviderModel, type ModelAssignment, type ProviderId } from "@/lib/model-providers";
import type { ResearchProject } from "@/lib/schema";

// Bölüm yeniden üretimiyle aynı tercih: kullanıcı modelini bir kez seçsin. Anahtar hiçbir zaman saklanmaz.
const MODEL_PREFERENCE_KEY = "trace-regeneration-model-v1";

type Exchange = { question: string; answerable: boolean; answer: string; claimIds: string[]; model: string };

function rememberedAssignment(): ModelAssignment {
  try {
    const value = JSON.parse(window.localStorage.getItem(MODEL_PREFERENCE_KEY) ?? "{}") as { provider?: unknown; model?: unknown };
    return resolveProviderModel(String(value.provider ?? ""), String(value.model ?? "")) ?? { provider: "gemini", model: defaultModelByProvider.gemini };
  } catch {
    return { provider: "gemini", model: defaultModelByProvider.gemini };
  }
}

/**
 * Makaleye soru sormak — ama cevap yalnızca toplanmış kanıttan gelir.
 *
 * Genel bir sohbet kutusu her soruya akıcı bir cevap verir; burada model
 * makaleyi görmüyor, kanıt defterini görüyor ve dayandığı iddiaları göstermek
 * zorunda. Defterde olmayan şey için doğru cevap "toplanan kanıt bunu
 * söylemiyor". Sorular ve cevaplar saklanmaz; sayfa yenilenince giderler.
 */
export function AskPanel({ project, onClaimSelect }: { project: ResearchProject; onClaimSelect: (claimId: string) => void }) {
  const [assignment, setAssignment] = useState<ModelAssignment>(rememberedAssignment);
  const [apiKey, setApiKey] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const provider = getProvider(assignment.provider)!;

  function choose(next: ModelAssignment) {
    setAssignment(next);
    try {
      window.localStorage.setItem(MODEL_PREFERENCE_KEY, JSON.stringify(next));
    } catch {
      // Depolama kapalıysa tercih yalnızca bu oturumda kalır.
    }
  }

  async function ask() {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    if (!provider.local && !apiKey.trim()) return setError(`${provider.keyLabel} is required.`);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, question: text, assignment, apiKey: apiKey.trim() }),
      });
      const data = (await response.json().catch(() => undefined)) as (Omit<Exchange, "question"> & { error?: string }) | undefined;
      if (!response.ok || !data?.answer) throw new Error(data?.error ?? "The question could not be answered.");
      setExchanges((current) => [{ question: text, answerable: data.answerable, answer: data.answer, claimIds: data.claimIds ?? [], model: data.model }, ...current]);
      setQuestion("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The question could not be answered.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <div className="regen-model">
        <div className="model-select provider-select">
          <select aria-label="Provider" value={assignment.provider} onChange={(event) => choose({ provider: event.target.value as ProviderId, model: defaultModelByProvider[event.target.value as ProviderId] })}>
            {providerCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div className="model-select">
          {provider.freeformModel ? (
            <input aria-label="Model" value={assignment.model} onChange={(event) => choose({ ...assignment, model: event.target.value })} spellCheck={false} />
          ) : (
            <select aria-label="Model" value={assignment.model} onChange={(event) => choose({ ...assignment, model: event.target.value })}>
              {provider.models.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.note}</option>)}
            </select>
          )}
        </div>
        <div className="key-input">
          {provider.local ? <Server size={14} /> : <KeyRound size={14} />}
          <input
            type={provider.local ? "text" : "password"}
            aria-label={provider.keyLabel}
            placeholder={provider.local ? "Local server address (optional)" : provider.keyLabel}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="ask-box">
        <textarea
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          rows={2}
          aria-label="Your question about the paper"
          placeholder="Ask what the paper says — for example: how was the big model trained?"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
        />
        <button className="regen-primary" disabled={busy || question.trim().length < 3} onClick={() => { void ask(); }}>
          <Send size={14} /> {busy ? "Reading the evidence…" : "Ask"}
        </button>
      </div>
      {error && <p className="regen-error" role="alert">{error}</p>}

      <ol className="ask-list" aria-live="polite">
        {exchanges.map((exchange, index) => (
          <li key={exchanges.length - index} className={exchange.answerable ? "" : "is-unanswered"}>
            <h4>{exchange.question}</h4>
            {!exchange.answerable && <span className="ask-flag">Not covered by the collected evidence</span>}
            <p lang={project.language}>{exchange.answer}</p>
            {exchange.claimIds.length ? (
              <ul className="ask-claims">
                {exchange.claimIds.map((id) => {
                  const claim = project.evidence.claims.find((item) => item.id === id);
                  if (!claim) return null;
                  return (
                    <li key={id}>
                      <button onClick={() => onClaimSelect(id)} lang={project.language} title="Open the evidence for this claim">
                        {claim.statement}
                        <small>{claim.sourceRefs[0]?.page ? `p. ${claim.sourceRefs[0].page}` : "web"} · {claim.confidence === "verified" ? "verified" : "needs review"}</small>
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
