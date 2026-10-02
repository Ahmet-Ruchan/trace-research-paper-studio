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
  validateLearningIntegrity,
  validateStoryIntegrity,
  validateTechnicalAppendixIntegrity,
} from "@/lib/generation-validation";
import {
  applyLearningBlock,
  learningBlockSpec,
  learningBlocksFor,
  type LearningBlockId,
  type LearningBlocks,
} from "@/lib/learning-generation";
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
import { generateLearningBlock, learningFailureReason } from "@/lib/server/learning-runner";
import { serverText } from "@/lib/server/server-text";
import { allocatePaperAccent, paperIdentityFromBytes } from "@/lib/trace-storage";
import { errorMessage } from "@/lib/user-error";

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
type ServerText = ReturnType<typeof serverText>;

function jsonError(message: string, status: number, detail?: unknown) {
  return Response.json({ error: message, detail }, { status });
}

function expectedSections(input: Pick<GenerationInput, "depth" | "template">) {
  return expectedSectionCounts(input).story;
}

function expectedReportSections(input: Pick<GenerationInput, "depth" | "template">) {
  return expectedSectionCounts(input).report;
}

async function loadWebSources(urls: string[], t: ServerText) {
  const results = await Promise.allSettled(
    urls.map((url, index) => fetchPublicSource(url, `web-${index + 1}`)),
  );
  const sources: FetchedSource[] = [];
  const warnings: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") sources.push(result.value);
    else {
      warnings.push(
        `${urls[index]}: ${errorMessage(result.reason, t.errors, t.generate.sourceUnreadable)}`,
      );
    }
  });
  return { sources, warnings };
}

