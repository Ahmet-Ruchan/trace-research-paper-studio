import { z } from "zod";
import type { GenerationProgress, GenerationStreamEvent } from "@/lib/generation-events";
import { IntegrityError } from "@/lib/generation-validation";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
import { getProvider, resolveProviderModel, type GenerationTaskRole } from "@/lib/model-providers";
import { researchProjectSchema } from "@/lib/schema";
import {
  MAX_REGENERATION_INSTRUCTION,
  buildSectionRegenerationPrompt,
  claimPolicySchema,
  evidenceFingerprint,
  findSection,
  sectionSchemaFor,
  sectionTargetSchema,
  spliceSection,
  type RegeneratedSection,
} from "@/lib/section-regeneration";
import {
  HEARTBEAT_MS,
  MAX_NETWORK_ATTEMPTS,
  generateValidated,
  prepareProviderRuntime,
  publicError,
  safeDiagnostic,
  tagProviderError,
  type ProgressWriter,
  type ProviderRuntime,
} from "@/lib/server/model-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * İçe aktarma sınırı 5 MB; gövde projeye ek olarak birkaç küçük alan taşıyor.
 * Sınır okunmadan önce uygulanıyor ki devasa bir gövde belleğe alınmasın.
 */
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 8_192;

const requestSchema = z.object({
  project: z.unknown(),
  target: sectionTargetSchema,
  claimPolicy: claimPolicySchema,
  instruction: z.string().max(MAX_REGENERATION_INSTRUCTION).default(""),
  assignment: z.object({ provider: z.string(), model: z.string() }),
  apiKey: z.string().max(4_096).default(""),
});

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new RequestError("The project is too large to regenerate a section of.", 413);
  if (!request.body) throw new RequestError("The request body is empty.", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RequestError("The project is too large to regenerate a section of.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new RequestError("The request body is not valid JSON.", 400);
  }
}

function parseInput(raw: unknown) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RequestError(`The regeneration request is not valid: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}`, 400);
  }
  const project = researchProjectSchema.safeParse(parsed.data.project);
  if (!project.success) {
    const issue = project.error.issues[0];
    throw new RequestError(`Invalid Trace project schema: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}`, 400);
  }
  const { target } = parsed.data;
  if (!findSection(project.data, target)) {
    throw new RequestError(`There is no ${target.kind} section with id "${target.sectionId}" in this project.`, 404);
  }

  const assignment = resolveProviderModel(parsed.data.assignment.provider, parsed.data.assignment.model);
  if (!assignment) throw new RequestError("The model and provider selection is not valid.", 400);
  const provider = getProvider(assignment.provider)!;

  /**
   * Yerel sağlayıcı burada da kabul ediliyor: bölüm yeniden üretimi PDF'i hiç
   * okumuyor, yalnızca kilitli kanıtla yazıyor — tam da yerel modelin
   * yapabildiği iş. Adres yine geri-döngüye kısıtlı.
   */
  let apiKey = parsed.data.apiKey.trim();
  if (provider.local) {
    try {
      apiKey = resolveLocalEndpoint(apiKey);
    } catch (error) {
      throw new RequestError(error instanceof Error ? error.message : "The local model address is not valid.", 400);
    }
  } else if (!apiKey) {
    throw new RequestError(`${provider.keyLabel} is required.`, 401);
  }

  return {
    project: project.data,
    target,
    claimPolicy: parsed.data.claimPolicy,
    instruction: parsed.data.instruction,
    assignment,
    apiKey,
  };
}

