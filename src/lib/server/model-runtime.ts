import { GoogleGenAI, createPartFromUri } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";
import type { GenerationProgress } from "@/lib/generation-events";
import { describeValidationError } from "@/lib/generation-validation";
import { localUrl } from "@/lib/local-endpoint";
import {
  getProvider,
  type GenerationTaskRole,
  type ModelAssignment,
  type ProviderId,
} from "@/lib/model-providers";
import { omitNullObjectFields, openAiJsonSchema } from "@/lib/openai-structured";

/**
 * Sağlayıcı çalışma zamanı: bir model atamasını, yapılandırılmış JSON üreten
 * tek bir arayüze çevirir.
 *
 * Eskiden `api/generate/route.ts` içindeydi. Oradan çıkarıldı çünkü bir rota
 * dosyası yalnızca HTTP işleyicilerini ve segment ayarlarını dışa aktarabilir;
 * bölüm yeniden üretimi aynı sağlayıcıları, aynı yeniden deneme kurallarını ve
 * aynı hata sınıflandırmasını kullanmak zorunda. İkinci bir kopya, tam olarak
 * plugin doğrulayıcısında yaşanan sapmayı yeniden üretirdi.
 */

const MAX_STRUCTURE_ATTEMPTS = 2;
export const MAX_NETWORK_ATTEMPTS = 2;
const MODEL_TIMEOUT_MS = 120_000;
export const HEARTBEAT_MS = 10_000;
const OPENROUTER_STRUCTURED_FALLBACK_MODEL = "google/gemini-3.7-flash";
/**
 * Yerel modeller bulut modellerinden yavaş: 8B'lik bir model tüketici bir
 * GPU'da uzun bir raporu dakikalar içinde yazıyor. Bulut için makul olan
 * 120 saniyelik sınır burada işi daha başlamadan keserdi.
 */
const LOCAL_MODEL_TIMEOUT_MS = 15 * 60 * 1000;
/** Akıl yürütme belirteçleri de aynı bütçeden düşüyor; bkz. `max_tokens`. */
const LOCAL_THINKING_BUDGET_FACTOR = 4;

/** Tek bir model isteğinin süre sınırı; "modeli dene" tahmini buna göre hüküm veriyor. */
export function requestTimeoutMs(providerId: ProviderId) {
  return getProvider(providerId)?.local ? LOCAL_MODEL_TIMEOUT_MS : MODEL_TIMEOUT_MS;
}

export type ProviderPreparationInput = {
  /** Yalnızca `needsDocument` için gerekli; bölüm yeniden üretimi PDF taşımaz. */
  file?: File;
  apiKey: string;
  provider: ProviderId;
  model: string;
  needsDocument: boolean;
  taskRole: GenerationTaskRole;
};

export type StructuredGeneration = {
  prompt: string;
  schema: z.ZodType;
  schemaName: string;
  maxOutputTokens: number;
  includeDocument: boolean;
  signal: AbortSignal;
  onChunk: (receivedCharacters: number, chunks: number) => void;
};

export type ProviderRuntime = {
  label: string;
  effectiveModel: string;
  generateStructured: (request: StructuredGeneration) => Promise<string>;
  cleanup: () => Promise<void>;
};

export type TaggedProviderError = Error & {
  providerId?: ProviderId;
  modelId?: string;
  taskRole?: GenerationTaskRole;
  errorType?: string;
  /**
   * "Bu model Trace görevleri için uygun değil" hatası. Bayrak olarak
   * taşınıyor çünkü eskiden mesaj metni eşleştiriliyordu ve metin İngilizce'ye
   * çevrildiği anda sınıflandırma sessizce bozuldu: kullanıcıya modelini
   * değiştirmesini söyleyen açıklama yerine genel bir upstream hatası
   * dönüyordu. Kullanıcıya görünen metin hiçbir zaman kontrol akışı taşımamalı.
   */
  incompatibleModel?: boolean;
  providerCode?: string;
  attemptedModel?: string;
};

export type ProgressWriter = (progress: GenerationProgress) => void;

/** Kullanıcıya olduğu gibi gösterilen, "başka model seç" diyen hata. */
function incompatibleModelError(message: string): TaggedProviderError {
  return Object.assign(new Error(message), { incompatibleModel: true });
}

