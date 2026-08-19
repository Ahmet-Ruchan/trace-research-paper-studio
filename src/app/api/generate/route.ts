import { createHash } from "node:crypto";
import { GoogleGenAI, createPartFromUri } from "@google/genai";
import { z } from "zod";
import {
  evidenceCheckpointSchema,
  evidencePassIds,
  evidencePassLabels,
  evidencePassSchemas,
  mergeEvidenceParts,
  validateEvidencePass,
  type EvidenceCheckpoint,
  type EvidencePassId,
  type EvidencePassOutputs,
} from "@/lib/evidence-pipeline";
import type { GenerationProgress, GenerationStreamEvent } from "@/lib/generation-events";
import {
  describeValidationError,
  validateEvidenceIntegrity,
  validateStoryIntegrity,
} from "@/lib/generation-validation";
import { buildEvidencePassPrompt, buildStoryPrompt } from "@/lib/prompts";
import {
  researchProjectSchema,
  storySpecSchema,
  type Source,
  type StorySpec,
} from "@/lib/schema";
import { fetchPublicSource, type FetchedSource } from "@/lib/safe-fetch";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PDF_BYTES = 35 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 750 * 1024;
const MAX_STRUCTURE_ATTEMPTS = 2;
const MAX_NETWORK_ATTEMPTS = 2;
const MODEL_TIMEOUT_MS = 120_000;
const HEARTBEAT_MS = 10_000;
const EVIDENCE_CONCURRENCY = 2;
const allowedModels = new Set([
  "gemini-3.7-flash",
  "gemini-3.1-pro-preview",
  "gemini-2.5-flash",
]);

type GenerationInput = {
  file: File;
  apiKey: string;
  urls: string[];
  language: "tr" | "en";
  audience: "general" | "student" | "expert";
  depth: "concise" | "standard" | "deep";
  model: string;
  checkpoint?: unknown;
};

type StreamWriter = (event: GenerationStreamEvent) => void;
type ProgressWriter = (progress: GenerationProgress) => void;

function jsonError(message: string, status: number, detail?: unknown) {
  return Response.json({ error: message, detail }, { status });
}

function parseJsonResponse(text: string | undefined, stage: string) {
  if (!text) throw new Error(`${stage} aşaması boş yanıt döndürdü.`);
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error(`${stage} aşaması geçerli JSON döndürmedi.`);
  }
}

function expectedSections(depth: GenerationInput["depth"]) {
  return depth === "concise" ? 5 : depth === "deep" ? 8 : 6;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Generation aborted", "AbortError");
}

async function abortableDelay(ms: number, signal: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Generation aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  if ("status" in error) return Number((error as { status?: unknown }).status);
  if ("cause" in error) return errorStatus((error as { cause?: unknown }).cause);
  return undefined;
}

function isTransientError(error: unknown) {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return (
    (error instanceof Error && error.name === "AbortError") ||
    status === 408 ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT|terminated|fetch failed/i.test(
      message,
    )
  );
}

function safeDiagnostic(error: unknown) {
  const value = error as { name?: unknown; code?: unknown; cause?: { name?: unknown; code?: unknown } };
  return {
    name: error instanceof Error ? error.name : typeof error,
    status: errorStatus(error),
    code: typeof value?.code === "string" ? value.code : undefined,
    causeName: typeof value?.cause?.name === "string" ? value.cause.name : undefined,
    causeCode: typeof value?.cause?.code === "string" ? value.cause.code : undefined,
  };
}

async function withTransientRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  onRetry: (attempt: number) => void,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_NETWORK_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      throwIfAborted(signal);
      if (attempt === MAX_NETWORK_ATTEMPTS || !isTransientError(error)) throw error;
      onRetry(attempt + 1);
      await abortableDelay(900 * 2 ** (attempt - 1), signal);
    }
  }
  throw lastError;
}

