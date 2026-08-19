import { GoogleGenAI, createPartFromUri } from "@google/genai";
import { z } from "zod";
import type { GenerationProgress, GenerationStreamEvent } from "@/lib/generation-events";
import {
  describeValidationError,
  validateEvidenceIntegrity,
  validateStoryIntegrity,
} from "@/lib/generation-validation";
import { buildEvidencePrompt, buildStoryPrompt } from "@/lib/prompts";
import {
  paperEvidenceSchema,
  researchProjectSchema,
  storySpecSchema,
  type PaperEvidence,
  type StorySpec,
} from "@/lib/schema";
import { fetchPublicSource, type FetchedSource } from "@/lib/safe-fetch";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PDF_BYTES = 35 * 1024 * 1024;
const MAX_STRUCTURE_ATTEMPTS = 2;
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
};

type StreamWriter = (event: GenerationStreamEvent) => void;

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

function isTransientError(error: unknown) {
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return (
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
      message,
    )
  );
}

async function withTransientRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  onRetry: (attempt: number) => void,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 3 || !isTransientError(error)) throw error;
      onRetry(attempt + 1);
      await abortableDelay(750 * 2 ** (attempt - 1), signal);
    }
  }
  throw lastError;
}

async function generateValidated<T>({
  stage,
  schema,
  request,
  prepare,
  validate,
  signal,
  onStructureRetry,
  onNetworkRetry,
}: {
  stage: string;
  schema: z.ZodType<T>;
  request: (feedback?: string) => Promise<string | undefined>;
  prepare?: (value: T) => T;
  validate: (value: T) => void;
  signal: AbortSignal;
  onStructureRetry: (attempt: number, issues: string[]) => void;
  onNetworkRetry: (attempt: number) => void;
}) {
  let feedback: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_STRUCTURE_ATTEMPTS; attempt += 1) {
    const text = await withTransientRetry(
      () => request(feedback),
      signal,
      onNetworkRetry,
    );
    try {
      const parsed = schema.parse(parseJsonResponse(text, stage));
      const prepared = prepare ? prepare(parsed) : parsed;
      validate(prepared);
      return prepared;
    } catch (error) {
      lastError = error;
      const issues = describeValidationError(error);
      if (attempt === MAX_STRUCTURE_ATTEMPTS) break;
      onStructureRetry(attempt + 1, issues);
      feedback = `The previous response failed validation. Regenerate the complete object from the source and fix every issue below. Do not mention this retry in the output.\n- ${issues.join("\n- ")}`;
    }
  }

  throw lastError;
}

async function waitUntilActive(
  ai: GoogleGenAI,
  name: string,
  signal: AbortSignal,
  emit: StreamWriter,
) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    throwIfAborted(signal);
    const file = await ai.files.get({ name, config: { abortSignal: signal } });
    const state = String(file.state ?? "ACTIVE");
    if (state === "ACTIVE") return file;
    if (state === "FAILED") throw new Error("PDF model tarafından işlenemedi.");
    if (attempt > 0 && attempt % 8 === 0) {
      emit({
        type: "progress",
        stage: "document",
        progress: Math.min(28, 18 + attempt / 4),
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

  return { file, apiKey, urls, language, audience, depth, model };
}

class InputError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function publicError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Üretim iptal edildi.";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/API_KEY_INVALID|API key not valid|invalid api key|permission_denied/i.test(message)) {
    return "Gemini API key geçersiz veya bu model için yetkili değil.";
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(message)) {
    return "Gemini kullanım kotası doldu veya istek sınırına ulaşıldı. Biraz sonra yeniden dene.";
  }
  if (/NOT_FOUND|model.*not found|404/i.test(message)) {
    return "Seçilen Gemini modeli bu API key için kullanılamıyor. Başka bir model seçip yeniden dene.";
  }
  if (/UNAVAILABLE|503|fetch failed|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return "Gemini servisine şu anda ulaşılamıyor. İstek güvenle durduruldu; yeniden deneyebilirsin.";
  }
  if (error instanceof z.ZodError || error instanceof Error && error.name === "IntegrityError") {
    return "Model çıktısı iki denemede de kanıt şemasını geçemedi. Uydurma veri yayınlanmadı.";
  }
  return message || "Paper işlenirken beklenmeyen bir hata oluştu.";
}