export function parseJsonResponse(text: string | undefined, stage: string) {
  if (!text) throw new Error(`The ${stage} stage returned an empty response.`);
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return omitNullObjectFields(JSON.parse(cleaned));
  } catch {
    throw new Error(`The ${stage} stage did not return valid JSON.`);
  }
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Generation aborted", "AbortError");
}

export async function abortableDelay(ms: number, signal: AbortSignal) {
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

export function safeDiagnostic(error: unknown) {
  const value = error as TaggedProviderError & { name?: unknown; code?: unknown; cause?: { name?: unknown; code?: unknown } };
  return {
    name: error instanceof Error ? error.name : typeof error,
    status: errorStatus(error),
    code: typeof value?.code === "string" ? value.code : undefined,
    causeName: typeof value?.cause?.name === "string" ? value.cause.name : undefined,
    causeCode: typeof value?.cause?.code === "string" ? value.cause.code : undefined,
    provider: value?.providerId,
    model: value?.modelId,
    taskRole: value?.taskRole,
    errorType: value?.errorType,
    providerCode: value?.providerCode,
    attemptedModel: value?.attemptedModel,
  };
}

export function tagProviderError(error: unknown, assignment: ModelAssignment, taskRole: GenerationTaskRole) {
  if (error instanceof Error) {
    Object.assign(error, {
      providerId: assignment.provider,
      modelId: assignment.model,
      taskRole,
    });
  }
  return error;
}

export async function withTransientRetry<T>(
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

export async function generateValidated<T>({
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
    if (state === "FAILED") throw new Error("The model could not process the PDF.");
    if (attempt > 0 && attempt % 8 === 0) {
      progress({
        stage: "document",
        progress: Math.min(25, 18 + attempt / 5),
        title: "Preparing the PDF for the model.",
        detail: "Parsing the document pages and their visual layers.",
      });
    }
    await abortableDelay(1_000, signal);
  }
  throw new Error("Processing the PDF timed out.");
}

/**
 * OpenAI uyumlu SSE akışını toplar.
 *
 * Hem OpenRouter hem de yerel sunucular (Ollama, LM Studio, llama.cpp) aynı
 * biçimi konuşuyor, o yüzden tek toplayıcı ikisine de yetiyor; `label` yalnızca
 * hata mesajının hangi tarafı işaret ettiğini söylemek için var.
 */
async function collectOpenAiCompatibleStream(
  response: Response,
  onChunk: (receivedCharacters: number, chunks: number) => void,
  label = "OpenRouter",
) {
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: { code?: number; message?: string; metadata?: Record<string, unknown> } } | undefined;
    const error = new Error(payload?.error?.message ?? `The ${label} request failed with status ${response.status}.`);
    Object.assign(error, {
      status: payload?.error?.code ?? response.status,
      errorType: payload?.error?.metadata?.error_type,
      providerCode: payload?.error?.metadata?.provider_code,
    });
    throw error;
  }
  if (!response.body) throw new Error(`The ${label} response stream could not be opened.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let thinking = 0;
  let chunks = 0;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data) as {
        error?: { code?: number; message?: string; metadata?: Record<string, unknown> };
        choices?: Array<{
          delta?: {
            content?: string | Array<{ type?: string; text?: string }>;
            /** Ollama `reasoning`, kimi sunucular `reasoning_content` diyor. */
            reasoning?: string;
            reasoning_content?: string;
          };
        }>;
      };
      if (event.error) {
        const providerError = new Error(event.error.message ?? `${label} model error.`);
        Object.assign(providerError, {
          status: event.error.code,
          errorType: event.error.metadata?.error_type,
          providerCode: event.error.metadata?.provider_code,
        });
        throw providerError;
      }
      const content = event.choices?.[0]?.delta?.content;
      const delta = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => part.text ?? "").join("")
          : "";
      /**
       * Düşünen modeller cevaptan ÖNCE uzunca düşünüyor ve o metin ayrı bir
       * alanda geliyor. Ölçülen bir yerel çalıştırmada 13.400 karakter akıl
       * yürütme, 44 karakter cevap üretildi — üç dakika boyunca. Sayılmazsa
       * arayüz o üç dakika donmuş görünür ve canlılık göstergesi ölür.
       * Cevaba karışmıyor; yalnızca "hâlâ çalışıyor" demeye yarıyor.
       */
      const reasoning = event.choices?.[0]?.delta?.reasoning ?? event.choices?.[0]?.delta?.reasoning_content ?? "";
      if (typeof reasoning === "string" && reasoning) thinking += reasoning.length;
      if (!delta) {
        if (reasoning) {
          chunks += 1;
          onChunk(text.length + thinking, chunks);
        }
        continue;
      }
      text += delta;
      chunks += 1;
      onChunk(text.length + thinking, chunks);
    }
    if (done) break;
  }
  return text;
}

async function assertOpenRouterModelCompatible(
  apiKey: string,
  model: string,
  signal: AbortSignal,
) {
  if (model === "openrouter/auto") return { outputModalities: ["text"] };
  const response = await fetch(`https://openrouter.ai/api/v1/model/${model}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
    const error = new Error(payload?.error?.message ?? `OpenRouter model not found: ${model}`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  const payload = await response.json() as {
    data?: {
      architecture?: { output_modalities?: string[] };
      supported_parameters?: string[];
    };
  };
  const outputModalities = payload.data?.architecture?.output_modalities ?? [];
  const supportedParameters = payload.data?.supported_parameters ?? [];
  if (!outputModalities.includes("text")) {
    throw incompatibleModelError(
      `The OpenRouter model ${model} does not produce text/JSON output. Pick a model whose output modality is “text” for Trace tasks.`,
    );
  }
  if (!supportedParameters.includes("structured_outputs")) {
    throw incompatibleModelError(
      `The OpenRouter model ${model} does not support strict structured output. Pick another model from the compatible catalogue.`,
    );
  }
  return { outputModalities };
}

/**
 * Sunucu ayakta mı ve model yüklü mü.
 *
 * Yoklama, üretim başlamadan yapılıyor: aksi hâlde kullanıcı PDF'i yükleyip
 * kanıt aşamasını bekledikten SONRA "bağlantı reddedildi" görürdü. Hata
 * mesajı ne yapılacağını da söylüyor, çünkü buradaki en sık iki sorun
 * sunucunun kapalı olması ve modelin hiç indirilmemiş olması.
 */
async function assertLocalServerReachable(endpoint: string, model: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(localUrl(endpoint, "/models"), {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
  } catch {
    throw incompatibleModelError(
      `No local model server answered at ${endpoint}. Start one — \`ollama serve\`, or LM Studio's local server — or point Trace at the address it is listening on.`,
    );
  }
  if (!response.ok) {
    throw incompatibleModelError(`The local model server at ${endpoint} answered with ${response.status}.`);
  }
  const payload = await response.json().catch(() => undefined) as { data?: Array<{ id?: unknown }> } | undefined;
  const installed = (payload?.data ?? [])
    .map((item) => (typeof item.id === "string" ? item.id : ""))
    .filter(Boolean);
  // Liste boş dönebiliyor (bazı sunucular /models'i doldurmuyor); boş liste
  // "model yok" demek değil, o yüzden yalnızca dolu listede karar veriyoruz.
  if (installed.length && !installed.includes(model)) {
    throw incompatibleModelError(
      `The local server at ${endpoint} does not have "${model}". Installed: ${installed.slice(0, 8).join(", ")}${installed.length > 8 ? "…" : ""}. Pull it first, for example \`ollama pull ${model}\`.`,
    );
  }
}

function shouldUseOpenRouterFallback(error: unknown) {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return (status !== undefined && status >= 500) || /Provider returned error|upstream provider/i.test(message);
}

export async function prepareProviderRuntime(
  input: ProviderPreparationInput,
  signal: AbortSignal,
  progress: ProgressWriter,
  markProviderActivity: () => void,
): Promise<ProviderRuntime> {
  const requireFile = () => {
    if (!input.file) throw new Error("This stage needs the PDF, but none was supplied.");
    return input.file;
  };
  if (input.provider === "gemini") {
    const ai = new GoogleGenAI({
      apiKey: input.apiKey,
      httpOptions: {
        timeout: MODEL_TIMEOUT_MS,
        retryOptions: { attempts: 1 },
      },
    });
    let activeName: string | undefined;
    let activeFile: { uri: string; mimeType: string } | undefined;
    try {
      if (input.needsDocument) {
        const uploaded = await ai.files.upload({
          file: requireFile(),
          config: {
            mimeType: "application/pdf",
            displayName: requireFile().name,
            abortSignal: signal,
          },
        });
        markProviderActivity();
        if (!uploaded.name) throw new Error("The PDF upload id could not be obtained.");
        activeName = uploaded.name;
        progress({
          stage: "document",
          progress: 18,
          title: "PDF received; resolving its pages.",
          detail: `${requireFile().name} · ${(requireFile().size / 1024 / 1024).toFixed(1)} MB · Gemini`,
        });
        const readyFile = await waitUntilActive(ai, uploaded.name, signal, progress);
        markProviderActivity();
        if (!readyFile.uri || !readyFile.mimeType) throw new Error("The PDF model URI is missing.");
        activeFile = { uri: readyFile.uri, mimeType: readyFile.mimeType };
      }

      return {
        label: "Gemini",
        effectiveModel: input.model,
        generateStructured: ({
          prompt: requestPrompt,
          schema,
          maxOutputTokens,
          includeDocument,
          signal: requestSignal,
          onChunk,
        }) => {
          if (includeDocument && !activeFile) throw new Error("The Gemini PDF id could not be found.");
          return collectStructuredStream(
            () =>
              ai.models.generateContentStream({
                model: input.model,
                contents: includeDocument
                  ? [
                      {
                        role: "user",
                        parts: [
                          createPartFromUri(activeFile!.uri, activeFile!.mimeType),
                          { text: requestPrompt },
                        ],
                      },
                    ]
                  : requestPrompt,
                config: {
                  temperature: includeDocument ? 0.1 : 0.4,
                  maxOutputTokens,
                  responseMimeType: "application/json",
                  responseJsonSchema: z.toJSONSchema(schema),
                  abortSignal: requestSignal,
                },
              }),
            onChunk,
          );
        },
        cleanup: async () => {
          if (!activeName) return;
          const name = activeName;
          activeName = undefined;
          await ai.files.delete({ name }).catch(() => undefined);
        },
      };
    } catch (error) {
      if (activeName) await ai.files.delete({ name: activeName }).catch(() => undefined);
      throw error;
    }
  }

  if (input.provider === "anthropic") {
    const ai = new Anthropic({ apiKey: input.apiKey, maxRetries: 0, timeout: MODEL_TIMEOUT_MS });
    const documentData = input.needsDocument
      ? Buffer.from(await requireFile().arrayBuffer()).toString("base64")
      : undefined;
    if (input.needsDocument) {
      markProviderActivity();
      progress({
        stage: "document",
        progress: 22,
        title: "The PDF was split into visual and text layers for Claude.",
        detail: `${requireFile().name} · ${(requireFile().size / 1024 / 1024).toFixed(1)} MB · Messages API`,
      });
    }
    return {
      label: "Claude",
      effectiveModel: input.model,
      generateStructured: async ({
        prompt: requestPrompt,
        schema,
        maxOutputTokens,
        includeDocument,
        signal: requestSignal,
        onChunk,
      }) => {
        if (includeDocument && !documentData) throw new Error("The Claude PDF content could not be found.");
        const stream = ai.messages.stream({
          model: input.model,
          max_tokens: maxOutputTokens,
          temperature: includeDocument ? 0.1 : 0.4,
          messages: [{
            role: "user",
            content: includeDocument ? [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: documentData! },
                cache_control: { type: "ephemeral" },
              },
              { type: "text", text: requestPrompt },
            ] : requestPrompt,
          }],
          output_config: {
            format: zodOutputFormat(schema as z.ZodObject<z.ZodRawShape>),
          },
        }, { signal: requestSignal, timeout: MODEL_TIMEOUT_MS });
        let text = "";
        let chunks = 0;
        stream.on("text", (delta) => {
          text += delta;
          chunks += 1;
          onChunk(text.length, chunks);
        });
        const message = await stream.finalMessage();
        if (message.stop_reason !== "end_turn" && message.stop_reason !== "stop_sequence") {
          throw new Error(`The Claude response did not complete: ${message.stop_reason ?? "unknown"}.`);
        }
        return message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("") || text;
      },
      cleanup: async () => undefined,
    };
  }

  if (input.provider === "local") {
    /**
     * Yerel model sunucusu — Ollama, LM Studio, llama.cpp.
     *
     * Üçü de OpenAI uyumlu bir `/chat/completions` sunuyor, akış biçimi de
     * aynı; bu yüzden OpenRouter için yazılmış akış toplayıcı burada da
     * çalışıyor. Adres `resolveLocalEndpoint` ile zaten geri-döngüye
     * kısıtlanmış durumda.
     *
     * Belge YOK: yerel sunucularda dosya yükleme uçnoktası yok. Bu durum
     * isteğin başında reddediliyor; buraya bir belge isteği gelirse bu bir
     * program hatasıdır, sessizce belgesiz devam etmek değil.
     */
    const endpoint = input.apiKey;
    await assertLocalServerReachable(endpoint, input.model, signal);
    markProviderActivity();
    progress({
      stage: input.taskRole === "visual" ? "story" : "evidence",
      progress: input.taskRole === "visual" ? 76 : 62,
      title: "The local model is answering.",
      detail: `${input.model} · ${endpoint} · nothing leaves this machine`,
    });

    return {
      label: `Local · ${input.model}`,
      effectiveModel: input.model,
      generateStructured: async ({
        prompt: requestPrompt,
        schema,
        schemaName,
        maxOutputTokens,
        includeDocument,
        signal: requestSignal,
        onChunk,
      }) => {
        if (includeDocument) {
          throw new Error("A local model cannot be given the PDF; this stage should never have reached it.");
        }
        const response = await fetch(localUrl(endpoint, "/chat/completions"), {
          method: "POST",
          signal: AbortSignal.any([requestSignal, AbortSignal.timeout(LOCAL_MODEL_TIMEOUT_MS)]),
          headers: {
            "Content-Type": "application/json",
            // Ollama ve LM Studio anahtarı yok sayıyor; başlığın kendisini
            // arayan istemci kütüphaneleri olduğu için yine de gönderiliyor.
            Authorization: "Bearer local",
          },
          body: JSON.stringify({
            model: input.model,
            messages: [{ role: "user", content: requestPrompt }],
            temperature: 0.4,
            /**
             * Bulut için hesaplanmış bütçe burada yetmiyor. Yerel düşünen
             * modeller cevaba başlamadan önce bütçeyi tüketebiliyor: ölçülen
             * bir çalıştırmada 300 belirteçlik sınır, tek bir cevap karakteri
             * üretilmeden `finish_reason: "length"` ile bitti. Bütçe akıl
             * yürütmeye de yetecek kadar açılıyor.
             */
            max_tokens: Math.max(maxOutputTokens * LOCAL_THINKING_BUDGET_FACTOR, 8_192),
            stream: true,
            response_format: {
              type: "json_schema",
              json_schema: { name: schemaName, strict: true, schema: openAiJsonSchema(schema) },
            },
          }),
        });
        return collectOpenAiCompatibleStream(response, onChunk, "The local model");
      },
      cleanup: async () => undefined,
    };
  }

  if (input.provider === "openrouter") {
    const capabilities = await assertOpenRouterModelCompatible(input.apiKey, input.model, signal);
    const imageOutputModel = capabilities.outputModalities.includes("image");
    const effectiveModel = imageOutputModel ? OPENROUTER_STRUCTURED_FALLBACK_MODEL : input.model;
    if (imageOutputModel) {
      await assertOpenRouterModelCompatible(input.apiKey, effectiveModel, signal);
      progress({
        stage: input.taskRole === "visual" ? "story" : "document",
        progress: input.taskRole === "visual" ? 78 : 12,
        title: "Redirected to an OpenRouter structured model.",
        detail: `${input.model} is an image-output model; the Trace canvas JSON will be produced with ${effectiveModel}.`,
      });
    }
    const documentData = input.needsDocument
      ? Buffer.from(await requireFile().arrayBuffer()).toString("base64")
      : undefined;
    if (input.needsDocument) {
      markProviderActivity();
      progress({
        stage: "document",
        progress: 22,
        title: "The PDF is ready for the OpenRouter request.",
        detail: `${requireFile().name} · ${(requireFile().size / 1024 / 1024).toFixed(1)} MB · ${input.model}`,
      });
    }
    return {
      label: imageOutputModel ? `OpenRouter · ${effectiveModel}` : "OpenRouter",
      effectiveModel,
      generateStructured: async ({
        prompt: requestPrompt,
        schema,
        schemaName,
        maxOutputTokens,
        includeDocument,
        signal: requestSignal,
        onChunk,
      }) => {
        if (includeDocument && !documentData) throw new Error("The OpenRouter PDF content could not be found.");
        const timeoutSignal = AbortSignal.timeout(MODEL_TIMEOUT_MS);
        const combinedSignal = AbortSignal.any([requestSignal, timeoutSignal]);
        const requestModel = async (model: string) => {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            signal: combinedSignal,
            headers: {
              Authorization: `Bearer ${input.apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://github.com/Ahmet-Ruchan/trace-research-paper-studio",
              "X-Title": "Trace Research Studio",
            },
            body: JSON.stringify({
            model,
            modalities: ["text"],
            messages: [{
              role: "user",
              content: includeDocument ? [
                { type: "file", file: { filename: requireFile().name, file_data: `data:application/pdf;base64,${documentData!}` } },
                { type: "text", text: requestPrompt },
              ] : requestPrompt,
            }],
            temperature: includeDocument ? 0.1 : 0.4,
            max_tokens: maxOutputTokens,
            stream: true,
            response_format: {
              type: "json_schema",
              json_schema: { name: schemaName, strict: true, schema: openAiJsonSchema(schema) },
            },
            provider: { require_parameters: true, allow_fallbacks: true },
            ...(includeDocument ? { plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }] } : {}),
            }),
          });
          try {
            return await collectOpenAiCompatibleStream(response, onChunk);
          } catch (error) {
            if (error instanceof Error) Object.assign(error, { attemptedModel: model });
            throw error;
          }
        };
        try {
          return await requestModel(effectiveModel);
        } catch (error) {
          if (effectiveModel === OPENROUTER_STRUCTURED_FALLBACK_MODEL || !shouldUseOpenRouterFallback(error)) {
            throw error;
          }
          markProviderActivity();
          progress({
            stage: input.taskRole === "visual" ? "story" : "evidence",
            progress: input.taskRole === "visual" ? 80 : 36,
            title: "Redirecting the OpenRouter endpoint.",
            detail: `${effectiveModel} returned an upstream error; retrying safely with ${OPENROUTER_STRUCTURED_FALLBACK_MODEL}.`,
          });
          await assertOpenRouterModelCompatible(input.apiKey, OPENROUTER_STRUCTURED_FALLBACK_MODEL, requestSignal);
          return requestModel(OPENROUTER_STRUCTURED_FALLBACK_MODEL);
        }
      },
      cleanup: async () => undefined,
    };
  }

  const ai = new OpenAI({
    apiKey: input.apiKey,
    maxRetries: 0,
    timeout: MODEL_TIMEOUT_MS,
  });
  let activeFileId: string | undefined;
  if (input.needsDocument) {
    const uploaded = await ai.files.create(
      {
        file: requireFile(),
        purpose: "user_data",
        expires_after: { anchor: "created_at", seconds: 3_600 },
      },
      { signal, timeout: MODEL_TIMEOUT_MS },
    );
    activeFileId = uploaded.id;
    markProviderActivity();
    progress({
      stage: "document",
      progress: 22,
      title: "The PDF was taken into the OpenAI workspace.",
      detail: `${requireFile().name} · ${(requireFile().size / 1024 / 1024).toFixed(1)} MB · Responses API`,
    });
  }
  return {
    label: "OpenAI",
    effectiveModel: input.model,
    generateStructured: async ({
      prompt: requestPrompt,
      schema,
      schemaName,
      maxOutputTokens,
      includeDocument,
      signal: requestSignal,
      onChunk,
    }) => {
      if (includeDocument && !activeFileId) throw new Error("The OpenAI PDF id could not be found.");
      const stream = ai.responses.stream(
        {
          model: input.model,
          input: includeDocument
            ? [
                {
                  role: "user",
                  content: [
                    { type: "input_file", file_id: activeFileId!, detail: "auto" },
                    { type: "input_text", text: requestPrompt },
                  ],
                },
              ]
            : requestPrompt,
          max_output_tokens: maxOutputTokens,
          reasoning: { effort: includeDocument ? "low" : "medium" },
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: schemaName,
              strict: true,
              schema: openAiJsonSchema(schema),
            },
          },
          store: false,
        },
        { signal: requestSignal, timeout: MODEL_TIMEOUT_MS },
      );

      let text = "";
      let chunks = 0;
      for await (const event of stream) {
        if (event.type !== "response.output_text.delta") continue;
        text += event.delta;
        chunks += 1;
        onChunk(text.length, chunks);
      }
      const response = await stream.finalResponse();
      if (response.status !== "completed") {
        throw new Error(
          response.error?.message ??
            response.incomplete_details?.reason ??
            "The OpenAI response did not complete.",
        );
      }
      return response.output_text || text;
    },
    cleanup: async () => {
      if (!activeFileId) return;
      const fileId = activeFileId;
      activeFileId = undefined;
      await ai.files.delete(fileId).catch(() => undefined);
    },
  };
}

export function publicError(error: unknown, callerAborted: boolean, fallbackProvider: ProviderId) {
  if (callerAborted) return "Generation cancelled.";
  const message = error instanceof Error ? error.message : String(error);
  const tagged = error as TaggedProviderError;
  const provider = tagged.providerId ?? fallbackProvider;
  const providerLabel = getProvider(provider)?.label ?? "Model provider";
  const modelLabel = tagged.modelId ? ` (${tagged.modelId})` : "";
  const taskLabel = tagged.taskRole ? ` · ${tagged.taskRole} task` : "";
  if (tagged.incompatibleModel) {
    return message;
  }
  /**
   * `AbortSignal.timeout` bir `TimeoutError` fırlatıyor, `AbortError` değil.
   * Yakalanmazsa kullanıcı "The operation was aborted due to timeout" gibi ne
   * olduğunu da ne yapacağını da söylemeyen ham bir metin görüyordu. Yerel
   * modelin sınırı ayrı (15 dakika), dolayısıyla süre sağlayıcıya göre.
   */
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    const limit = getProvider(provider)?.local ? "15 minutes" : "120 seconds";
    const advice = getProvider(provider)?.local
      ? " A smaller or non-thinking local model, or a cloud provider, will finish sooner."
      : "";
    return `${providerLabel}${modelLabel}${taskLabel} did not finish within ${limit}. Completed stages were kept; you can try again.${advice}`;
  }
  if (/API_KEY_INVALID|API key not valid|invalid api key|incorrect api key|authentication|permission_denied|401/i.test(message)) {
    return `The ${providerLabel} API key is invalid, or not authorised for this model.`;
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(message)) {
    return `The ${providerLabel} quota is exhausted, or its rate limit was reached. Completed stages were kept.`;
  }
  if (/insufficient credits|402/i.test(message)) {
    return `The ${providerLabel} account does not have enough credit for this request.${modelLabel}`;
  }
  if (/NOT_FOUND|model.*not found|404/i.test(message)) {
    return `The selected ${providerLabel} model is not available to this API key. Pick another model and try again.`;
  }
  if (/UNAVAILABLE|503|504|fetch failed|ECONNRESET|ETIMEDOUT|terminated/i.test(message)) {
    return `${providerLabel} cannot be reached right now. Completed stages were kept; you can try again.`;
  }
  if (/Provider returned error/i.test(message)) {
    const diagnostic = [tagged.errorType, tagged.providerCode].filter(Boolean).join(" / ");
    const attempted = tagged.attemptedModel && tagged.attemptedModel !== tagged.modelId
      ? ` The compatible fallback ${tagged.attemptedModel} failed as well.`
      : "";
    return `${providerLabel}${modelLabel}${taskLabel} failed at the upstream provider${diagnostic ? ` (${diagnostic})` : ""}.${attempted} Pick another text-only output + structured-output model from the compatible catalogue.`;
  }
  if (error instanceof z.ZodError || error instanceof Error && error.name === "IntegrityError") {
    return "The model output failed the evidence schema on both attempts. No invented data was published; completed stages were kept.";
  }
  return message || "Something went wrong while processing the paper.";
}