import { z } from "zod";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
import {
  PROBE_INSTRUCTION,
  PROBE_PASSAGE,
  PROBE_TIMEOUT_MS,
  describeProbe,
  estimateSection,
  probeOutputSchema,
  slowestEstimate,
} from "@/lib/model-probe";
import { getProvider, resolveProviderModel } from "@/lib/model-providers";
import {
  prepareProviderRuntime,
  publicError,
  requestTimeoutMs,
  safeDiagnostic,
  type ProviderRuntime,
} from "@/lib/server/model-runtime";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  assignment: z.object({ provider: z.string(), model: z.string() }),
  apiKey: z.string().max(4_096).default(""),
  /** Gerçek bölüm isteminin uzunluğu; tahmin buna göre ölçekleniyor. */
  promptCharacters: z.number().int().min(0).max(2_000_000).default(20_000),
  /**
   * Tam üretim için: aynı model birden fazla göreve atanmışsa tek ölçümle
   * her görevin en ağır isteği ayrı ayrı tahmin ediliyor. Verilirse hüküm en
   * uzun sürecek istekten çıkıyor.
   */
  stages: z.array(z.object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(80),
    promptCharacters: z.number().int().min(0).max(2_000_000),
    outputCharacters: z.number().int().min(1).max(500_000),
  })).max(8).optional(),
});

/**
 * Seçilen modele kısa bir yapılandırılmış istek gönderip hızını ölçer.
 * Yanıtın içeriği önemsiz; yalnızca zamanlama döndürülüyor. Anahtar
 * yeniden üretimdeki gibi yalnızca bu istek süresince bellekte.
 */
export async function POST(request: Request) {
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ ok: false, error: "The model test request is not valid." }, { status: 400 });
  }
  const assignment = resolveProviderModel(input.assignment.provider, input.assignment.model);
  if (!assignment) return Response.json({ ok: false, error: "The model and provider selection is not valid." }, { status: 400 });
  const provider = getProvider(assignment.provider)!;

  let apiKey = input.apiKey.trim();
  if (provider.local) {
    try {
      apiKey = resolveLocalEndpoint(apiKey);
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "The local model address is not valid." }, { status: 400 });
    }
  } else if (!apiKey) {
    return Response.json({ ok: false, error: `${provider.keyLabel} is required.` }, { status: 401 });
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
  const prompt = `${PROBE_INSTRUCTION}\n\n${PROBE_PASSAGE}`;
  const startedAt = Date.now();
  let firstChunkAt: number | undefined;
  let outputCharacters = 0;
  let providerRuntime: ProviderRuntime | undefined;

  try {
    providerRuntime = await prepareProviderRuntime(
      { ...assignment, apiKey, needsDocument: false, taskRole: "visual" },
      signal,
      () => undefined,
      () => undefined,
    );
    // Hazırlık (ör. yerel sunucunun yoklanması) ölçüme girmiyor; bölüm
    // üretiminde de istekten önce bir kez yapılıyor.
    const requestStartedAt = Date.now();
    await providerRuntime.generateStructured({
      prompt,
      schema: probeOutputSchema,
      schemaName: "trace_model_probe",
      maxOutputTokens: 1_024,
      includeDocument: false,
      signal,
      onChunk: (characters) => {
        firstChunkAt ??= Date.now();
        outputCharacters = characters;
      },
    });
    const finishedAt = Date.now();
    const measurement = {
      firstChunkMs: (firstChunkAt ?? finishedAt) - requestStartedAt,
      totalMs: finishedAt - requestStartedAt,
      outputCharacters,
      probePromptCharacters: prompt.length,
    };
    const limitMs = requestTimeoutMs(assignment.provider);
    if (input.stages?.length) {
      const stages = input.stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        ...estimateSection(measurement, {
          promptCharacters: stage.promptCharacters,
          limitMs,
          expectedOutputCharacters: stage.outputCharacters,
        }),
      }));
      const slowest = slowestEstimate(stages)!;
      const result = { ok: true as const, ...measurement, ...slowest, stages };
      return Response.json({ ...result, message: describeProbe(result, slowest.label) });
    }
    const estimate = estimateSection(measurement, { promptCharacters: input.promptCharacters, limitMs });
    const result = { ok: true as const, ...measurement, ...estimate };
    return Response.json({ ...result, message: describeProbe(result) });
  } catch (error) {
    const timedOut = !request.signal.aborted && signal.aborted;
    if (timedOut) {
      const limitSeconds = Math.round(requestTimeoutMs(assignment.provider) / 1000);
      return Response.json({
        ok: true,
        verdict: "too-slow",
        firstChunkMs: firstChunkAt ? firstChunkAt - startedAt : PROBE_TIMEOUT_MS,
        totalMs: Date.now() - startedAt,
        outputCharacters,
        probePromptCharacters: prompt.length,
        estimateSeconds: null,
        limitSeconds,
        stages: input.stages?.map((stage) => ({ id: stage.id, label: stage.label, estimateSeconds: null, limitSeconds, verdict: "too-slow" })),
        message: `The model did not finish a short test within ${PROBE_TIMEOUT_MS / 1000} s. ${input.stages ? "A full analysis" : "A section"} would almost certainly exceed the limit. Pick a faster model.`,
      });
    }
    console.error("Trace model probe failed", { fallbackProvider: assignment.provider, fallbackModel: assignment.model, ...safeDiagnostic(error) });
    return Response.json({ ok: false, error: publicError(error, request.signal.aborted, assignment.provider) }, { status: 502 });
  } finally {
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}