function parseInput(form: FormData, t: ServerText): GenerationInput {
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
  if (!fallbackSelection) throw new InputError(t.request.modelSelectionInvalid, 400);

  let assignments: ModelTeam;
  const rawAssignments = String(form.get("assignments") ?? "");
  try {
    const parsed = rawAssignments ? JSON.parse(rawAssignments) as Record<string, unknown> : undefined;
    const chosen: Partial<ModelTeam> = {};
    for (const role of generationTaskRoles) {
      const candidate = parsed?.[role] as { provider?: unknown; model?: unknown } | undefined;
      // Öğretim rolünü göndermeyen eski bir istemcide öğretimi rapor modeli yapıyor.
      const selection = candidate
        ? resolveProviderModel(String(candidate.provider ?? ""), String(candidate.model ?? ""))
        : role === "teaching" && chosen.report ? chosen.report : fallbackSelection;
      if (!selection) throw new Error(`invalid ${role}`);
      chosen[role] = selection;
    }
    assignments = chosen as ModelTeam;
  } catch {
    throw new InputError(t.generate.assignmentInvalid, 400);
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
    throw new InputError(t.generate.keyAssignmentInvalid, 400);
  }

  if (!(file instanceof File)) throw new InputError(t.generate.pdfRequired, 400);
  if (file.type !== "application/pdf") {
    throw new InputError(t.generate.pdfOnly, 415);
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new InputError(t.request.pdfTooLarge, 413);
  }
  const documentAssignments = [assignments.evidence, assignments.technical];
  if (documentAssignments.some((assignment) => assignment.provider === "anthropic") && file.size > 24 * 1024 * 1024) {
    throw new InputError(t.generate.claudePdfLimit, 413);
  }
  /**
   * Belge okuyamayan bir sağlayıcı, makaleyi okuyan aşamalara atanamaz.
   * Yerel sunucuların dosya yükleme uçnoktası yok ve açık ağırlıklı
   * modellerin çoğu PDF'i hiç göremiyor; sessizce metinsiz devam etmek
   * kaynağa bağlı olmayan bir analiz üretirdi — Trace'in tek yapmayacağı şey.
   */
  const unreadable = documentTaskRoles.find((role) => !providerReadsDocuments(assignments[role].provider));
  if (unreadable) {
    const unreadableProvider = getProvider(assignments[unreadable].provider);
    const providerLabel = t.errors.providerName(unreadableProvider?.label ?? assignments[unreadable].provider, Boolean(unreadableProvider?.local));
    throw new InputError(t.generate.cannotReadPdf(providerLabel, unreadable), 400);
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
      throw new InputError(errorMessage(error, t.errors, t.request.localAddressInvalid), 400);
    }
  }

  const missingProvider = Object.values(assignments)
    .map((assignment) => assignment.provider)
    .find((providerId) => !apiKeys[providerId]);
  if (missingProvider) throw new InputError(t.request.keyRequired(getProvider(missingProvider)!), 401);

  let urls: string[] = [];
  try {
    const rawUrls = JSON.parse(String(form.get("sources") ?? "[]"));
    if (!Array.isArray(rawUrls)) throw new Error("array expected");
    urls = rawUrls.filter((item): item is string => typeof item === "string").slice(0, 3);
  } catch {
    throw new InputError(t.generate.sourcesInvalid, 400);
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
      throw new InputError(t.generate.templateInvalidJson, 400);
    }
    const parsedTemplate = narrativeTemplateSchema.safeParse(candidate);
    if (!parsedTemplate.success) throw new InputError(t.generate.templateInvalid, 400);
    const problems = templateIssues(parsedTemplate.data);
    if (problems.length) throw new InputError(t.generate.templateUnusable(problems.join("; ")), 400);
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
  t: ServerText,
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
    if (!apiKey) throw new InputError(t.request.keyRequired(getProvider(assignment.provider)!), 401);
    const runtime = prepareProviderRuntime(
      {
        file: input.file,
        apiKey,
        ...assignment,
        needsDocument,
        taskRole,
        progressText: t.progress,
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
      title: t.generate.preparingSources,
      detail: input.urls.length
        ? t.generate.checkingSources(input.urls.length)
        : t.generate.pdfValidated,
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
      excerptCheckSkipped = t.generate.excerptCheckSkipped[reason];
      return undefined;
    });
    if (paperPages && readsAsText) {
      progress({
        stage: "document",
        progress: 14,
        title: t.generate.textExtracted,
        detail: t.generate.textExtractedDetail(paperPages.length),
      });
    }

    const webResultPromise = loadWebSources(input.urls, t);
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
        title: t.generate.resuming,
        detail: t.generate.resumingDetail(completed),
      });
      emit({ type: "checkpoint", checkpoint, completed: completedPasses(checkpoint) });
    } else {
      progress({
        stage: "evidence",
        progress: 27,
        title: t.generate.splitting,
        detail: t.generate.splittingDetail,
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
        title: t.generate.extracting(passId),
        detail: paperText?.omitted.length
          ? t.generate.passOmitted(completed, paperText.omitted.join(", "))
          : t.generate.passWaiting(completed),
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
                  title: t.generate.streamingPass(passId),
                  detail: t.generate.passReceived(characters, completed),
                });
              },
            }),
          validate: (value) => validateEvidencePass(passId, value, sourceIds),
          onStructureRetry: (attempt, issues) =>
            progress({
              stage: "evidence",
              progress: evidenceHighWater,
              title: t.generate.recheckingPass(passId),
              detail: t.retry.structure(issues.length, attempt),
              attempt,
            }),
          onNetworkRetry: (attempt) =>
            progress({
              stage: "evidence",
              progress: evidenceHighWater,
              title: t.generate.reconnectingPass(passId),
              detail: t.retry.network(attempt, MAX_NETWORK_ATTEMPTS),
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
          warnings.push(t.generate.downgraded(passId, checked.downgraded));
        }
        setCheckpointPart(checkpoint, passId, checked?.output ?? output);
        completed += 1;
        evidenceHighWater = Math.max(evidenceHighWater, 27 + completed * 8.5);
        emit({ type: "checkpoint", checkpoint, completed: completedPasses(checkpoint) });
        progress({
          stage: "evidence",
          progress: evidenceHighWater,
          title: t.generate.passValidated(passId),
          detail: t.generate.passValidatedDetail(completed),
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
    if (!overview) throw new Error(t.generate.overviewMissing);
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
      title: t.generate.merged,
      detail: t.generate.mergedDetail(evidence.claims.length, evidence.metrics.length, evidence.limitations.length),
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
    const learningPlan = learningBlocksFor(input.depth);
    let learningHighWater = 69;
    let lastLearningNotice = 0;
    /**
     * Şeritler paralel ilerliyor ve her biri kendi olayını yazıyor. Çubuk en
     * geride kalan şeridi gösteriyor: yalnızca ileri gidiyor, öne geçen bir
     * şerit onu geri zıplatmıyor.
     */
    const specialistProgress = () => Math.min(storyHighWater, reportHighWater, learningHighWater);
    const storyStartedAt = Date.now();
    progress({
      stage: "story",
      progress: specialistProgress(),
      title: t.generate.designing,
      detail: t.generate.designingDetail,
    });
    const [visualRuntime, reportRuntime, technicalRuntime] = await Promise.all([
      getRuntime("visual"),
      getRuntime("report"),
      getRuntime("technical", false),
    ]);
    // Öğretim modeli hazırlanamıyorsa (ör. kapalı bir yerel sunucu) analiz
    // yine tamamlanıyor; katman eksik kalıyor ve bu söyleniyor.
    let teachingUnavailable: string | undefined;
    const teachingRuntime = await getRuntime("teaching", false).catch((error: unknown) => {
      if (signal.aborted) throw error;
      teachingUnavailable = learningFailureReason(error, t.errors);
      console.error("Trace generation stage", { stage: "learning", outcome: "skipped", ...safeDiagnostic(error) });
      return undefined;
    });
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
              progress: specialistProgress(),
              title: t.generate.streamingStory,
              detail: t.generate.storyReceived(characters),
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
          progress: specialistProgress(),
          title: t.generate.relinkingStory,
          detail: t.generate.storyRetry(issues.length, attempt),
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "story",
          progress: specialistProgress(),
          title: t.generate.reconnectingStory,
          detail: t.retry.network(attempt, MAX_NETWORK_ATTEMPTS),
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
              progress: specialistProgress(),
              title: t.generate.streamingReport,
              detail: t.generate.reportReceived(characters),
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
          progress: specialistProgress(),
          title: t.generate.relinkingReport,
          detail: t.generate.reportRetry(issues.length, attempt),
          attempt,
        }),
      onNetworkRetry: (attempt) =>
        progress({
          stage: "story",
          progress: specialistProgress(),
          title: t.generate.reconnectingReport,
          detail: t.retry.network(attempt, MAX_NETWORK_ATTEMPTS),
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
              progress: specialistProgress(),
              title: t.generate.preparingTechnical,
              detail: t.generate.technicalReceived(characters),
            });
          },
        }),
      validate: (value) => validateTechnicalAppendixIntegrity(value, evidence),
      onStructureRetry: (attempt, issues) => progress({
        stage: "story",
        progress: specialistProgress(),
        title: t.generate.relinkingTechnical,
        detail: t.generate.technicalRetry(issues.length, attempt),
        attempt,
      }),
      onNetworkRetry: (attempt) => progress({
        stage: "story",
        progress: specialistProgress(),
        title: t.generate.reconnectingTechnical,
        detail: t.retry.network(attempt, MAX_NETWORK_ATTEMPTS),
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
    /**
     * Türetimler ve oyun alanları teknik ekin denklemlerine dayanıyor. Teknik
     * ek başka bir şeritte yazılıyorsa öğretim şeridi onu bekliyor; aynı
     * şeritteyse zaten önce geliyor (görevler eklendiği sırayla çalışıyor ve
     * teknik ek öğretimden önce ekleniyor), yani bekleme kilitlenmiyor.
     */
    let appendixSettled: (value: TechnicalAppendix | undefined) => void = () => undefined;
    const appendixReady = new Promise<TechnicalAppendix | undefined>((resolve) => { appendixSettled = resolve; });
    addPostTask(visualRuntime, async () => {
      story = { ...(await generateStory()), accent: presentation.accent };
    });
    addPostTask(reportRuntime, async () => { deepReport = await generateReport(); });
    addPostTask(technicalRuntime, async () => {
      try {
        technicalAppendix = await generateTechnical();
      } finally {
        appendixSettled(technicalAppendix);
      }
    });

    /**
     * Öğrenme katmanı analizi düşürmüyor: bir blok iki denemede de denetimden
     * geçemezse ya da öğretim modeli hata verirse o blok atlanıyor ve kullanıcı
     * bir uyarıyla, eksik parçayı Lab'den ekleyebileceğini öğreniyor. İptal
     * ise her şeyi durduruyor.
     */
    const learning: LearningBlocks = {};
    const unavailableReason = teachingUnavailable;
    const learningFailures: Array<{ block: LearningBlockId; reason: string }> = unavailableReason
      ? learningPlan.map((block) => ({ block, reason: unavailableReason }))
      : [];
    let learningDone = 0;
    const learningStartedAt = Date.now();
    const teachingTasks = teachingRuntime ? learningPlan.map((block) => ({ block, lane: teachingRuntime })) : [];
    for (const { block, lane } of teachingTasks) {
      addPostTask(lane, async () => {
        const spec = learningBlockSpec(block);
        const appendix = spec.usesTechnicalAppendix ? await appendixReady : undefined;
        const step = learningDone + 1;
        progress({
          stage: "story",
          progress: specialistProgress(),
          title: t.learningLayer.writing(block),
          detail: t.generate.learningStep(step, learningPlan.length),
        });
        try {
          const value = await generateLearningBlock(block, lane, {
            evidence,
            depth: input.depth,
            language: input.language,
            audience: input.audience,
            technicalAppendix: appendix,
          }, signal, {
            onChunk: (characters) => {
              markProviderActivity();
              const now = Date.now();
              if (now - lastLearningNotice < 900) return;
              lastLearningNotice = now;
              const partial = Math.min(0.9, characters / 7_000);
              learningHighWater = Math.max(learningHighWater, 69 + ((learningDone + partial) / learningPlan.length) * 17);
              progress({
                stage: "story",
                progress: specialistProgress(),
                title: t.learningLayer.writing(block),
                detail: t.generate.learningReceived(characters, step, learningPlan.length),
              });
            },
            onStructureRetry: (attempt, issues) => progress({
              stage: "story",
              progress: specialistProgress(),
              title: t.learningLayer.relinking(block),
              detail: t.retry.structure(issues.length, attempt),
              attempt,
            }),
            onNetworkRetry: (attempt) => progress({
              stage: "story",
              progress: specialistProgress(),
              title: t.learningLayer.reconnecting(block),
              detail: t.retry.network(attempt, MAX_NETWORK_ATTEMPTS),
              attempt,
            }),
          });
          Object.assign(learning, applyLearningBlock(block, value));
        } catch (error) {
          if (signal.aborted) throw error;
          learningFailures.push({ block, reason: learningFailureReason(error, t.errors) });
          console.error("Trace generation stage", {
            stage: `learning:${block}`,
            fallbackProvider: input.assignments.teaching.provider,
            fallbackModel: input.assignments.teaching.model,
            outcome: "skipped",
            ...safeDiagnostic(error),
          });
        } finally {
          learningDone += 1;
          learningHighWater = Math.max(learningHighWater, 69 + (learningDone / learningPlan.length) * 17);
        }
      });
    }
    if (!learningPlan.length || !teachingRuntime) learningHighWater = 86;

    await Promise.all([...groupedTasks.values()].map(async (tasks) => {
      for (const task of tasks) await task();
    }));
    if (!story || !deepReport || !technicalAppendix) {
      throw new Error(t.generate.missingOutputs);
    }
    const learningGap = t.learningLayer.gaps(learningFailures);
    if (learningGap) warnings.push(learningGap);
    console.info("Trace generation stage", {
      stage: "learning",
      durationMs: Date.now() - learningStartedAt,
      model: input.assignments.teaching.model,
      written: Object.keys(learning),
      skipped: learningFailures.map((failure) => failure.block),
    });
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
      title: t.generate.finalCheck,
      detail: t.generate.finalCheckDetail,
    });
    validateEvidenceIntegrity(evidence);
    validateStoryIntegrity(story, evidence, expectedSections(input));
    validateDeepReportIntegrity(deepReport, evidence, expectedReportSections(input));
    if (input.template) {
      validateStoryTemplate(story, evidence, input.template);
      validateReportTemplate(deepReport, input.template);
    }
    validateTechnicalAppendixIntegrity(technicalAppendix, evidence);
    validateLearningIntegrity({ evidence, depth: input.depth, technicalAppendix, ...learning });

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
      ...learning,
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
          teaching: { ...input.assignments.teaching, model: teachingRuntime?.effectiveModel ?? input.assignments.teaching.model },
        },
      },
    });

    progress({
      stage: "finalize",
      progress: 97,
      title: t.generate.cleaning,
      detail: t.generate.cleaningDetail(runtimePromises.size),
    });
    await cleanupRuntimes();

    emit({ type: "result", project, warnings });
  } finally {
    clearInterval(heartbeat);
    await cleanupRuntimes();
  }
}

export async function POST(request: Request) {
  const t = serverText(request);
  let input: GenerationInput;
  try {
    input = parseInput(await request.formData(), t);
  } catch (error) {
    if (error instanceof InputError) return jsonError(error.message, error.status);
    return jsonError(t.request.formDataUnreadable, 400);
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
        await runPipeline(input, request.signal, emit, t);
      } catch (error) {
        const message = publicError(error, request.signal.aborted, input.provider, t.errors);
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