async function generateValidated<T>({
  stage,
  schema,
  request,
  validate,
  signal,
  onStructureRetry,
  onNetworkRetry,
}: {
  stage: string;
  schema: z.ZodType<T>;
  request: (feedback?: string) => Promise<string | undefined>;
  validate: (value: T) => void;
  signal: AbortSignal;
  onStructureRetry: (attempt: number, issues: string[]) => void;
  onNetworkRetry: (attempt: number) => void;
}) {
  let feedback: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_STRUCTURE_ATTEMPTS; attempt += 1) {
    const text = await withTransientRetry(() => request(feedback), signal, onNetworkRetry);
    try {
      const parsed = schema.parse(parseJsonResponse(text, stage));
      validate(parsed);
      return parsed;
    } catch (error) {
      lastError = error;
      const issues = describeValidationError(error);
      if (attempt === MAX_STRUCTURE_ATTEMPTS) break;
      onStructureRetry(attempt + 1, issues);
      feedback = `The previous response failed validation. Regenerate the complete object for this task and fix every issue below. Do not mention this retry in the output.\n- ${issues.join("\n- ")}`;
    }
  }

  throw lastError;
}

async function collectStructuredStream(
  createStream: () => ReturnType<GoogleGenAI["models"]["generateContentStream"]>,
  onChunk: (receivedCharacters: number, chunks: number) => void,
) {
  const stream = await createStream();
  let text = "";
  let chunks = 0;
  for await (const chunk of stream) {
    const delta = chunk.text ?? "";
    if (!delta) continue;
    text += delta;
    chunks += 1;
    onChunk(text.length, chunks);
  }
  return text;
}

async function waitUntilActive(
  ai: GoogleGenAI,
  name: string,
  signal: AbortSignal,
  progress: ProgressWriter,
) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    throwIfAborted(signal);
    const file = await ai.files.get({ name, config: { abortSignal: signal } });
    const state = String(file.state ?? "ACTIVE");
    if (state === "ACTIVE") return file;
    if (state === "FAILED") throw new Error("PDF model tarafından işlenemedi.");
    if (attempt > 0 && attempt % 8 === 0) {
      progress({
        stage: "document",
        progress: Math.min(25, 18 + attempt / 5),
        title: "PDF model için hazırlanıyor.",
        detail: "Belge sayfaları ve görsel katmanları ayrıştırılıyor.",
      });
    }
    await abortableDelay(1_000, signal);
  }
  throw new Error("PDF işleme zaman aşımına uğradı.");
}

async function loadWebSources(urls: string[]) {
  const results = await Promise.allSettled(
    urls.map((url, index) => fetchPublicSource(url, `web-${index + 1}`)),
  );
  const sources: FetchedSource[] = [];
  const warnings: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") sources.push(result.value);
    else {
      warnings.push(
        `${urls[index]}: ${result.reason instanceof Error ? result.reason.message : "okunamadı"}`,
      );
    }
  });
  return { sources, warnings };
}

function parseInput(form: FormData): GenerationInput {
  const file = form.get("paper");
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const language = form.get("language") === "en" ? "en" : "tr";
  const audienceValue = String(form.get("audience") ?? "student");
  const audience = ["general", "student", "expert"].includes(audienceValue)
    ? (audienceValue as GenerationInput["audience"])
    : "student";
  const depthValue = String(form.get("depth") ?? "standard");
  const depth = ["concise", "standard", "deep"].includes(depthValue)
    ? (depthValue as GenerationInput["depth"])
    : "standard";
  const requestedModel = String(form.get("model") ?? "gemini-3.7-flash");
  const model = allowedModels.has(requestedModel) ? requestedModel : "gemini-3.7-flash";

  if (!(file instanceof File)) throw new InputError("Bir PDF dosyası yüklemelisin.", 400);
  if (file.type !== "application/pdf") {
    throw new InputError("Yalnızca PDF dosyaları destekleniyor.", 415);
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new InputError("PDF boyutu 35 MB sınırını aşıyor.", 413);
  }
  if (!apiKey) throw new InputError("Gemini API key gerekli.", 401);

  let urls: string[] = [];
  try {
    const rawUrls = JSON.parse(String(form.get("sources") ?? "[]"));
    if (!Array.isArray(rawUrls)) throw new Error("array expected");
    urls = rawUrls.filter((item): item is string => typeof item === "string").slice(0, 3);
  } catch {
    throw new InputError("Kaynak URL listesi geçersiz.", 400);
  }

  let checkpoint: unknown;
  const rawCheckpoint = String(form.get("checkpoint") ?? "");
  if (rawCheckpoint && rawCheckpoint.length <= MAX_CHECKPOINT_BYTES) {
    try {
      checkpoint = JSON.parse(rawCheckpoint);
    } catch {
      checkpoint = undefined;
    }
  }

  return { file, apiKey, urls, language, audience, depth, model, checkpoint };
}

