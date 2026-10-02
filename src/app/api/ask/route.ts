import { z } from "zod";
import { MAX_QUESTION_LENGTH, buildAskPrompt, evidenceAnswerSchema, validateAnswer, type EvidenceAnswer } from "@/lib/evidence-qa";
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
  question: z.string().trim().min(3).max(MAX_QUESTION_LENGTH),
  assignment: z.object({ provider: z.string(), model: z.string() }),
  apiKey: z.string().max(4_096).default(""),
});

/**
 * Bir soruyu YALNIZCA projenin kanıt defterinden cevaplar. İstek PDF taşımaz,
 * bu yüzden yerel bir model de kullanılabilir. Anahtar yalnızca bu istek için
 * bellekte durur; proje ve soru saklanmaz.
 */
export async function POST(request: Request) {
  const t = serverText(request);
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_CHARACTERS) return Response.json({ error: t.request.emptyOrTooLarge }, { status: 400 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: t.errors.requestBodyInvalidJson() }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: t.ask.questionTooShort }, { status: 400 });
  const project = researchProjectSchema.safeParse(parsed.data.project);
  if (!project.success) return Response.json({ error: t.request.projectInvalid }, { status: 400 });

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

  const prompt = buildAskPrompt(project.data, parsed.data.question);
  let providerRuntime: ProviderRuntime | undefined;
  try {
    providerRuntime = await prepareProviderRuntime(
      { ...assignment, apiKey, needsDocument: false, taskRole: "report", progressText: t.progress },
      request.signal,
      () => undefined,
      () => undefined,
    );
    const active = providerRuntime;
    const answer = await generateValidated<EvidenceAnswer>({
      stage: "Answer",
      schema: evidenceAnswerSchema,
      signal: request.signal,
      request: (feedback) =>
        active.generateStructured({
          prompt: feedback ? `${prompt}\n\nVALIDATION FEEDBACK:\n${feedback}` : prompt,
          schema: evidenceAnswerSchema,
          schemaName: "trace_evidence_answer",
          maxOutputTokens: 1_536,
          includeDocument: false,
          signal: request.signal,
          onChunk: () => undefined,
        }),
      validate: (value) => validateAnswer(project.data, value),
      onStructureRetry: () => undefined,
      onNetworkRetry: () => undefined,
    });
    return Response.json({ ...answer, model: active.effectiveModel }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const tagged = tagProviderError(error, assignment, "report");
    console.error("Trace ask failed", safeDiagnostic(tagged));
    return Response.json({ error: publicError(tagged, request.signal.aborted, assignment.provider, t.errors) }, { status: 502 });
  } finally {
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}
