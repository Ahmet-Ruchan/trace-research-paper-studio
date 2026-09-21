import { createHash } from "node:crypto";
import { resolveLocalEndpoint } from "@/lib/local-endpoint";
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
  validateDeepReportIntegrity,
  validateEvidenceIntegrity,
  validateStoryIntegrity,
  validateTechnicalAppendixIntegrity,
} from "@/lib/generation-validation";
import { buildDeepReportPrompt, buildEvidencePassPrompt, buildStoryPrompt, buildTechnicalAppendixPrompt } from "@/lib/prompts";
import { expectedSectionCounts } from "@/lib/section-budgets";
import { applyExcerptCheck, downgradeUnlocatedClaims, renderPaperText } from "@/lib/paper-text";
import { extractPaperPages, PaperTextError } from "@/lib/server/paper-text-extract";
import {
  findBuiltInTemplate,
  narrativeTemplateSchema,
  templateIssues,
  validateReportTemplate,
  validateStoryTemplate,
  type NarrativeTemplate,
} from "@/lib/narrative-templates";
import {
  getProvider,
  getProviderForModel,
  generationTaskRoles,
  documentTaskRoles,
  providerReadsDocuments,
  providerReadsPaperAsText,
  resolveProviderModel,
  type GenerationTaskRole,
  type ModelTeam,
  type ProviderId,
} from "@/lib/model-providers";
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
import { allocatePaperAccent, paperIdentityFromBytes } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PDF_BYTES = 35 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 750 * 1024;
const EVIDENCE_CONCURRENCY = 2;

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
  template?: NarrativeTemplate;
};

type StreamWriter = (event: GenerationStreamEvent) => void;

function jsonError(message: string, status: number, detail?: unknown) {
  return Response.json({ error: message, detail }, { status });
}

function expectedSections(input: Pick<GenerationInput, "depth" | "template">) {
  return expectedSectionCounts(input).story;
}

function expectedReportSections(input: Pick<GenerationInput, "depth" | "template">) {
  return expectedSectionCounts(input).report;
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
  /**
   * Belge okuyamayan bir sağlayıcı, makaleyi okuyan aşamalara atanamaz.
   * Yerel sunucuların dosya yükleme uçnoktası yok ve açık ağırlıklı
   * modellerin çoğu PDF'i hiç göremiyor; sessizce metinsiz devam etmek
   * kaynağa bağlı olmayan bir analiz üretirdi — Trace'in tek yapmayacağı şey.
   */
  const unreadable = documentTaskRoles.find((role) => !providerReadsDocuments(assignments[role].provider));
  if (unreadable) {
    const providerLabel = getProvider(assignments[unreadable].provider)?.label ?? assignments[unreadable].provider;
    throw new InputError(
      `${providerLabel} cannot be given the PDF, so it cannot run the ${unreadable} stage — that stage reads the paper itself. Assign a provider that reads documents to Evidence and Technical; ${providerLabel} can still write the report and the visuals.`,
      400,
    );
  }

  /**
   * Yerel sağlayıcıda "anahtar" bir adres ve boş bırakılabilir: boşsa
   * Ollama'nın varsayılan adresi kullanılır. Adres burada doğrulanıyor ki
   * hata, üretim yarıda kalmışken değil daha isteğin başında görünsün.
   */
  for (const assignment of Object.values(assignments)) {
    if (!getProvider(assignment.provider)?.local) continue;
    try {
      apiKeys[assignment.provider] = resolveLocalEndpoint(apiKeys[assignment.provider]);
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : "The local model address is not valid.", 400);
    }
  }

  const missingProvider = Object.values(assignments)
    .map((assignment) => assignment.provider)
    .find((providerId) => !apiKeys[providerId]);
  if (missingProvider) throw new InputError(`${getProvider(missingProvider)!.keyLabel} is required.`, 401);

  let urls: string[] = [];
  try {
    const rawUrls = JSON.parse(String(form.get("sources") ?? "[]"));
    if (!Array.isArray(rawUrls)) throw new Error("array expected");
    urls = rawUrls.filter((item): item is string => typeof item === "string").slice(0, 3);
  } catch {
    throw new InputError("The list of source URLs is not valid.", 400);
  }

  /**
   * Şablon üretimden ÖNCE denetleniyor: kurallarla çelişen bir şablona göre
   * yazılan her anlatı reddedilir, ve kullanıcı bunu kanıt aşamasının ücretini
   * ödedikten sonra öğrenirdi. Hazır bir şablon kimlikle gelebilir.
   */
  let template: NarrativeTemplate | undefined;
  const rawTemplate = String(form.get("template") ?? "").trim();
  if (rawTemplate) {
    let candidate: unknown;
    try {
      candidate = rawTemplate.startsWith("{") ? JSON.parse(rawTemplate) : findBuiltInTemplate(rawTemplate);
    } catch {
      throw new InputError("The narrative template is not valid JSON.", 400);
    }
    const parsedTemplate = narrativeTemplateSchema.safeParse(candidate);
    if (!parsedTemplate.success) throw new InputError("The narrative template is not valid.", 400);
    const problems = templateIssues(parsedTemplate.data);
    if (problems.length) throw new InputError(`The narrative template cannot be used: ${problems.join("; ")}.`, 400);
    template = parsedTemplate.data;
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

  return { file, apiKeys, assignments, urls, language, audience, depth, provider, model, checkpoint, template };
}

