import { z } from "zod";
import {
  aliasBatches,
  aliasProposalSchema,
  buildAliasPrompt,
  conceptNames,
  MAX_ALIAS_BATCHES,
  mergeAliasProposals,
  validateAliasProposals,
  type AliasProposal,
  type CheckedAliasProposal,
  type ConceptName,
} from "@/lib/alias-proposals";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
import { getProvider, resolveProviderModel } from "@/lib/model-providers";
import { generateValidated, prepareProviderRuntime, publicError, safeDiagnostic, tagProviderError, type ProviderRuntime } from "@/lib/server/model-runtime";
import { listStoredProjects, readConceptAliases } from "@/lib/trace-storage";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  assignment: z.object({ provider: z.string(), model: z.string() }),
  apiKey: z.string().max(4_096).default(""),
});

/** Aynı anda en çok bu kadar parça soruluyor: sağlayıcının hız sınırına takılmadan. */
const PARALLEL_PARTS = 3;

/**
 * Kütüphanede farklı adlarla anlatılan aynı kavramları bir modele sordurur
 * (`alias-proposals.ts`). Model yalnızca adları ve makalelerin kendi
 * tanımlarını görüyor; önerileri okuyucu onaylıyor. Hiçbir şey kaydedilmiyor.
 * Anahtar yalnızca bu istek için bellekte.
 *
 * Adlar bir isteğe sığmıyorsa parçalara bölünüp ayrı soruluyor; bir parça
 * başarısız olursa ötekilerin önerileri yine geliyor ve kaç parçanın
 * okunamadığı söyleniyor.
 */
export async function POST(request: Request) {
  const t = serverText(request);
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: t.aliases.modelRequired }, { status: 400 });
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

  const [projects, file] = await Promise.all([listStoredProjects(), readConceptAliases()]);
  const names = conceptNames(projects, file);
  if (names.length < 2) return Response.json({ proposals: [], names: names.length, parts: 0, failedParts: 0, unread: 0 }, { headers: { "Cache-Control": "no-store" } });
  const parts = aliasBatches(names).slice(0, MAX_ALIAS_BATCHES);
  const read = new Set(parts.flat().map((name) => name.key));
  let providerRuntime: ProviderRuntime | undefined;
  try {
    providerRuntime = await prepareProviderRuntime({ ...assignment, apiKey, needsDocument: false, taskRole: "teaching" }, request.signal, () => undefined, () => undefined);
    const active = providerRuntime;
    const ask = async (part: readonly ConceptName[]) => {
      const prompt = buildAliasPrompt(part);
      let accepted: CheckedAliasProposal[] = [];
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
          accepted = validateAliasProposals(value, part, file);
        },
        onStructureRetry: () => undefined,
        onNetworkRetry: () => undefined,
      });
      return accepted;
    };
    const outcomes: PromiseSettledResult<CheckedAliasProposal[]>[] = [];
    for (let start = 0; start < parts.length; start += PARALLEL_PARTS) {
      if (request.signal.aborted) break;
      outcomes.push(...(await Promise.allSettled(parts.slice(start, start + PARALLEL_PARTS).map(ask))));
    }
    const answered = outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
    const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (!answered.length) throw failed?.reason ?? new Error(t.aliases.modelNotAsked);
    if (failed) console.error("Trace concept alias proposal: a part failed", safeDiagnostic(tagProviderError(failed.reason, assignment, "teaching")));
    return Response.json(
      {
        proposals: mergeAliasProposals(answered).map((item) => ({
          a: { term: item.a.term, paper: item.a.paper, definition: item.a.definition },
          b: { term: item.b.term, paper: item.b.paper, definition: item.b.definition },
          why: item.why,
        })),
        names: names.length,
        parts: parts.length,
        failedParts: parts.length - answered.length,
        unread: names.length - read.size,
        model: active.effectiveModel,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const tagged = tagProviderError(error, assignment, "teaching");
    console.error("Trace concept alias proposal failed", safeDiagnostic(tagged));
    return Response.json({ error: publicError(tagged, request.signal.aborted, assignment.provider, t.errors) }, { status: 502 });
  } finally {
    await providerRuntime?.cleanup().catch(() => undefined);
  }
}
