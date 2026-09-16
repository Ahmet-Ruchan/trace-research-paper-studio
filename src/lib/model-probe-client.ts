import type { ModelAssignment } from "./model-providers";
import type { ProbeStage, ProbeVerdict } from "./model-probe";

export type ProbeStageEstimate = {
  id: string;
  label: string;
  estimateSeconds: number | null;
  limitSeconds: number;
  verdict: ProbeVerdict;
};

export type ProbeAnswer = {
  verdict: ProbeVerdict;
  message: string;
  stages?: ProbeStageEstimate[];
};

/**
 * `/api/models/probe` çağrısı. Bölüm yeniden üretimi ve ilk üretim ekranı
 * aynı ucu kullanıyor; hata biçimi tek yerde çözülsün.
 */
export async function requestModelProbe(
  body: {
    assignment: ModelAssignment;
    apiKey: string;
    promptCharacters?: number;
    stages?: ProbeStage[];
  },
  signal?: AbortSignal,
): Promise<ProbeAnswer> {
  const response = await fetch("/api/models/probe", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => undefined)) as
    | ({ ok: true } & ProbeAnswer)
    | { ok: false; error: string }
    | undefined;
  if (!data) throw new Error("The model test returned no answer.");
  if (!data.ok) throw new Error(data.error);
  return { verdict: data.verdict, message: data.message, stages: data.stages };
}
