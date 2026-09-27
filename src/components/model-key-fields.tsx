"use client";

import { useState } from "react";
import { KeyRound, Server } from "lucide-react";
import { defaultModelByProvider, getProvider, providerCatalog, resolveProviderModel, type ModelAssignment, type ProviderId } from "@/lib/model-providers";

// Bölüm yeniden üretimiyle aynı tercih: kullanıcı modelini bir kez seçsin. Anahtar hiçbir zaman saklanmaz.
export const MODEL_PREFERENCE_KEY = "trace-regeneration-model-v1";

function rememberedAssignment(): ModelAssignment {
  try {
    const value = JSON.parse(window.localStorage.getItem(MODEL_PREFERENCE_KEY) ?? "{}") as { provider?: unknown; model?: unknown };
    return resolveProviderModel(String(value.provider ?? ""), String(value.model ?? "")) ?? { provider: "gemini", model: defaultModelByProvider.gemini };
  } catch {
    return { provider: "gemini", model: defaultModelByProvider.gemini };
  }
}

/** Seçilen model bu tarayıcıda hatırlanıyor; depolama kapalıysa yalnızca bu oturumda kalıyor. */
export function useRememberedAssignment() {
  const [assignment, setAssignment] = useState<ModelAssignment>(rememberedAssignment);
  function choose(next: ModelAssignment) {
    setAssignment(next);
    try {
      window.localStorage.setItem(MODEL_PREFERENCE_KEY, JSON.stringify(next));
    } catch {
      // Depolama kapalıysa tercih yalnızca bu oturumda kalır.
    }
  }
  return [assignment, choose] as const;
}

/** Sağlayıcı, model ve anahtar (ya da yerel sunucu adresi) alanları: Ask ve açıklama denetimi ortak kullanıyor. */
export function ModelKeyFields({
  assignment,
  onAssignment,
  apiKey,
  onApiKey,
}: {
  assignment: ModelAssignment;
  onAssignment: (next: ModelAssignment) => void;
  apiKey: string;
  onApiKey: (value: string) => void;
}) {
  const provider = getProvider(assignment.provider)!;
  return (
    <div className="regen-model">
      <div className="model-select provider-select">
        <select aria-label="Provider" value={assignment.provider} onChange={(event) => onAssignment({ provider: event.target.value as ProviderId, model: defaultModelByProvider[event.target.value as ProviderId] })}>
          {providerCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <div className="model-select">
        {provider.freeformModel ? (
          <input aria-label="Model" value={assignment.model} onChange={(event) => onAssignment({ ...assignment, model: event.target.value })} spellCheck={false} />
        ) : (
          <select aria-label="Model" value={assignment.model} onChange={(event) => onAssignment({ ...assignment, model: event.target.value })}>
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
          onChange={(event) => onApiKey(event.target.value)}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
