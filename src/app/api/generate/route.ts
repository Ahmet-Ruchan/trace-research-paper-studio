import { createHash } from "node:crypto";
import { GoogleGenAI, createPartFromUri } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";
import { preferredLanguage } from "@/lib/preferred-language";
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
  validateDeepReportIntegrity,
  validateEvidenceIntegrity,
  validateStoryIntegrity,
  validateTechnicalAppendixIntegrity,
} from "@/lib/generation-validation";
import { buildDeepReportPrompt, buildEvidencePassPrompt, buildStoryPrompt, buildTechnicalAppendixPrompt } from "@/lib/prompts";
import {
  getProvider,
  getProviderForModel,
  generationTaskRoles,
  resolveProviderModel,
  type GenerationTaskRole,
  type ModelAssignment,
  type ModelTeam,
  type ProviderId,
} from "@/lib/model-providers";
import { omitNullObjectFields, openAiJsonSchema } from "@/lib/openai-structured";
import {
  researchProjectSchema,
  deepReportSchema,
  storySpecSchema,
  technicalAppendixSchema,
  type DeepReport,
  type Source,
  type StorySpec,
  type TechnicalAppendix,
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
const OPENROUTER_STRUCTURED_FALLBACK_MODEL = "google/gemini-3.7-flash";

type GenerationInput = {
  file: File;
  apiKeys: Partial<Record<ProviderId, string>>;
  assignments: ModelTeam;
  urls: string[];
  language: string;
  audience: "general" | "student" | "expert";
  depth: "concise" | "standard" | "deep";
  provider: ProviderId;
  model: string;
  checkpoint?: unknown;
};

type ProviderPreparationInput = {
  file: File;
  apiKey: string;
  provider: ProviderId;
  model: string;
  needsDocument: boolean;
  taskRole: GenerationTaskRole;
};

type StructuredGeneration = {
  prompt: string;
  schema: z.ZodType;
  schemaName: string;
  maxOutputTokens: number;
  includeDocument: boolean;
  signal: AbortSignal;
  onChunk: (receivedCharacters: number, chunks: number) => void;
};

type ProviderRuntime = {
  label: string;
  effectiveModel: string;
  generateStructured: (request: StructuredGeneration) => Promise<string>;
  cleanup: () => Promise<void>;
};

type TaggedProviderError = Error & {
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

type StreamWriter = (event: GenerationStreamEvent) => void;
type ProgressWriter = (progress: GenerationProgress) => void;

/** Kullanıcıya olduğu gibi gösterilen, "başka model seç" diyen hata. */
function incompatibleModelError(message: string): TaggedProviderError {
  return Object.assign(new Error(message), { incompatibleModel: true });
}

function jsonError(message: string, status: number, detail?: unknown) {
  return Response.json({ error: message, detail }, { status });
}

function parseJsonResponse(text: string | undefined, stage: string) {
  if (!text) throw new Error(`The ${stage} stage returned an empty response.`);
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return omitNullObjectFields(JSON.parse(cleaned));
  } catch {
    throw new Error(`The ${stage} stage did not return valid JSON.`);
  }
}

function expectedSections(depth: GenerationInput["depth"]) {
  return depth === "concise" ? 5 : depth === "deep" ? 8 : 6;
}

function expectedReportSections(depth: GenerationInput["depth"]) {
  return depth === "concise" ? 6 : depth === "deep" ? 9 : 7;
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

function tagProviderError(error: unknown, assignment: ModelAssignment, taskRole: GenerationTaskRole) {
  if (error instanceof Error) {
    Object.assign(error, {
      providerId: assignment.provider,
      modelId: assignment.model,
      taskRole,
    });
  }
  return error;
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

async function collectOpenRouterStream(
  response: Response,
  onChunk: (receivedCharacters: number, chunks: number) => void,
) {
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: { code?: number; message?: string; metadata?: Record<string, unknown> } } | undefined;
    const error = new Error(payload?.error?.message ?? `The OpenRouter request failed with status ${response.status}.`);
    Object.assign(error, {
      status: payload?.error?.code ?? response.status,
      errorType: payload?.error?.metadata?.error_type,
      providerCode: payload?.error?.metadata?.provider_code,
    });
    throw error;
  }
  if (!response.body) throw new Error("The OpenRouter response stream could not be opened.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
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
        choices?: Array<{ delta?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      };
      if (event.error) {
        const providerError = new Error(event.error.message ?? "OpenRouter model error.");
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
      if (!delta) continue;
      text += delta;
      chunks += 1;
      onChunk(text.length, chunks);
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

function shouldUseOpenRouterFallback(error: unknown) {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return (status !== undefined && status >= 500) || /Provider returned error|upstream provider/i.test(message);
}

async function prepareProviderRuntime(
  input: ProviderPreparationInput,
  signal: AbortSignal,
  progress: ProgressWriter,
  markProviderActivity: () => void,
): Promise<ProviderRuntime> {
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
          file: input.file,
          config: {
            mimeType: "application/pdf",
            displayName: input.file.name,
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
          detail: `${input.file.name} · ${(input.file.size / 1024 / 1024).toFixed(1)} MB · Gemini`,
        });
        const readyFile = await waitUntilActive(ai, uploaded.name, signal, progress);
        markProviderActivity();
        if (!readyFile.uri || !readyFile.mimeType) throw new Error("PDF model URI bilgisi eksik.");
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
      ? Buffer.from(await input.file.arrayBuffer()).toString("base64")
      : undefined;
    if (input.needsDocument) {
      markProviderActivity();
      progress({
        stage: "document",
        progress: 22,
        title: "The PDF was split into visual and text layers for Claude.",
        detail: `${input.file.name} · ${(input.file.size / 1024 / 1024).toFixed(1)} MB · Messages API`,
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
      ? Buffer.from(await input.file.arrayBuffer()).toString("base64")
      : undefined;
    if (input.needsDocument) {
      markProviderActivity();
      progress({
        stage: "document",
        progress: 22,
        title: "The PDF is ready for the OpenRouter request.",
        detail: `${input.file.name} · ${(input.file.size / 1024 / 1024).toFixed(1)} MB · ${input.model}`,
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
                { type: "file", file: { filename: input.file.name, file_data: `data:application/pdf;base64,${documentData!}` } },
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
            return await collectOpenRouterStream(response, onChunk);
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
        file: input.file,
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
      detail: `${input.file.name} · ${(input.file.size / 1024 / 1024).toFixed(1)} MB · Responses API`,
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
        `${urls[index]}: ${result.reason instanceof Error ? result.reason.message : "could not be read"}`,
      );
    }
  });
  return { sources, warnings };
}

function parseInput(form: FormData): GenerationInput {
  const file = form.get("paper");
  // Eksik alan sessizce Türkçe'ye düşmemeli — bkz. `preferred-language.ts`.
  const language = preferredLanguage(String(form.get("language") ?? ""));
  const audienceValue = String(form.get("audience") ?? "student");
  const audience = ["general", "student", "expert"].includes(audienceValue)
    ? (audienceValue as GenerationInput["audience"])
    : "student";
  const depthValue = String(form.get("depth") ?? "standard");
  const depth = ["concise", "standard", "deep"].includes(depthValue)
    ? (depthValue as GenerationInput["depth"])
    : "standard";
  const requestedModel = String(form.get("model") ?? "gemini-3.7-flash");
  const inferredProvider = getProviderForModel(requestedModel)?.id ?? "gemini";
  const requestedProvider = String(form.get("provider") ?? inferredProvider);
  const fallbackSelection = resolveProviderModel(requestedProvider, requestedModel);
  if (!fallbackSelection) throw new InputError("The model and provider selection is not valid.", 400);

  let assignments: ModelTeam;
  const rawAssignments = String(form.get("assignments") ?? "");
  try {
    const parsed = rawAssignments ? JSON.parse(rawAssignments) as Record<string, unknown> : undefined;
    assignments = Object.fromEntries(generationTaskRoles.map((role) => {
      const candidate = parsed?.[role] as { provider?: unknown; model?: unknown } | undefined;
      const selection = candidate
        ? resolveProviderModel(String(candidate.provider ?? ""), String(candidate.model ?? ""))
        : fallbackSelection;
      if (!selection) throw new Error(`invalid ${role}`);
      return [role, selection];
    })) as ModelTeam;
  } catch {
    throw new InputError("The per-task model assignment is not valid.", 400);
  }
  const { provider, model } = assignments.evidence;

  const apiKeys: Partial<Record<ProviderId, string>> = {};
  try {
    const raw = String(form.get("apiKeys") ?? "");
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    for (const assignment of Object.values(assignments)) {
      if (apiKeys[assignment.provider]) continue;
      const value = String(parsed[assignment.provider] ?? "").trim();
      if (value) apiKeys[assignment.provider] = value;
    }
    const legacyKey = String(form.get("apiKey") ?? "").trim();
    if (legacyKey && !apiKeys[provider]) apiKeys[provider] = legacyKey;
  } catch {
    throw new InputError("The provider API key assignment is not valid.", 400);
  }

  if (!(file instanceof File)) throw new InputError("You must upload a PDF file.", 400);
  if (file.type !== "application/pdf") {
    throw new InputError("Only PDF files are supported.", 415);
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new InputError("The PDF exceeds the 35 MB limit.", 413);
  }
  const documentAssignments = [assignments.evidence, assignments.technical];
  if (documentAssignments.some((assignment) => assignment.provider === "anthropic") && file.size > 24 * 1024 * 1024) {
    throw new InputError("The PDF limit for Claude is 24 MB; base64 encoding would push the request past its total limit.", 413);
  }
  const missingProvider = Object.values(assignments)
    .map((assignment) => assignment.provider)
    .find((providerId) => !apiKeys[providerId]);
  if (missingProvider) throw new InputError(`${getProvider(missingProvider)!.keyLabel} gerekli.`, 401);

  let urls: string[] = [];
  try {
    const rawUrls = JSON.parse(String(form.get("sources") ?? "[]"));
    if (!Array.isArray(rawUrls)) throw new Error("array expected");
    urls = rawUrls.filter((item): item is string => typeof item === "string").slice(0, 3);
  } catch {
    throw new InputError("The list of source URLs is not valid.", 400);
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

  return { file, apiKeys, assignments, urls, language, audience, depth, provider, model, checkpoint };
}

class InputError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function publicError(error: unknown, callerAborted: boolean, fallbackProvider: ProviderId) {
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
  if (error instanceof Error && error.name === "AbortError") {
    return `${providerLabel}${modelLabel}${taskLabel} did not finish within 120 seconds. Completed stages were kept; you can try again.`;
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

async function inputFingerprint(input: GenerationInput) {
  const fileHash = createHash("sha256")
    .update(Buffer.from(await input.file.arrayBuffer()))
    .digest("hex");
  const technical = input.assignments.technical;
  const evidence = input.assignments.evidence;
  return createHash("sha256")
    .update(fileHash)
    .update(JSON.stringify({
      urls: input.urls,
      language: input.language,
      audience: input.audience,
      depth: input.depth,
      provider: input.provider,
      model: input.model,
      ...(technical.provider !== evidence.provider || technical.model !== evidence.model
        ? { technical }
        : {}),
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
  const runtimePromises = new Map<string, Promise<ProviderRuntime>>();
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
  const getRuntime = (
    taskRole: GenerationTaskRole,
    needsDocument = taskRole === "evidence" || taskRole === "technical",
  ) => {
    const assignment = input.assignments[taskRole];
    const runtimeKey = `${assignment.provider}:${assignment.model}`;
    const existing = runtimePromises.get(runtimeKey);
    if (existing) return existing;
    const apiKey = input.apiKeys[assignment.provider];
    if (!apiKey) throw new InputError(`${getProvider(assignment.provider)!.keyLabel} gerekli.`, 401);
    const runtime = prepareProviderRuntime(
      {
        file: input.file,
        apiKey,
        ...assignment,
        needsDocument,
        taskRole,
      },
      signal,
      progress,
      markProviderActivity,
    ).catch((error) => {
      throw tagProviderError(error, assignment, taskRole);
    });
    runtimePromises.set(runtimeKey, runtime);
    return runtime;
  };
  const cleanupRuntimes = async () => {
    const settled = await Promise.allSettled([...runtimePromises.values()]);
    await Promise.allSettled(settled
      .filter((result): result is PromiseFulfilledResult<ProviderRuntime> => result.status === "fulfilled")
      .map((result) => result.value.cleanup()));
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
      title: "Preparing the sources in a sandbox.",
      detail: input.urls.length
        ? `Checking the PDF along with ${input.urls.length} supporting source(s).`
        : "The PDF passed file validation before analysis.",
    });

    const webResultPromise = loadWebSources(input.urls);
    const fingerprintPromise = inputFingerprint(input);
    const [webResult, fingerprint] = await Promise.all([webResultPromise, fingerprintPromise]);

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
        title: "Resuming from the saved evidence stages.",
        detail: `${completed}/4 stages will be reused; only the missing ones are generated.`,
      });
      emit({ type: "checkpoint", checkpoint, completed: completedPasses(checkpoint) });
    } else {
      progress({
        stage: "evidence",
        progress: 27,
        title: "Splitting the paper into four evidence layers.",
        detail: "At most two small model tasks run at a time.",
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
      const taskRole: GenerationTaskRole = passId === "methods" || passId === "results"
        ? "technical"
        : "evidence";
      const assignment = input.assignments[taskRole];
      const providerRuntime = await getRuntime(taskRole);
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
        title: `Extracting ${evidencePassLabels[passId]}.`,
        detail: `${completed}/4 stages complete · waiting for the structured stream`,
      });

      try {
        const output = await generateValidated<EvidencePassOutputs[Key]>({
          stage: evidencePassLabels[passId],
          schema,
          signal,
          request: async (feedback) =>
            providerRuntime.generateStructured({
              prompt: feedback ? `${prompt}\n\nVALIDATION FEEDBACK:\n${feedback}` : prompt,
              schema,
              schemaName: `trace_evidence_${passId}`,
              maxOutputTokens: tokenLimits[passId],
              includeDocument: true,
              signal,
              onChunk: (characters) => {
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
                  detail: `${characters.toLocaleString("en")} characters received · ${completed}/4 stages complete`,
                });
              },
            }),
          validate: (value) => validateEvidencePass(passId, value, sourceIds),
          onStructureRetry: (attempt, issues) =>
            progress({
              stage: "evidence",
              progress: evidenceHighWater,
              title: `${evidencePassLabels[passId]} yeniden denetleniyor.`,
              detail: `Clearing ${issues.length} inconsistencies · structure attempt ${attempt}/2`,
              attempt,
            }),
          onNetworkRetry: (attempt) =>
            progress({
              stage: "evidence",
              progress: evidenceHighWater,
              title: `Reconnecting for ${evidencePassLabels[passId]}.`,
              detail: `Transient model error · network attempt ${attempt}/${MAX_NETWORK_ATTEMPTS}`,
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
          title: `${evidencePassLabels[passId]} validated.`,
          detail: `${completed}/4 evidence stages complete and written to the checkpoint.`,
        });
        console.info("Trace generation stage", {
          stage: `evidence:${passId}`,
          durationMs: Date.now() - stageStartedAt,
          provider: assignment.provider,
          model: assignment.model,
          status: "completed",
        });
      } catch (error) {
        console.error("Trace generation stage", {
          stage: `evidence:${passId}`,
          durationMs: Date.now() - stageStartedAt,
          fallbackProvider: assignment.provider,
          fallbackModel: assignment.model,
          outcome: "failed",
          ...safeDiagnostic(error),
        });
        throw tagProviderError(error, assignment, taskRole);
      }
    }

    const missingPasses = evidencePassIds.filter((passId) => !checkpoint.parts[passId]);
    await runWithConcurrency(missingPasses, EVIDENCE_CONCURRENCY, runEvidencePass);

    const overview = checkpoint.parts.overview;
    if (!overview) throw new Error("The paper overview checkpoint could not be found.");
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
      title: "The four evidence layers were merged.",
      detail: `${evidence.claims.length} claims · ${evidence.metrics.length} metrics · ${evidence.limitations.length} limitations`,
    });

    const storyPrompt = buildStoryPrompt(evidence, {
      language: input.language,
      audience: input.audience,
      depth: input.depth,
    });
    const deepReportPrompt = buildDeepReportPrompt(evidence, {
      language: input.language,
      audience: input.audience,
      depth: input.depth,
    });
    const technicalAppendixPrompt = buildTechnicalAppendixPrompt(evidence, {
      language: input.language,
      audience: input.audience,
      depth: input.depth,
    });
    let storyHighWater = 69;
    let lastStoryNotice = 0;
    let reportHighWater = 69;
    let lastReportNotice = 0;
    let lastTechnicalNotice = 0;
    const storyStartedAt = Date.now();
    progress({
      stage: "story",
      progress: storyHighWater,
      title: "Designing the visual narrative and the deep report.",
      detail: "Different models run in parallel; tasks sharing one model run in a controlled sequence.",
    });
    const [visualRuntime, reportRuntime, technicalRuntime] = await Promise.all([
      getRuntime("visual"),
      getRuntime("report"),
      getRuntime("technical", false),
    ]);
    const generateStory = () => generateValidated<StorySpec>({
      stage: "Story planning",
      schema: storySpecSchema,
      signal,
      request: async (feedback) =>
        visualRuntime.generateStructured({
          prompt: feedback
            ? `${storyPrompt}\n\nVALIDATION FEEDBACK:\n${feedback}`
            : storyPrompt,
          schema: storySpecSchema,
          schemaName: "trace_story_spec",
          maxOutputTokens: 16_384,
          includeDocument: false,
          signal,
          onChunk: (characters) => {
            markProviderActivity();
            const now = Date.now();
            if (now - lastStoryNotice < 900) return;
            lastStoryNotice = now;
            storyHighWater = Math.max(storyHighWater, 69 + Math.min(17, characters / 600));
            progress({
              stage: "story",
              progress: storyHighWater,
              title: "StorySpec stream ediliyor.",
              detail: `Received ${characters.toLocaleString("en")} characters of validated narrative.`,
            });
          },
        }),
      validate: (value) =>
        validateStoryIntegrity(value, evidence, expectedSections(input.depth)),
      onStructureRetry: (attempt, issues) =>
        progress({
          stage: "story",
          progress: storyHighWater,
          title: "Relinking the story.",
          detail: `Clearing ${issues.length} narrative inconsistencies · structure attempt ${attempt}/2`,
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "story",
          progress: storyHighWater,
          title: "Reconnecting for the story.",
          detail: `Transient model error · network attempt ${attempt}/${MAX_NETWORK_ATTEMPTS}`,
          attempt,
        }),
    }).catch((error) => {
      throw tagProviderError(error, input.assignments.visual, "visual");
    });
    const generateReport = () => generateValidated<DeepReport>({
      stage: "Deep report",
      schema: deepReportSchema,
      signal,
      request: async (feedback) =>
        reportRuntime.generateStructured({
          prompt: feedback
            ? `${deepReportPrompt}\n\nVALIDATION FEEDBACK:\n${feedback}`
            : deepReportPrompt,
          schema: deepReportSchema,
          schemaName: "trace_deep_report",
          maxOutputTokens: 18_432,
          includeDocument: false,
          signal,
          onChunk: (characters) => {
            markProviderActivity();
            const now = Date.now();
            if (now - lastReportNotice < 900) return;
            lastReportNotice = now;
            reportHighWater = Math.max(reportHighWater, 69 + Math.min(17, characters / 700));
            progress({
              stage: "story",
              progress: Math.min(storyHighWater, reportHighWater),
              title: "Streaming the deep report.",
              detail: `Received ${characters.toLocaleString("en")} characters of analytical report.`,
            });
          },
        }),
      validate: (value) =>
        validateDeepReportIntegrity(value, evidence, expectedReportSections(input.depth)),
      onStructureRetry: (attempt, issues) =>
        progress({
          stage: "story",
          progress: Math.min(storyHighWater, reportHighWater),
          title: "Relinking the report.",
          detail: `Clearing ${issues.length} report inconsistencies · structure attempt ${attempt}/2`,
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "story",
          progress: Math.min(storyHighWater, reportHighWater),
          title: "Reconnecting for the report.",
          detail: `Transient model error · network attempt ${attempt}/${MAX_NETWORK_ATTEMPTS}`,
          attempt,
        }),
    }).catch((error) => {
      throw tagProviderError(error, input.assignments.report, "report");
    });
    const generateTechnical = () => generateValidated<TechnicalAppendix>({
      stage: "Technical appendix",
      schema: technicalAppendixSchema,
      signal,
      request: async (feedback) =>
        technicalRuntime.generateStructured({
          prompt: feedback
            ? `${technicalAppendixPrompt}\n\nVALIDATION FEEDBACK:\n${feedback}`
            : technicalAppendixPrompt,
          schema: technicalAppendixSchema,
          schemaName: "trace_technical_appendix",
          maxOutputTokens: 16_384,
          includeDocument: false,
          signal,
          onChunk: (characters) => {
            markProviderActivity();
            const now = Date.now();
            if (now - lastTechnicalNotice < 900) return;
            lastTechnicalNotice = now;
            progress({
              stage: "story",
              progress: Math.min(storyHighWater, reportHighWater),
              title: "Preparing the technical appendix.",
              detail: `Received ${characters.toLocaleString("en")} characters of equation, algorithm and code analysis.`,
            });
          },
        }),
      validate: (value) => validateTechnicalAppendixIntegrity(value, evidence),
      onStructureRetry: (attempt, issues) => progress({
        stage: "story",
        progress: Math.min(storyHighWater, reportHighWater),
        title: "Relinking the technical appendix.",
        detail: `Clearing ${issues.length} technical inconsistencies · structure attempt ${attempt}/2`,
        attempt,
      }),
      onNetworkRetry: (attempt) => progress({
        stage: "story",
        progress: Math.min(storyHighWater, reportHighWater),
        title: "Reconnecting for the technical appendix.",
        detail: `Transient model error · network attempt ${attempt}/${MAX_NETWORK_ATTEMPTS}`,
        attempt,
      }),
    }).catch((error) => {
      throw tagProviderError(error, input.assignments.technical, "technical");
    });
    let story: StorySpec | undefined;
    let deepReport: DeepReport | undefined;
    let technicalAppendix: TechnicalAppendix | undefined;
    const groupedTasks = new Map<ProviderRuntime, Array<() => Promise<void>>>();
    const addPostTask = (runtime: ProviderRuntime, task: () => Promise<void>) => {
      groupedTasks.set(runtime, [...(groupedTasks.get(runtime) ?? []), task]);
    };
    addPostTask(visualRuntime, async () => { story = await generateStory(); });
    addPostTask(reportRuntime, async () => { deepReport = await generateReport(); });
    addPostTask(technicalRuntime, async () => { technicalAppendix = await generateTechnical(); });
    await Promise.all([...groupedTasks.values()].map(async (tasks) => {
      for (const task of tasks) await task();
    }));
    if (!story || !deepReport || !technicalAppendix) {
      throw new Error("The model team did not produce every required output.");
    }
    console.info("Trace generation stage", {
      stage: "story",
      durationMs: Date.now() - storyStartedAt,
      models: {
        visual: input.assignments.visual.model,
        report: input.assignments.report.model,
      },
      status: "completed",
    });

    progress({
      stage: "finalize",
      progress: 91,
      title: "Running the final integrity check.",
      detail: "Claims, pages, metrics and visual links are checked together.",
    });
    validateEvidenceIntegrity(evidence);
    validateStoryIntegrity(story, evidence, expectedSections(input.depth));
    validateDeepReportIntegrity(deepReport, evidence, expectedReportSections(input.depth));
    validateTechnicalAppendixIntegrity(technicalAppendix, evidence);

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
      deepReport,
      technicalAppendix,
      generation: {
        provider: input.provider,
        model: input.model,
        assignments: {
          ...input.assignments,
          visual: { ...input.assignments.visual, model: visualRuntime.effectiveModel },
          report: { ...input.assignments.report, model: reportRuntime.effectiveModel },
          technical: { ...input.assignments.technical, model: technicalRuntime.effectiveModel },
        },
      },
    });

    progress({
      stage: "finalize",
      progress: 97,
      title: "Cleaning up temporary files.",
      detail: `Cleaning up ${runtimePromises.size} model workspace(s); no API key is retained.`,
    });
    await cleanupRuntimes();

    emit({ type: "result", project, warnings });
  } finally {
    clearInterval(heartbeat);
    await cleanupRuntimes();
  }
}

export async function POST(request: Request) {
  let input: GenerationInput;
  try {
    input = parseInput(await request.formData());
  } catch (error) {
    if (error instanceof InputError) return jsonError(error.message, error.status);
    return jsonError("The submitted form data could not be read.", 400);
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
        const message = publicError(error, request.signal.aborted, input.provider);
        console.error("Trace generation pipeline failed", {
          fallbackProvider: input.provider,
          fallbackModel: input.model,
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