class InputError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
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
    if (!apiKey) throw new InputError(`${getProvider(assignment.provider)!.keyLabel} is required.`, 401);
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

    /**
     * PDF'i alamayan (yerel) bir model makaleyi okuyan bir aşamadaysa metin
     * ŞİMDİ çıkarılır: `pdftotext` yoksa ya da PDF bir taramaysa kullanıcı bunu
     * diğer aşamaların ücretini ödemeden önce öğrenmeli.
     */
    const readsAsText = documentTaskRoles.some((role) => providerReadsPaperAsText(input.assignments[role].provider));
    /**
     * Sayfa metni PDF'i gören sağlayıcılar için de çıkarılır: modele verilmez,
     * modelin verdiği alıntıları denetlemek için kullanılır. Orada hata ölümcül
     * değil — denetim bir güvencedir, analizin ön koşulu değil — ama sessiz de
     * değil: denetlenmeyen proje bunu söyler.
     */
    let excerptCheckSkipped: string | undefined;
    const paperPages = await extractPaperPages(input.file, signal).catch((error: unknown) => {
      if (readsAsText || signal.aborted) throw error;
      const reason = error instanceof PaperTextError ? error.reason : "failed";
      excerptCheckSkipped = {
        "missing-tool": "Quotes were not checked against the page text: pdftotext (Poppler) is not installed on the server.",
        "no-text": "Quotes were not checked against the page text: the PDF has no extractable text, it is probably a scan.",
        failed: "Quotes were not checked against the page text: the text could not be extracted from the PDF.",
      }[reason];
      return undefined;
    });
    if (paperPages && readsAsText) {
      progress({
        stage: "document",
        progress: 14,
        title: "Extracted the paper's text for the local model.",
        detail: `${paperPages.length} pages · page boundaries kept, so every claim still points at a page.`,
      });
    }

    const webResultPromise = loadWebSources(input.urls);
    const fingerprintPromise = inputFingerprint(input);
    const [webResult, fingerprint] = await Promise.all([webResultPromise, fingerprintPromise]);

    const { sources: webSources, warnings } = webResult;
    if (excerptCheckSkipped) warnings.push(excerptCheckSkipped);
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
      const paperText = paperPages && providerReadsPaperAsText(assignment.provider)
        ? renderPaperText(paperPages, passId)
        : undefined;
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
        detail: paperText?.omitted.length
          ? `${completed}/4 stages complete · pages ${paperText.omitted.join(", ")} did not fit the local model's context and were left out of this stage`
          : `${completed}/4 stages complete · waiting for the structured stream`,
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
              documentText: paperText?.text,
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
                  title: `Streaming ${evidencePassLabels[passId]}.`,
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

        /**
         * Metin elimizdeyken her alıntı sayfasında aranır. Bulunamayan alıntıya
         * dayanan iddia silinmez ama "verified" kalamaz: küçük bir yerel model
         * kulağa doğru gelen bir alıntı uydurabiliyor.
         */
        const checked = paperPages ? downgradeUnlocatedClaims(output, paperPages) : undefined;
        if (checked?.downgraded) {
          warnings.push(
            `${evidencePassLabels[passId]}: ${checked.downgraded} claim(s) quote text that could not be found on the cited page, so they were marked needs-review.`,
          );
        }
        setCheckpointPart(checkpoint, passId, checked?.output ?? output);
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
    // Kontrol noktasından gelen aşamalar da denetimden geçsin diye birleşimden
    // SONRA bir kez daha: rapor ve anlatı bu güven değerlerine göre yazılıyor.
    const merged = mergeEvidenceParts(checkpoint.parts, sources);
    const excerptChecked = paperPages ? applyExcerptCheck({ evidence: merged }, paperPages) : undefined;
    const evidence = excerptChecked?.project.evidence ?? merged;
    validateEvidenceIntegrity(evidence);

    progress({
      stage: "evidence",
      progress: 64,
      title: "The four evidence layers were merged.",
      detail: `${evidence.claims.length} claims · ${evidence.metrics.length} metrics · ${evidence.limitations.length} limitations`,
    });

    const presentation = await allocatePaperAccent(
      paperIdentityFromBytes(await input.file.arrayBuffer()),
    );
    const storyPrompt = buildStoryPrompt(evidence, {
      language: input.language,
      audience: input.audience,
      depth: input.depth,
      accent: presentation.accent,
      template: input.template,
    });
    const deepReportPrompt = buildDeepReportPrompt(evidence, {
      language: input.language,
      audience: input.audience,
      depth: input.depth,
      template: input.template,
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
              title: "Streaming the StorySpec.",
              detail: `Received ${characters.toLocaleString("en")} characters of validated narrative.`,
            });
          },
        }),
      validate: (value) => {
        validateStoryIntegrity(value, evidence, expectedSections(input));
        if (input.template) validateStoryTemplate(value, evidence, input.template);
      },
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
      validate: (value) => {
        validateDeepReportIntegrity(value, evidence, expectedReportSections(input));
        if (input.template) validateReportTemplate(value, input.template);
      },
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
    addPostTask(visualRuntime, async () => {
      story = { ...(await generateStory()), accent: presentation.accent };
    });
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
    validateStoryIntegrity(story, evidence, expectedSections(input));
    validateDeepReportIntegrity(deepReport, evidence, expectedReportSections(input));
    if (input.template) {
      validateStoryTemplate(story, evidence, input.template);
      validateReportTemplate(deepReport, input.template);
    }
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
      excerptCheck: excerptChecked?.project.excerptCheck,
      template: input.template,
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