async function runPipeline(
  input: GenerationInput,
  signal: AbortSignal,
  emit: StreamWriter,
) {
  let uploadedName: string | undefined;
  let ai: GoogleGenAI | undefined;

  const progress = (value: GenerationProgress) => emit({ type: "progress", ...value });

  try {
    progress({
      stage: "document",
      progress: 10,
      title: "Kaynaklar güvenli alanda hazırlanıyor.",
      detail: input.urls.length
        ? `PDF ile birlikte ${input.urls.length} yardımcı kaynak kontrol ediliyor.`
        : "PDF, analiz öncesi dosya doğrulamasından geçirildi.",
    });

    ai = new GoogleGenAI({ apiKey: input.apiKey });
    const [uploaded, webResult] = await Promise.all([
      ai.files.upload({
        file: input.file,
        config: {
          mimeType: "application/pdf",
          displayName: input.file.name,
          abortSignal: signal,
        },
      }),
      loadWebSources(input.urls),
    ]);
    if (!uploaded.name) throw new Error("PDF yükleme kimliği alınamadı.");
    uploadedName = uploaded.name;

    progress({
      stage: "document",
      progress: 20,
      title: "PDF alındı, sayfalar çözümleniyor.",
      detail: `${input.file.name} · ${(input.file.size / 1024 / 1024).toFixed(1)} MB`,
    });
    const activeFile = await waitUntilActive(ai, uploaded.name, signal, emit);
    if (!activeFile.uri || !activeFile.mimeType) {
      throw new Error("PDF model URI bilgisi eksik.");
    }

    const { sources: webSources, warnings } = webResult;
    const webContext = webSources
      .map(
        (source) =>
          `SOURCE ${source.id}\nTitle: ${source.title}\nURL: ${source.url}\nCleaned content:\n${source.text}`,
      )
      .join("\n\n---\n\n");
    const evidencePrompt = buildEvidencePrompt({
      language: input.language,
      audience: input.audience,
      depth: input.depth,
      webContext,
    });

    progress({
      stage: "evidence",
      progress: 34,
      title: "Paper’ın kanıt haritası çıkarılıyor.",
      detail: "Yöntem, bulgular, metrikler ve sınırlılıklar sayfalara bağlanıyor.",
    });
    const evidence = await generateValidated<PaperEvidence>({
      stage: "Kanıt çıkarma",
      schema: paperEvidenceSchema,
      signal,
      request: async (feedback) => {
        const response = await ai!.models.generateContent({
          model: input.model,
          contents: [
            {
              role: "user",
              parts: [
                createPartFromUri(activeFile.uri!, activeFile.mimeType!),
                { text: feedback ? `${evidencePrompt}\n\nVALIDATION FEEDBACK:\n${feedback}` : evidencePrompt },
              ],
            },
          ],
          config: {
            temperature: 0.1,
            maxOutputTokens: 32_768,
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(paperEvidenceSchema),
            abortSignal: signal,
          },
        });
        return response.text;
      },
      prepare: (parsed) => ({
        ...parsed,
        sources: [
          {
            id: "paper",
            type: "paper" as const,
            title: parsed.paper.title,
            fileName: input.file.name,
          },
          ...webSources.map((source) => ({
            id: source.id,
            type: "web" as const,
            title: source.title,
            url: source.url,
          })),
        ],
      }),
      validate: validateEvidenceIntegrity,
      onStructureRetry: (attempt, issues) =>
        progress({
          stage: "evidence",
          progress: 48,
          title: "Kanıt çıktısı yeniden denetleniyor.",
          detail: `${issues.length} tutarsızlık bulundu; eksik sayfa ve bağlantılar düzeltiliyor.`,
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "evidence",
          progress: 38,
          title: "Gemini bağlantısı yeniden kuruluyor.",
          detail: `Geçici servis hatası · ağ denemesi ${attempt}/3`,
          attempt,
        }),
    });

    progress({
      stage: "evidence",
      progress: 58,
      title: "Kanıt haritası doğrulandı.",
      detail: `${evidence.claims.length} claim · ${evidence.metrics.length} metrik · ${evidence.limitations.length} sınırlılık`,
    });

    const storyPrompt = buildStoryPrompt(evidence, {
      language: input.language,
      audience: input.audience,
      depth: input.depth,
    });
    progress({
      stage: "story",
      progress: 66,
      title: "Paper için görsel anlatı tasarlanıyor.",
      detail: "Her bölüm yalnızca doğrulanmış claim ve metriklerden kuruluyor.",
    });
    const story = await generateValidated<StorySpec>({
      stage: "Story planlama",
      schema: storySpecSchema,
      signal,
      request: async (feedback) => {
        const response = await ai!.models.generateContent({
          model: input.model,
          contents: feedback
            ? `${storyPrompt}\n\nVALIDATION FEEDBACK:\n${feedback}`
            : storyPrompt,
          config: {
            temperature: 0.4,
            maxOutputTokens: 24_576,
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(storySpecSchema),
            abortSignal: signal,
          },
        });
        return response.text;
      },
      validate: (value) =>
        validateStoryIntegrity(value, evidence, expectedSections(input.depth)),
      onStructureRetry: (attempt, issues) =>
        progress({
          stage: "story",
          progress: 78,
          title: "Story bağlantıları yeniden kuruluyor.",
          detail: `${issues.length} anlatı tutarsızlığı bulundu; kanıt dışı öğeler temizleniyor.`,
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "story",
          progress: 70,
          title: "Gemini bağlantısı yeniden kuruluyor.",
          detail: `Geçici servis hatası · ağ denemesi ${attempt}/3`,
          attempt,
        }),
    });

    progress({
      stage: "finalize",
      progress: 90,
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
          // The browser disconnected; the request signal will stop remaining work.
        }
      };

      try {
        await runPipeline(input, request.signal, emit);
      } catch (error) {
        const message = publicError(error);
        console.error("Generation pipeline failed:", message);
        emit({
          type: "error",
          error: message,
        });
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
      "X-Accel-Buffering": "no",
    },
  });
}
