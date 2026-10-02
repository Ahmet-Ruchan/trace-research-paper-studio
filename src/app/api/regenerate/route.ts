import { z } from "zod";
import type { GenerationProgress, GenerationStreamEvent } from "@/lib/generation-events";
import { IntegrityError } from "@/lib/generation-validation";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
import { getProvider, resolveProviderModel } from "@/lib/model-providers";
import { researchProjectSchema } from "@/lib/schema";
import {
  MAX_REGENERATION_INSTRUCTION,
  buildSectionRegenerationPrompt,
  claimPolicySchema,
  evidenceFingerprint,
  findSection,
  regenerationGoalSchema,
  sectionKindInfo,
  sectionObligations,
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
import { RequestError, readJsonBody } from "@/lib/server/request-body";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

type ServerText = ReturnType<typeof serverText>;

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
  goal: regenerationGoalSchema.default("revise"),
  instruction: z.string().max(MAX_REGENERATION_INSTRUCTION).default(""),
  assignment: z.object({ provider: z.string(), model: z.string() }),
  apiKey: z.string().max(4_096).default(""),
});

function parseInput(raw: unknown, t: ServerText) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RequestError(t.regenerate.requestInvalid(issue?.path.join(".") ?? "", issue?.message), 400);
  }
  const project = researchProjectSchema.safeParse(parsed.data.project);
  if (!project.success) {
    const issue = project.error.issues[0];
    throw new RequestError(t.request.projectSchemaInvalid(issue?.path.join(".") ?? "", issue?.message), 400);
  }
  const { target } = parsed.data;
  if (!findSection(project.data, target)) {
    throw new RequestError(t.regenerate.notFound(target.kind, target.sectionId), 404);
  }

  try {
    sectionObligations(project.data, target, parsed.data.claimPolicy, parsed.data.goal);
  } catch (error) {
    if (error instanceof IntegrityError) throw new RequestError(error.issues.join("; "), 400);
    throw error;
  }

  const assignment = resolveProviderModel(parsed.data.assignment.provider, parsed.data.assignment.model);
  if (!assignment) throw new RequestError(t.request.modelSelectionInvalid, 400);
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
      throw new RequestError(errorMessage(error, t.errors, t.request.localAddressInvalid), 400);
    }
  } else if (!apiKey) {
    throw new RequestError(t.request.keyRequired(provider), 401);
  }

  return {
    project: project.data,
    target,
    claimPolicy: parsed.data.claimPolicy,
    goal: parsed.data.goal,
    instruction: parsed.data.instruction,
    assignment,
    apiKey,
  };
}

async function runRegeneration(
  input: ReturnType<typeof parseInput>,
  signal: AbortSignal,
  emit: (event: GenerationStreamEvent) => void,
  t: ServerText,
) {
  const { project, target, claimPolicy, assignment } = input;
  const { taskRole, label, schemaName } = sectionKindInfo(target.kind);
  const kind = target.kind;
  const fingerprint = evidenceFingerprint(project.evidence);
  const schema = sectionSchemaFor(target.kind);
  const prompt = buildSectionRegenerationPrompt(project, target, {
    claimPolicy,
    goal: input.goal,
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
      title: t.regenerate.preparing(kind),
      detail: t.regenerate.preparingDetail(kind),
    });

    providerRuntime = await prepareProviderRuntime(
      { ...assignment, apiKey: input.apiKey, needsDocument: false, taskRole, progressText: t.progress },
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
          schemaName,
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
              title: t.regenerate.streaming(kind),
              detail: t.regenerate.received(characters),
            });
          },
        }),
      validate: (value) => {
        spliceSection(project, target, value, {
          claimPolicy,
          expectedFingerprint: fingerprint,
          rejectUnchanged: true,
          goal: input.goal,
        });
      },
      onStructureRetry: (attempt, issues) =>
        progress({
          stage: "story",
          progress: highWater,
          title: t.regenerate.relinking(kind),
          detail: t.retry.structure(issues.length, attempt),
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "story",
          progress: highWater,
          title: t.regenerate.reconnecting(kind),
          detail: t.retry.network(attempt, MAX_NETWORK_ATTEMPTS),
          attempt,
        }),
    }).catch((error) => {
      throw tagProviderError(error, assignment, taskRole);
    });

    progress({
      stage: "story",
      progress: 100,
      title: t.regenerate.passed(kind),
      detail: t.regenerate.reviewFirst,
    });
    emit({ type: "section", target, section, evidenceFingerprint: fingerprint });
  } finally {
    clearInterval(heartbeat);
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  const t = serverText(request);
  let input: ReturnType<typeof parseInput>;
  try {
    input = parseInput(await readJsonBody(request, MAX_BODY_BYTES, t.regenerate.tooLarge, t.errors), t);
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: t.regenerate.unreadable }, { status: 400 });
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
        await runRegeneration(input, request.signal, emit, t);
      } catch (error) {
        console.error("Trace section regeneration failed", {
          target: input.target,
          fallbackProvider: input.assignment.provider,
          fallbackModel: input.assignment.model,
          ...safeDiagnostic(error),
        });
        const message = error instanceof IntegrityError || error instanceof z.ZodError
          ? t.regenerate.failedTwice(input.target.kind)
          : publicError(error, request.signal.aborted, input.assignment.provider, t.errors);
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
