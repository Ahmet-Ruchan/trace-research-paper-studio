import { z } from "zod";
import { MAX_QUESTION_LENGTH, buildAskPrompt, evidenceAnswerSchema, validateAnswer, type EvidenceAnswer } from "@/lib/evidence-qa";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
import { getProvider, resolveProviderModel } from "@/lib/model-providers";
import { researchProjectSchema } from "@/lib/schema";
import { generateValidated, prepareProviderRuntime, publicError, safeDiagnostic, tagProviderError, type ProviderRuntime } from "@/lib/server/model-runtime";

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
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_CHARACTERS) return Response.json({ error: "The request is empty or too large." }, { status: 400 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "The request body is not valid JSON." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Ask a question of at least three characters." }, { status: 400 });
  const project = researchProjectSchema.safeParse(parsed.data.project);
  if (!project.success) return Response.json({ error: "The Trace project is not valid." }, { status: 400 });

  const assignment = resolveProviderModel(parsed.data.assignment.provider, parsed.data.assignment.model);
  if (!assignment) return Response.json({ error: "The model and provider selection is not valid." }, { status: 400 });
  const provider = getProvider(assignment.provider)!;
  let apiKey = parsed.data.apiKey.trim();
  if (provider.local) {
    try {
      apiKey = resolveLocalEndpoint(apiKey);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The local model address is not valid." }, { status: 400 });
    }
  } else if (!apiKey) {
    return Response.json({ error: `${provider.keyLabel} is required.` }, { status: 401 });
  }

  const prompt = buildAskPrompt(project.data, parsed.data.question);
  let providerRuntime: ProviderRuntime | undefined;
  try {
    providerRuntime = await prepareProviderRuntime(
      { ...assignment, apiKey, needsDocument: false, taskRole: "report" },
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
    return Response.json({ error: publicError(tagged, request.signal.aborted, assignment.provider) }, { status: 502 });
  } finally {
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}