async function runRegeneration(
  input: ReturnType<typeof parseInput>,
  signal: AbortSignal,
  emit: (event: GenerationStreamEvent) => void,
) {
  const { project, target, claimPolicy, assignment } = input;
  const taskRole: GenerationTaskRole = target.kind === "story" ? "visual" : "report";
  const label = target.kind === "story" ? "story section" : "report section";
  const fingerprint = evidenceFingerprint(project.evidence);
  const schema = sectionSchemaFor(target.kind);
  const prompt = buildSectionRegenerationPrompt(project, target, {
    claimPolicy,
    instruction: input.instruction,
  });

  let lastProgress: GenerationProgress | undefined;
  let lastEmitAt = Date.now();
  let lastActivityAt = Date.now();
  let highWater = 10;
  const progress: ProgressWriter = (value) => {
    // Sağlayıcı katmanı kendi aşama adlarıyla ilerleme bildiriyor; burada tek
    // bir aşama var, dolayısıyla çubuk geri gitmesin.
    highWater = Math.max(highWater, value.progress);
    lastProgress = {
      ...value,
      stage: "story",
      progress: highWater,
      activityAt: new Date(lastActivityAt).toISOString(),
      heartbeat: false,
    };
    lastEmitAt = Date.now();
    emit({ type: "progress", ...lastProgress });
  };
  const markActivity = () => {
    lastActivityAt = Date.now();
  };
  const heartbeat = setInterval(() => {
    if (!lastProgress || Date.now() - lastEmitAt < HEARTBEAT_MS) return;
    lastEmitAt = Date.now();
    emit({ type: "progress", ...lastProgress, heartbeat: true, activityAt: new Date(lastActivityAt).toISOString() });
  }, HEARTBEAT_MS);

  let providerRuntime: ProviderRuntime | undefined;
  try {
    progress({
      stage: "story",
      progress: 10,
      title: `Preparing the ${label}.`,
      detail: "The evidence is locked; only this section will be rewritten.",
    });

    providerRuntime = await prepareProviderRuntime(
      { ...assignment, apiKey: input.apiKey, needsDocument: false, taskRole },
      signal,
      progress,
      markActivity,
    ).catch((error) => {
      throw tagProviderError(error, assignment, taskRole);
    });
    const runtimeForRequest = providerRuntime;

    let lastNotice = 0;
    const section = await generateValidated<RegeneratedSection>({
      stage: `Regenerated ${label}`,
      schema: schema as z.ZodType<RegeneratedSection>,
      signal,
      request: async (feedback) =>
        runtimeForRequest.generateStructured({
          prompt: feedback ? `${prompt}\n\nVALIDATION FEEDBACK:\n${feedback}` : prompt,
          schema,
          schemaName: target.kind === "story" ? "trace_story_section" : "trace_report_section",
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          includeDocument: false,
          signal,
          onChunk: (characters) => {
            markActivity();
            const now = Date.now();
            if (now - lastNotice < 900) return;
            lastNotice = now;
            progress({
              stage: "story",
              progress: 20 + Math.min(65, characters / 60),
              title: `Streaming the ${label}.`,
              detail: `Received ${characters.toLocaleString("en")} characters.`,
            });
          },
        }),
      validate: (value) => {
        spliceSection(project, target, value, {
          claimPolicy,
          expectedFingerprint: fingerprint,
          rejectUnchanged: true,
        });
      },
      onStructureRetry: (attempt, issues) =>
        progress({
          stage: "story",
          progress: highWater,
          title: `Relinking the ${label}.`,
          detail: `Clearing ${issues.length} inconsistencies · structure attempt ${attempt}/2`,
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "story",
          progress: highWater,
          title: `Reconnecting for the ${label}.`,
          detail: `Transient model error · network attempt ${attempt}/${MAX_NETWORK_ATTEMPTS}`,
          attempt,
        }),
    }).catch((error) => {
      throw tagProviderError(error, assignment, taskRole);
    });

    progress({
      stage: "story",
      progress: 100,
      title: "The section passed the evidence check.",
      detail: "Review it before it replaces the current version.",
    });
    emit({ type: "section", target, section, evidenceFingerprint: fingerprint });
  } finally {
    clearInterval(heartbeat);
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  let input: ReturnType<typeof parseInput>;
  try {
    input = parseInput(await readBody(request));
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "The regeneration request could not be read." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: GenerationStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Tarayıcı bağlantıyı kapattı; request.signal sağlayıcı işini durduruyor.
        }
      };
      try {
        await runRegeneration(input, request.signal, emit);
      } catch (error) {
        console.error("Trace section regeneration failed", {
          target: input.target,
          fallbackProvider: input.assignment.provider,
          fallbackModel: input.assignment.model,
          ...safeDiagnostic(error),
        });
        const message = error instanceof IntegrityError || error instanceof z.ZodError
          ? "The regenerated section failed the evidence check on both attempts. Nothing was changed; try again, or relax the claim lock."
          : publicError(error, request.signal.aborted, input.assignment.provider);
        emit({ type: "error", error: message });
      } finally {
        try {
          controller.close();
        } catch {
          // Akış istemci tarafından zaten kapatılmış.
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
