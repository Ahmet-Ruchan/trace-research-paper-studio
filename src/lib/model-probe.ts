import { z } from "zod";
import type { GenerationTaskRole } from "./model-providers";
import type { NarrativeTemplate, ResearchProject } from "./schema";
import { SECTION_BUDGETS, expectedSectionCounts } from "./section-budgets";

/**
 * "Modeli dene": seçilen modelin bir bölümü süre sınırı içinde yazıp
 * yazamayacağını, bölümün ücretini ya da on beş dakikasını harcamadan önce
 * söyler.
 *
 * Neden var: yerel bir 9B modelle yapılan gerçek denemede istek saniyede 0,2
 * belirteç üretiyordu ve 20 dakika sonra sessizce zaman aşımına uğradı.
 * Kullanıcının bunu önceden bilmesinin tek yolu ölçmek.
 *
 * Ölçüm iki şeyi ayırıyor, çünkü ikisi farklı ölçekleniyor:
 * - İlk parçaya kadar geçen süre: istemin okunması. Uzun istem uzun sürer,
 *   bu yüzden gerçek istemin uzunluğuyla oranlanıyor.
 * - Sonrası: üretim hızı. Bölümün beklenen çıktı uzunluğuna bölünüyor.
 * Tahmin kaba ama yönü doğru; amaç "40 saniye" ile "70 dakika"yı ayırmak.
 */

/** Deneme istemi; bölüm istemine benzer biçimde düz yazı, ama çok daha kısa. */
export const PROBE_PASSAGE = [
  "The Transformer replaces recurrence with attention. Each position attends to every other position in the same layer, so the number of sequential operations stays constant as the sequence grows.",
  "The cost moves elsewhere: self-attention compares every pair of positions, which is quadratic in sequence length, while a recurrent layer is linear in length but must process positions one after another.",
  "The authors argue that for the sentence lengths typical of machine translation, the representation dimension is larger than the sequence length, so self-attention is faster per layer in practice.",
  "They also restrict attention to a neighbourhood for very long inputs, trading some path length for lower cost, and leave a systematic study of that trade-off to future work.",
  "On WMT 2014 English-to-German the big model reaches 28.4 BLEU, and on English-to-French 41.8 BLEU, after training for 3.5 days on eight P100 GPUs.",
  "Ablations vary the number of attention heads, the key size and the amount of dropout; single-head attention is 0.9 BLEU worse than the best setting, and too many heads also degrade quality.",
  "The paper does not measure how the model behaves on tasks with much longer inputs than translation, and several of its efficiency arguments depend on that assumption holding.",
].join(" ");

export const PROBE_INSTRUCTION = "Summarise the passage below in exactly three sentences for a student. Return only the schema-compliant object.";

export const probeOutputSchema = z.object({ summary: z.string() });

/** Bir anlatı ya da rapor bölümünün yaklaşık JSON uzunluğu, karakter. */
export const EXPECTED_SECTION_CHARACTERS = 4_000;

/** Denemenin kendi süre sınırı: bu kadar kısa bir isteğe bir buçuk dakikada yanıt vermeyen model bölümü yetiştiremez. */
export const PROBE_TIMEOUT_MS = 90_000;

export type ProbeMeasurement = {
  firstChunkMs: number;
  totalMs: number;
  outputCharacters: number;
  probePromptCharacters: number;
};

export type ProbeVerdict = "fast" | "slow" | "too-slow";

export type ProbeResult = ProbeMeasurement & {
  ok: true;
  estimateSeconds: number;
  limitSeconds: number;
  verdict: ProbeVerdict;
};

