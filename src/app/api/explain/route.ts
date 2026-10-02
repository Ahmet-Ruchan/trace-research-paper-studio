import { z } from "zod";
import {
  MAX_EXPLANATION_LENGTH,
  MIN_EXPLANATION_LENGTH,
  buildExplainPrompt,
  explainTargetSchema,
  explainedSection,
  explanationCoverage,
  explanationFeedbackSchema,
  validateExplanationFeedback,
  type ExplanationFeedback,
} from "@/lib/explain-back";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
import { getProvider, resolveProviderModel } from "@/lib/model-providers";
import { researchProjectSchema } from "@/lib/schema";
import { generateValidated, prepareProviderRuntime, publicError, safeDiagnostic, tagProviderError, type ProviderRuntime } from "@/lib/server/model-runtime";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_CHARACTERS = 6 * 1024 * 1024;

const requestSchema = z.object({
  project: z.unknown(),
  target: explainTargetSchema,
  text: z.string().trim().min(MIN_EXPLANATION_LENGTH).max(MAX_EXPLANATION_LENGTH),
  assignment: z.object({ provider: z.string(), model: z.string() }),
  apiKey: z.string().max(4_096).default(""),
});

/**
 * Okuyucunun bir bölümü kendi cümleleriyle anlatışını YALNIZCA kanıt
 * defterine karşı denetler (`explain-back.ts`). İstek PDF taşımaz, bu yüzden
 * yerel bir model de kullanılabilir. Anahtar yalnızca bu istek için bellekte
 * durur; proje ve okuyucunun metni saklanmaz.
 */
export async function POST(request: Request) {
  const t = serverText(request);
  const body = await request.text().catch(() => "");
  if (!body || body.length > MAX_BODY_CHARACTERS) return Response.json({ error: t.request.emptyOrTooLarge }, { status: 400 });
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return Response.json({ error: t.errors.requestBodyInvalidJson() }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: t.explain.length(MIN_EXPLANATION_LENGTH, MAX_EXPLANATION_LENGTH) }, { status: 400 });
  }
  const project = researchProjectSchema.safeParse(parsed.data.project);
  if (!project.success) return Response.json({ error: t.request.projectInvalid }, { status: 400 });
  const { target, text } = parsed.data;
  if (!explainedSection(project.data, target)) return Response.json({ error: t.explain.sectionMissing }, { status: 404 });

  const assignment = resolveProviderModel(parsed.data.assignment.provider, parsed.data.assignment.model);
  if (!assignment) return Response.json({ error: t.request.modelSelectionInvalid }, { status: 400 });
  const provider = getProvider(assignment.provider)!;
  let apiKey = parsed.data.apiKey.trim();
  if (provider.local) {
    try {
      apiKey = resolveLocalEndpoint(apiKey);
    } catch (error) {
      return Response.json({ error: errorMessage(error, t.errors, t.request.localAddressInvalid) }, { status: 400 });
    }
  } else if (!apiKey) {
    return Response.json({ error: t.request.keyRequired(provider) }, { status: 401 });
  }

  const prompt = buildExplainPrompt(project.data, target, text);
  let providerRuntime: ProviderRuntime | undefined;
  try {
    providerRuntime = await prepareProviderRuntime(
      { ...assignment, apiKey, needsDocument: false, taskRole: "teaching", progressText: t.progress },
      request.signal,
      () => undefined,
      () => undefined,
    );
    const active = providerRuntime;
    const feedback = await generateValidated<ExplanationFeedback>({
      stage: "Explanation",
      schema: explanationFeedbackSchema,
      signal: request.signal,
      request: (feedbackText) =>
        active.generateStructured({
          prompt: feedbackText ? `${prompt}\n\nVALIDATION FEEDBACK:\n${feedbackText}` : prompt,
          schema: explanationFeedbackSchema,
          schemaName: "trace_explanation_feedback",
          maxOutputTokens: 3_072,
          includeDocument: false,
          signal: request.signal,
          onChunk: () => undefined,
        }),
      validate: (value) => validateExplanationFeedback(project.data, target, text, value),
      onStructureRetry: () => undefined,
      onNetworkRetry: () => undefined,
    });
    return Response.json(
      { feedback, coverage: explanationCoverage(project.data, target, feedback), model: active.effectiveModel },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const tagged = tagProviderError(error, assignment, "teaching");
    console.error("Trace explanation check failed", safeDiagnostic(tagged));
    return Response.json({ error: publicError(tagged, request.signal.aborted, assignment.provider, t.errors) }, { status: 502 });
  } finally {
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}