class InputError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function publicError(error: unknown, callerAborted: boolean) {
  if (callerAborted) return "Üretim iptal edildi.";
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") {
    return "Model aşaması 120 saniyede tamamlanmadı. Tamamlanan aşamalar korundu; yeniden deneyebilirsin.";
  }
  if (/API_KEY_INVALID|API key not valid|invalid api key|permission_denied/i.test(message)) {
    return "Gemini API key geçersiz veya bu model için yetkili değil.";
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(message)) {
    return "Gemini kullanım kotası doldu veya istek sınırına ulaşıldı. Tamamlanan aşamalar korundu.";
  }
  if (/NOT_FOUND|model.*not found|404/i.test(message)) {
    return "Seçilen Gemini modeli bu API key için kullanılamıyor. Başka bir model seçip yeniden dene.";
  }
  if (/UNAVAILABLE|503|504|fetch failed|ECONNRESET|ETIMEDOUT|terminated/i.test(message)) {
    return "Gemini servisine şu anda ulaşılamıyor. Tamamlanan aşamalar korundu; yeniden deneyebilirsin.";
  }
  if (error instanceof z.ZodError || error instanceof Error && error.name === "IntegrityError") {
    return "Model çıktısı iki denemede de kanıt şemasını geçemedi. Uydurma veri yayınlanmadı; tamamlanan aşamalar korundu.";
  }
  return message || "Paper işlenirken beklenmeyen bir hata oluştu.";
}

