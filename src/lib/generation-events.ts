import type { SectionTarget } from "./section-regeneration";

export const generationStages = [
  {
    id: "document",
    label: "Document preparation",
    description: "Preparing the PDF and supporting sources safely.",
  },
  {
    id: "evidence",
    label: "Evidence extraction",
    description: "Locating claims, metrics and page references.",
  },
  {
    id: "story",
    label: "Specialist outputs",
    description: "Visual story, deep report, technical appendix and learning material, built by the assigned models.",
  },
  {
    id: "finalize",
    label: "Final check",
    description: "Checking every link and the data schema.",
  },
] as const;

export type GenerationStageId = (typeof generationStages)[number]["id"];

export type GenerationProgress = {
  stage: GenerationStageId;
  progress: number;
  title: string;
  detail: string;
  attempt?: number;
  activityAt?: string;
  heartbeat?: boolean;
};

export type GenerationStreamEvent =
  | ({ type: "progress" } & GenerationProgress)
  | { type: "checkpoint"; checkpoint: unknown; completed: string[] }
  | { type: "result"; project: unknown; warnings: string[] }
  /** Bölüm yeniden üretiminin sonucu: proje değil, yalnızca bölüm ve dayandığı kanıtın mührü. */
  | { type: "section"; target: SectionTarget; section: unknown; evidenceFingerprint: string }
  /** Mevcut bir projeye eklenen öğrenme katmanı: yazılan bloklar ve yazılamayanlar. */
  | { type: "learning"; blocks: unknown; failed: Array<{ block: string; reason: string }>; evidenceFingerprint: string }
  | { type: "error"; error: string; detail?: unknown };

export const initialGenerationProgress: GenerationProgress = {
  stage: "document",
  progress: 4,
  title: "Sending the paper.",
  detail: "The API key stays in memory for this request only.",
};

export function isGenerationStreamEvent(value: unknown): value is GenerationStreamEvent {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === "progress" || type === "checkpoint" || type === "result" || type === "section" || type === "learning" || type === "error";
}

/**
 * Satır satır JSON akışını okur ve her geçerli olayı `onEvent`'e verir.
 *
 * Tam üretim ve bölüm yeniden üretimi aynı akış biçimini konuşuyor; okuyucu
 * iki yerde ayrı yazılırsa satır bölme hatası (son satırın yarım gelmesi)
 * birinde düzeltilip ötekinde kalırdı. `onEvent` fırlatırsa okuma durur.
 */
export async function readGenerationStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: GenerationStreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        const event: unknown = JSON.parse(line);
        if (isGenerationStreamEvent(event)) onEvent(event);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
