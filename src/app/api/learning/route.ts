import { z } from "zod";
import type { GenerationProgress, GenerationStreamEvent } from "@/lib/generation-events";
import {
  applyLearningBlock,
  describeLearningGaps,
  learningBlockIds,
  learningBlockSpec,
  missingLearningBlocks,
  type LearningBlockId,
  type LearningBlocks,
} from "@/lib/learning-generation";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
import { getProvider, resolveProviderModel } from "@/lib/model-providers";
import { researchProjectSchema } from "@/lib/schema";
import { evidenceFingerprint, rejectedClaimIds } from "@/lib/section-regeneration";
import { generateLearningBlock, learningFailureReason, refusesEveryRequest } from "@/lib/server/learning-runner";
import {
  HEARTBEAT_MS,
  MAX_NETWORK_ATTEMPTS,
  prepareProviderRuntime,
  publicError,
  safeDiagnostic,
  tagProviderError,
  type ProgressWriter,
  type ProviderRuntime,
} from "@/lib/server/model-runtime";
import { RequestError, readJsonBody } from "@/lib/server/request-body";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Mevcut bir projeye öğrenme katmanını ekler.
 *
 * Stüdyonun analizi bu katmanı yakın zamana kadar hiç yazmıyordu; o projelerin
 * hepsi ön bilgisiz, quizsiz. Katman yalnızca kilitli kanıttan yazılıyor (PDF
 * gerekmiyor, yerel model de olur) ve tam analizle AYNI istem, şema ve
 * denetimden geçiyor. Var olan bir blok üzerine yazılmıyor: onun için tek
 * öğeyi yeniden üretme var.
 */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

const requestSchema = z.object({
  project: z.unknown(),
  blocks: z.array(z.enum(learningBlockIds)).max(learningBlockIds.length).optional(),
  assignment: z.object({ provider: z.string(), model: z.string() }),
  apiKey: z.string().max(4_096).default(""),
});

function parseInput(raw: unknown) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RequestError(`The learning layer request is not valid: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}`, 400);
  }
  const project = researchProjectSchema.safeParse(parsed.data.project);
  if (!project.success) {
    const issue = project.error.issues[0];
    throw new RequestError(`Invalid Trace project schema: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}`, 400);
  }

  const blocks: LearningBlockId[] = parsed.data.blocks
    ? learningBlockIds.filter((block) => parsed.data.blocks!.includes(block))
    : missingLearningBlocks(project.data);
  if (!blocks.length) throw new RequestError("This project already has its learning layer.", 400);
  const existing = blocks.find((block) => {
    const value = project.data[block];
    return value !== undefined && !(Array.isArray(value) && value.length === 0);
  });
  if (existing) {
    throw new RequestError(`This project already has ${learningBlockSpec(existing).noun}. Regenerate its items one by one instead.`, 409);
  }

  const assignment = resolveProviderModel(parsed.data.assignment.provider, parsed.data.assignment.model);
  if (!assignment) throw new RequestError("The model and provider selection is not valid.", 400);
  const provider = getProvider(assignment.provider)!;
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

  return { project: project.data, blocks, assignment, apiKey };
}

