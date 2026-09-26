import {
  buildLearningPrompt,
  learningBlockSpec,
  validateLearningBlock,
  type LearningBlockId,
  type LearningContext,
} from "@/lib/learning-generation";
import { generateValidated, type ProviderRuntime } from "./model-runtime";

export type LearningBlockEvents = {
  /** Akıştan gelen karakter sayısı; ilerleme ve etkinlik için. */
  onChunk: (characters: number) => void;
  onStructureRetry: (attempt: number, issues: string[]) => void;
  onNetworkRetry: (attempt: number) => void;
};

/**
 * Öğrenme katmanının tek bloğu: istem, şema ve doğrulama bir arada. Tam
 * analiz de mevcut bir projeye katmanı ekleyen uç da bunu çağırıyor; ikisi
 * ayrı yazılsaydı biri diğerinin reddedeceği bir blok kabul edebilirdi.
 */
export function generateLearningBlock(
  block: LearningBlockId,
  runtime: ProviderRuntime,
  context: LearningContext,
  signal: AbortSignal,
  events: LearningBlockEvents,
) {
  const spec = learningBlockSpec(block);
  const prompt = buildLearningPrompt(block, context);
  return generateValidated<unknown>({
    stage: spec.title,
    schema: spec.schema,
    signal,
    request: async (feedback) =>
      runtime.generateStructured({
        prompt: feedback ? `${prompt}\n\nVALIDATION FEEDBACK:\n${feedback}` : prompt,
        schema: spec.schema,
        schemaName: spec.schemaName,
        maxOutputTokens: spec.maxOutputTokens,
        includeDocument: false,
        signal,
        onChunk: (characters) => events.onChunk(characters),
      }),
    validate: (value) => validateLearningBlock(block, value, context),
    onStructureRetry: events.onStructureRetry,
    onNetworkRetry: events.onNetworkRetry,
  });
}

function errorStatus(error: unknown) {
  return typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
}

/** Anahtar reddedildi: aynı modele giden sonraki istekler de düşecek. */
export function refusesEveryRequest(error: unknown) {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

/** Uyarıda gösterilecek kısa neden; model çıktısını ya da anahtarı taşımaz. */
export function learningFailureReason(error: unknown) {
  const status = errorStatus(error);
  if (status === 401 || status === 403) return "The teaching model's key was refused.";
  if (status === 429) return "The teaching model's rate limit was reached.";
  if (error instanceof Error && error.name === "TimeoutError") return "The teaching model did not answer in time.";
  if (error instanceof Error && /integrity check failed|ZodError|did not return valid JSON/i.test(`${error.name} ${error.message}`)) {
    return "The model's answer did not pass the checks twice.";
  }
  return "The teaching model returned an error.";
}