export function estimateSection(
  measurement: ProbeMeasurement,
  options: { promptCharacters: number; limitMs: number; expectedOutputCharacters?: number },
) {
  const expected = options.expectedOutputCharacters ?? EXPECTED_SECTION_CHARACTERS;
  const promptScale = Math.max(1, options.promptCharacters / Math.max(1, measurement.probePromptCharacters));
  const readingMs = measurement.firstChunkMs * promptScale;
  const generationMs = Math.max(1, measurement.totalMs - measurement.firstChunkMs);
  // Çok kısa bir çıktıda hız güvenilmez: tek parçada gelen 30 karakter
  // sonsuz hız gibi görünür. O zaman toplam süre üzerinden kaba bir hız alınıyor.
  const charactersPerMs = measurement.outputCharacters >= 80
    ? measurement.outputCharacters / generationMs
    : Math.max(1, measurement.outputCharacters) / Math.max(1, measurement.totalMs);
  const estimateMs = readingMs + expected / charactersPerMs;
  const verdict: ProbeVerdict = estimateMs <= options.limitMs * 0.5
    ? "fast"
    : estimateMs <= options.limitMs
      ? "slow"
      : "too-slow";
  return {
    estimateSeconds: Math.round(estimateMs / 1000),
    limitSeconds: Math.round(options.limitMs / 1000),
    verdict,
  };
}

/**
 * Makalenin kendisi istemde kaç karakter yer tutar. PDF'in metni tarayıcıda
 * okunmuyor; 12-15 sayfalık tipik bir makalenin metni bu kadar. Kaba ama
 * yönü doğru: bulut modelleri için okuma süresi zaten tahminin küçük kısmı.
 */
export const PDF_PROMPT_CHARACTERS = 60_000;

export type ProbeStage = {
  id: GenerationTaskRole;
  /** Tahmin cümlesinin öznesi: "The deep report should take about 40 s." */
  label: string;
  promptCharacters: number;
  outputCharacters: number;
};

/**
 * Tam üretimde her görevin EN AĞIR tek isteği. Süre sınırı istek başına
 * uygulanıyor; bu yüzden toplam süre değil, en uzun istek hüküm veriyor.
 *
 * Sayılar örnek projeden ölçüldü (bkz. model-probe.test.ts; test, istemler
 * büyüyüp bu sayılar eskirse kırılıyor). Anlatı ve rapor çıktısı bölüm
 * sayısıyla ölçekleniyor; şablon varsa sayıyı şablon belirliyor.
 */
export function generationStageProfiles(options: {
  depth: ResearchProject["depth"];
  template?: NarrativeTemplate;
}): Record<GenerationTaskRole, ProbeStage> {
  const counts = expectedSectionCounts(options);
  return {
    evidence: { id: "evidence", label: "Reading the paper", promptCharacters: 2_800 + PDF_PROMPT_CHARACTERS, outputCharacters: 10_000 },
    technical: { id: "technical", label: "The method and results pass", promptCharacters: 2_800 + PDF_PROMPT_CHARACTERS, outputCharacters: 11_000 },
    report: {
      id: "report",
      label: "The deep report",
      promptCharacters: 34_000,
      outputCharacters: Math.round(17_000 * counts.report / SECTION_BUDGETS.deepReport.standard),
    },
    visual: {
      id: "visual",
      label: "The visual story",
      promptCharacters: 34_000,
      outputCharacters: Math.round(18_500 * counts.story / SECTION_BUDGETS.story.standard),
    },
  };
}

/** Birden fazla tahminden hükmü veren: en uzun süren. */
export function slowestEstimate<T extends { estimateSeconds: number }>(estimates: T[]): T | undefined {
  return estimates.reduce<T | undefined>((slowest, item) => (!slowest || item.estimateSeconds > slowest.estimateSeconds ? item : slowest), undefined);
}

export function formatDuration(seconds: number) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/** Arayüzün göstereceği tek cümle. */
export function describeProbe(
  result: Pick<ProbeResult, "firstChunkMs" | "estimateSeconds" | "limitSeconds" | "verdict">,
  subject = "A section",
) {
  const answered = `Answered in ${(result.firstChunkMs / 1000).toFixed(1)} s.`;
  const estimate = formatDuration(result.estimateSeconds);
  const limit = formatDuration(result.limitSeconds);
  if (result.verdict === "fast") return `${answered} ${subject} should take about ${estimate}.`;
  if (result.verdict === "slow") return `${answered} ${subject} should take about ${estimate}, close to the ${limit} limit.`;
  return `${answered} ${subject} would take about ${estimate}, longer than the ${limit} limit. Pick a faster model.`;
}
