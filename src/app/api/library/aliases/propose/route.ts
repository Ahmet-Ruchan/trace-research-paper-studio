import { z } from "zod";
import { aliasProposalSchema, buildAliasPrompt, conceptNames, validateAliasProposals, type AliasProposal } from "@/lib/alias-proposals";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
import { getProvider, resolveProviderModel } from "@/lib/model-providers";
import { generateValidated, prepareProviderRuntime, publicError, safeDiagnostic, tagProviderError, type ProviderRuntime } from "@/lib/server/model-runtime";
import { listStoredProjects, readConceptAliases } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  assignment: z.object({ provider: z.string(), model: z.string() }),
  apiKey: z.string().max(4_096).default(""),
});

/**
 * Kütüphanede farklı adlarla anlatılan aynı kavramları bir modele sordurur
 * (`alias-proposals.ts`). Model yalnızca adları ve makalelerin kendi
 * tanımlarını görüyor; önerileri okuyucu onaylıyor. Hiçbir şey kaydedilmiyor.
 * Anahtar yalnızca bu istek için bellekte.
 */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "A model and provider are required." }, { status: 400 });
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

  const [projects, file] = await Promise.all([listStoredProjects(), readConceptAliases()]);
  const names = conceptNames(projects, file);
  if (names.length < 2) return Response.json({ proposals: [], names: names.length }, { headers: { "Cache-Control": "no-store" } });
  const prompt = buildAliasPrompt(names);
  let providerRuntime: ProviderRuntime | undefined;
  try {
    providerRuntime = await prepareProviderRuntime({ ...assignment, apiKey, needsDocument: false, taskRole: "teaching" }, request.signal, () => undefined, () => undefined);
    const active = providerRuntime;
    let accepted: ReturnType<typeof validateAliasProposals> = [];
    await generateValidated<AliasProposal>({
      stage: "Concept aliases",
      schema: aliasProposalSchema,
      signal: request.signal,
      request: (feedback) =>
        active.generateStructured({
          prompt: feedback ? `${prompt}\n\nVALIDATION FEEDBACK:\n${feedback}` : prompt,
          schema: aliasProposalSchema,
          schemaName: "trace_concept_aliases",
          maxOutputTokens: 2_048,
          includeDocument: false,
          signal: request.signal,
          onChunk: () => undefined,
        }),
      validate: (value) => {
        accepted = validateAliasProposals(value, names, file);
      },
      onStructureRetry: () => undefined,
      onNetworkRetry: () => undefined,
    });
    return Response.json(
      {
        proposals: accepted.map((item) => ({
          a: { term: item.a.term, paper: item.a.paper, definition: item.a.definition },
          b: { term: item.b.term, paper: item.b.paper, definition: item.b.definition },
          why: item.why,
        })),
        names: names.length,
        model: active.effectiveModel,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const tagged = tagProviderError(error, assignment, "teaching");
    console.error("Trace concept alias proposal failed", safeDiagnostic(tagged));
    return Response.json({ error: publicError(tagged, request.signal.aborted, assignment.provider) }, { status: 502 });
  } finally {
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}