async function inputFingerprint(input: GenerationInput) {
  const fileHash = createHash("sha256")
    .update(Buffer.from(await input.file.arrayBuffer()))
    .digest("hex");
  return createHash("sha256")
    .update(fileHash)
    .update(JSON.stringify({
      urls: input.urls,
      language: input.language,
      audience: input.audience,
      depth: input.depth,
      model: input.model,
    }))
    .digest("hex");
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  let failure: unknown;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length && !failure) {
      const item = items[cursor];
      cursor += 1;
      try {
        await worker(item);
      } catch (error) {
        failure = error;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}

function setCheckpointPart<Key extends EvidencePassId>(
  checkpoint: EvidenceCheckpoint,
  passId: Key,
  value: EvidencePassOutputs[Key],
) {
  const parts = checkpoint.parts as Partial<
    Record<EvidencePassId, EvidencePassOutputs[EvidencePassId]>
  >;
  parts[passId] = value;
}

function completedPasses(checkpoint: EvidenceCheckpoint) {
  return evidencePassIds.filter((passId) => Boolean(checkpoint.parts[passId]));
}

async function runPipeline(
  input: GenerationInput,
  signal: AbortSignal,
  emit: StreamWriter,
) {
  let uploadedName: string | undefined;
  let ai: GoogleGenAI | undefined;
  let lastProgress: GenerationProgress | undefined;
  let lastEmitAt = Date.now();
  let lastProviderActivityAt = Date.now();

  const progress: ProgressWriter = (value) => {
    const next = {
      ...value,
      activityAt: value.activityAt ?? new Date(lastProviderActivityAt).toISOString(),
      heartbeat: false,
    };
    lastProgress = next;
    lastEmitAt = Date.now();
    emit({ type: "progress", ...next });
  };
  const markProviderActivity = () => {
    lastProviderActivityAt = Date.now();
  };
  const heartbeat = setInterval(() => {
    if (!lastProgress || Date.now() - lastEmitAt < HEARTBEAT_MS) return;
    lastEmitAt = Date.now();
    emit({
      type: "progress",
      ...lastProgress,
      heartbeat: true,
      activityAt: new Date(lastProviderActivityAt).toISOString(),
    });
  }, HEARTBEAT_MS);

  try {
    progress({
      stage: "document",
      progress: 8,
      title: "Kaynaklar güvenli alanda hazırlanıyor.",
      detail: input.urls.length
        ? `PDF ile birlikte ${input.urls.length} yardımcı kaynak kontrol ediliyor.`
        : "PDF, analiz öncesi dosya doğrulamasından geçirildi.",
    });

    ai = new GoogleGenAI({
      apiKey: input.apiKey,
      httpOptions: {
        timeout: MODEL_TIMEOUT_MS,
        retryOptions: { attempts: 1 },
      },
    });
    const [uploaded, webResult, fingerprint] = await Promise.all([
      ai.files.upload({
        file: input.file,
        config: {
          mimeType: "application/pdf",
          displayName: input.file.name,
          abortSignal: signal,
        },
      }),
      loadWebSources(input.urls),
      inputFingerprint(input),
    ]);
    markProviderActivity();
    if (!uploaded.name) throw new Error("PDF yükleme kimliği alınamadı.");
    uploadedName = uploaded.name;

    progress({
      stage: "document",
      progress: 18,
      title: "PDF alındı, sayfalar çözümleniyor.",
      detail: `${input.file.name} · ${(input.file.size / 1024 / 1024).toFixed(1)} MB`,
    });
    const activeFile = await waitUntilActive(ai, uploaded.name, signal, progress);
    markProviderActivity();
    if (!activeFile.uri || !activeFile.mimeType) {
      throw new Error("PDF model URI bilgisi eksik.");
    }

    const { sources: webSources, warnings } = webResult;
    const sourceIds = new Set(["paper", ...webSources.map((source) => source.id)]);
    const webContext = webSources
      .map(
        (source) =>
          `SOURCE ${source.id}\nTitle: ${source.title}\nURL: ${source.url}\nCleaned content:\n${source.text}`,
      )
      .join("\n\n---\n\n");

    const parsedCheckpoint = evidenceCheckpointSchema.safeParse(input.checkpoint);
    const checkpoint: EvidenceCheckpoint =
      parsedCheckpoint.success && parsedCheckpoint.data.inputFingerprint === fingerprint
        ? structuredClone(parsedCheckpoint.data)
        : { version: 1, inputFingerprint: fingerprint, parts: {} };

    evidencePassIds.forEach((passId) => {
      const savedPart = checkpoint.parts[passId];
      if (!savedPart) return;
      try {
        validateEvidencePass(passId, savedPart, sourceIds);
      } catch {
        delete checkpoint.parts[passId];
      }
    });

    let completed = completedPasses(checkpoint).length;
    let evidenceHighWater = 27 + completed * 8;
    if (completed > 0) {
      progress({
        stage: "evidence",
        progress: evidenceHighWater,
        title: "Kaydedilmiş evidence aşamalarından devam ediliyor.",
        detail: `${completed}/4 aşama yeniden kullanılacak; yalnızca eksikler üretilecek.`,
      });
      emit({ type: "checkpoint", checkpoint, completed: completedPasses(checkpoint) });
    } else {
      progress({
        stage: "evidence",
        progress: 27,
        title: "Paper dört kanıt katmanına ayrılıyor.",
        detail: "En fazla iki küçük model görevi aynı anda çalışacak.",
      });
      emit({ type: "checkpoint", checkpoint, completed: [] });
    }

    const tokenLimits: Record<EvidencePassId, number> = {
      overview: 8_192,
      methods: 12_288,
      results: 12_288,
      limitations: 8_192,
    };
    const lastChunkNotice = new Map<EvidencePassId, number>();

    async function runEvidencePass<Key extends EvidencePassId>(passId: Key) {
      const stageStartedAt = Date.now();
      const schema = evidencePassSchemas[passId];
      const prompt = buildEvidencePassPrompt(
        {
          language: input.language,
          audience: input.audience,
          depth: input.depth,
          webContext,
        },
        passId,
      );

      progress({
        stage: "evidence",
        progress: evidenceHighWater,
        title: `${evidencePassLabels[passId]} çıkarılıyor.`,
        detail: `${completed}/4 aşama tamamlandı · structured stream bekleniyor`,
      });

      try {
        const output = await generateValidated<EvidencePassOutputs[Key]>({
          stage: evidencePassLabels[passId],
          schema,
          signal,
          request: async (feedback) =>
            collectStructuredStream(
              () =>
                ai!.models.generateContentStream({
                  model: input.model,
                  contents: [
                    {
                      role: "user",
                      parts: [
                        createPartFromUri(activeFile.uri!, activeFile.mimeType!),
                        { text: feedback ? `${prompt}\n\nVALIDATION FEEDBACK:\n${feedback}` : prompt },
                      ],
                    },
                  ],
                  config: {
                    temperature: 0.1,
                    maxOutputTokens: tokenLimits[passId],
                    responseMimeType: "application/json",
                    responseJsonSchema: z.toJSONSchema(schema),
                    abortSignal: signal,
                  },
                }),
              (characters) => {
                markProviderActivity();
                const now = Date.now();
                if (now - (lastChunkNotice.get(passId) ?? 0) < 900) return;
                lastChunkNotice.set(passId, now);
                const partial = Math.min(0.85, characters / 8_000);
                evidenceHighWater = Math.max(
                  evidenceHighWater,
                  27 + ((completed + partial) / evidencePassIds.length) * 34,
                );
                progress({
                  stage: "evidence",
                  progress: evidenceHighWater,
                  title: `${evidencePassLabels[passId]} stream ediliyor.`,
                  detail: `${characters.toLocaleString("tr-TR")} karakter alındı · ${completed}/4 aşama tamamlandı`,
                });
              },
            ),
          validate: (value) => validateEvidencePass(passId, value, sourceIds),
          onStructureRetry: (attempt, issues) =>
            progress({
              stage: "evidence",
              progress: evidenceHighWater,
              title: `${evidencePassLabels[passId]} yeniden denetleniyor.`,
              detail: `${issues.length} tutarsızlık temizleniyor · yapı denemesi ${attempt}/2`,
              attempt,
            }),
          onNetworkRetry: (attempt) =>
            progress({
              stage: "evidence",
              progress: evidenceHighWater,
              title: `${evidencePassLabels[passId]} bağlantısı yenileniyor.`,
              detail: `Geçici model hatası · ağ denemesi ${attempt}/${MAX_NETWORK_ATTEMPTS}`,
              attempt,
            }),
        });

        setCheckpointPart(checkpoint, passId, output);
        completed += 1;
        evidenceHighWater = Math.max(evidenceHighWater, 27 + completed * 8.5);
        emit({ type: "checkpoint", checkpoint, completed: completedPasses(checkpoint) });
        progress({
          stage: "evidence",
          progress: evidenceHighWater,
          title: `${evidencePassLabels[passId]} doğrulandı.`,
          detail: `${completed}/4 evidence aşaması tamamlandı ve checkpoint’e kaydedildi.`,
        });
        console.info("Trace generation stage", {
          stage: `evidence:${passId}`,
          durationMs: Date.now() - stageStartedAt,
          model: input.model,
          status: "completed",
        });
      } catch (error) {
        console.error("Trace generation stage", {
          stage: `evidence:${passId}`,
          durationMs: Date.now() - stageStartedAt,
          model: input.model,
          outcome: "failed",
          ...safeDiagnostic(error),
        });
        throw error;
      }
    }

    const missingPasses = evidencePassIds.filter((passId) => !checkpoint.parts[passId]);
    await runWithConcurrency(missingPasses, EVIDENCE_CONCURRENCY, runEvidencePass);

    const overview = checkpoint.parts.overview;
    if (!overview) throw new Error("Paper overview checkpoint’i bulunamadı.");
    const sources: Source[] = [
      {
        id: "paper",
        type: "paper",
        title: overview.paper.title,
        fileName: input.file.name,
      },
      ...webSources.map((source) => ({
        id: source.id,
        type: "web" as const,
        title: source.title,
        url: source.url,
      })),
    ];
    const evidence = mergeEvidenceParts(checkpoint.parts, sources);
    validateEvidenceIntegrity(evidence);

    progress({
      stage: "evidence",
      progress: 64,
      title: "Dört evidence katmanı birleştirildi.",
      detail: `${evidence.claims.length} claim · ${evidence.metrics.length} metrik · ${evidence.limitations.length} sınırlılık`,
    });

    const storyPrompt = buildStoryPrompt(evidence, {
      language: input.language,
      audience: input.audience,
      depth: input.depth,
    });
    let storyHighWater = 69;
    let lastStoryNotice = 0;
    const storyStartedAt = Date.now();
    progress({
      stage: "story",
      progress: storyHighWater,
      title: "Paper için görsel anlatı tasarlanıyor.",
      detail: "StorySpec structured stream üzerinden parça parça alınıyor.",
    });
    const story = await generateValidated<StorySpec>({
      stage: "Story planlama",
      schema: storySpecSchema,
      signal,
      request: async (feedback) =>
        collectStructuredStream(
          () =>
            ai!.models.generateContentStream({
              model: input.model,
              contents: feedback
                ? `${storyPrompt}\n\nVALIDATION FEEDBACK:\n${feedback}`
                : storyPrompt,
              config: {
                temperature: 0.4,
                maxOutputTokens: 16_384,
                responseMimeType: "application/json",
                responseJsonSchema: z.toJSONSchema(storySpecSchema),
                abortSignal: signal,
              },
            }),
          (characters) => {
            markProviderActivity();
            const now = Date.now();
            if (now - lastStoryNotice < 900) return;
            lastStoryNotice = now;
            storyHighWater = Math.max(storyHighWater, 69 + Math.min(17, characters / 600));
            progress({
              stage: "story",
              progress: storyHighWater,
              title: "StorySpec stream ediliyor.",
              detail: `${characters.toLocaleString("tr-TR")} karakterlik doğrulanmış anlatı alındı.`,
            });
          },
        ),
      validate: (value) =>
        validateStoryIntegrity(value, evidence, expectedSections(input.depth)),
      onStructureRetry: (attempt, issues) =>
        progress({
          stage: "story",
          progress: storyHighWater,
          title: "Story bağlantıları yeniden kuruluyor.",
          detail: `${issues.length} anlatı tutarsızlığı temizleniyor · yapı denemesi ${attempt}/2`,
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "story",
          progress: storyHighWater,
          title: "Story bağlantısı yenileniyor.",
          detail: `Geçici model hatası · ağ denemesi ${attempt}/${MAX_NETWORK_ATTEMPTS}`,
          attempt,
        }),
    });
    console.info("Trace generation stage", {
      stage: "story",
      durationMs: Date.now() - storyStartedAt,
      model: input.model,
      status: "completed",
    });

    progress({
      stage: "finalize",
      progress: 91,
      title: "Son bütünlük denetimi yapılıyor.",
      detail: "Claim, sayfa, metrik ve görsel bağlantıları birlikte kontrol ediliyor.",
    });
    validateEvidenceIntegrity(evidence);
    validateStoryIntegrity(story, evidence, expectedSections(input.depth));

    const now = new Date().toISOString();
    const project = researchProjectSchema.parse({
      version: 1,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      language: input.language,
      audience: input.audience,
      depth: input.depth,
      evidence,
      story,
    });

    progress({
      stage: "finalize",
      progress: 97,
      title: "Geçici dosyalar temizleniyor.",
      detail: "PDF Gemini Files alanından siliniyor; API key saklanmıyor.",
    });
    await ai.files.delete({ name: uploadedName, config: { abortSignal: signal } }).catch(() => undefined);
    uploadedName = undefined;

    emit({ type: "result", project, warnings });
  } finally {
    clearInterval(heartbeat);
    if (ai && uploadedName) {
      await ai.files.delete({ name: uploadedName }).catch(() => undefined);
    }
  }
}

export async function POST(request: Request) {
  let input: GenerationInput;
  try {
    input = parseInput(await request.formData());
  } catch (error) {
    if (error instanceof InputError) return jsonError(error.message, error.status);
    return jsonError("Gönderilen form verisi okunamadı.", 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: StreamWriter = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser disconnected; request.signal stops the provider work.
        }
      };

      try {
        await runPipeline(input, request.signal, emit);
      } catch (error) {
        const message = publicError(error, request.signal.aborted);
        console.error("Trace generation pipeline failed", {
          model: input.model,
          ...safeDiagnostic(error),
        });
        emit({ type: "error", error: message });
      } finally {
        try {
          controller.close();
        } catch {
          // Stream was already closed by the client.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Content-Encoding": "identity",
      "X-Accel-Buffering": "no",
    },
  });
}