async function runLearning(
  input: ReturnType<typeof parseInput>,
  signal: AbortSignal,
  emit: (event: GenerationStreamEvent) => void,
) {
  const { project, blocks, assignment } = input;
  const fingerprint = evidenceFingerprint(project.evidence);

  let lastProgress: GenerationProgress | undefined;
  let lastEmitAt = Date.now();
  let lastActivityAt = Date.now();
  let highWater = 6;
  const progress: ProgressWriter = (value) => {
    highWater = Math.max(highWater, value.progress);
    lastProgress = { ...value, stage: "story", progress: highWater, activityAt: new Date(lastActivityAt).toISOString(), heartbeat: false };
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
      progress: 6,
      title: "Preparing the teaching model.",
      detail: "The evidence is locked; the learning material is written from it alone, without the PDF.",
    });
    providerRuntime = await prepareProviderRuntime(
      { ...assignment, apiKey: input.apiKey, needsDocument: false, taskRole: "teaching" },
      signal,
      progress,
      markActivity,
    ).catch((error) => {
      throw tagProviderError(error, assignment, "teaching");
    });

    const written: LearningBlocks = {};
    const failed: Array<{ block: LearningBlockId; reason: string }> = [];
    let firstError: unknown;
    let lastNotice = 0;
    for (const [index, block] of blocks.entries()) {
      const spec = learningBlockSpec(block);
      const step = `${index + 1}/${blocks.length}`;
      const floor = 10 + (index / blocks.length) * 85;
      progress({ stage: "story", progress: floor, title: `${spec.title}.`, detail: `Part ${step} of the learning layer.` });
      try {
        const value = await generateLearningBlock(block, providerRuntime, {
          evidence: project.evidence,
          depth: project.depth,
          language: project.language,
          audience: project.audience,
          technicalAppendix: project.technicalAppendix,
          rejectedClaimIds: rejectedClaimIds(project),
        }, signal, {
          onChunk: (characters) => {
            markActivity();
            const now = Date.now();
            if (now - lastNotice < 900) return;
            lastNotice = now;
            progress({
              stage: "story",
              progress: floor + Math.min(0.9, characters / 7_000) * (85 / blocks.length),
              title: `${spec.title}.`,
              detail: `Received ${characters.toLocaleString("en")} characters · part ${step}`,
            });
          },
          onStructureRetry: (attempt, issues) => progress({
            stage: "story",
            progress: highWater,
            title: `Relinking ${spec.noun}.`,
            detail: `Clearing ${issues.length} inconsistencies · structure attempt ${attempt}/2`,
            attempt,
          }),
          onNetworkRetry: (attempt) => progress({
            stage: "story",
            progress: highWater,
            title: `Reconnecting for ${spec.noun}.`,
            detail: `Transient model error · network attempt ${attempt}/${MAX_NETWORK_ATTEMPTS}`,
            attempt,
          }),
        });
        Object.assign(written, applyLearningBlock(block, value));
      } catch (error) {
        if (signal.aborted) throw error;
        // Reddedilen bir anahtarla sonraki parçalar da düşer: boşuna istek yok.
        if (refusesEveryRequest(error)) throw tagProviderError(error, assignment, "teaching");
        firstError ??= error;
        failed.push({ block, reason: learningFailureReason(error) });
        console.error("Trace learning layer block failed", { block, fallbackProvider: assignment.provider, fallbackModel: assignment.model, ...safeDiagnostic(error) });
      }
    }
    // Hiçbir parça yazılamadıysa kullanıcı asıl hatayı görüyor, bir özet değil.
    if (!Object.keys(written).length) throw tagProviderError(firstError, assignment, "teaching");
    progress({
      stage: "story",
      progress: 100,
      title: "The learning material passed the evidence check.",
      detail: failed.length ? describeLearningGaps(failed)! : "Every part cites only claims the evidence has.",
    });
    emit({ type: "learning", blocks: written, failed, evidenceFingerprint: fingerprint });
  } finally {
    clearInterval(heartbeat);
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  let input: ReturnType<typeof parseInput>;
  try {
    input = parseInput(await readJsonBody(request, MAX_BODY_BYTES, "The project is too large to add a learning layer to."));
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "The learning layer request could not be read." }, { status: 400 });
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
        await runLearning(input, request.signal, emit);
      } catch (error) {
        console.error("Trace learning layer failed", {
          fallbackProvider: input.assignment.provider,
          fallbackModel: input.assignment.model,
          ...safeDiagnostic(error),
        });
        const message = error instanceof RequestError ? error.message : publicError(error, request.signal.aborted, input.assignment.provider);
        emit({ type: "error", error: message });
      } finally {
        try {
          controller.close();
        } catch {
          // Akış istemci tarafından zaten kapatıldı.
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
