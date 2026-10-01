import { z } from "zod";
import { untracedLearningNumbers } from "./learning-numbers";
import { expectedSectionCounts } from "./section-budgets";
import { reportTemplateIssues, storyTemplateIssues, templateIssues } from "./narrative-templates";
export {
  builtInTemplates,
  findBuiltInTemplate,
  narrativeTemplateSchema,
  templateFromProject,
  templateIssues,
  templateReportInstructions,
  templateStoryInstructions,
} from "./narrative-templates";
export { expectedSectionCounts } from "./section-budgets";
export { evidenceHealth } from "./evidence-health";
export { applyExcerptCheck, splitPages } from "./paper-text";
export { ankiCards, buildAnkiDeck } from "./anki-export";
export { exportDefinitions, findExport } from "./exports";
export { libraryModelRecord } from "./model-record";
export { conceptLinks, libraryPaperFor, paperKey, sharedConcepts, suggestReferences } from "./concept-links";
export { isStudyFile, parseStudyFile } from "./study-path";
export { readFirst, readingOrder } from "./reading-order";
export { aliasMap, decideAlias, forgetAlias, isAliasFile, parseAliasFile } from "./concept-aliases";
export { aliasBatches, conceptNames } from "./alias-proposals";
export { conceptKeys } from "./concept-links";
export { learningStats } from "./learning-stats";
export { REVIEW_INTERVALS_DAYS } from "./review-schedule";
export { cardText } from "./review-queue";
export { displayName, parseProfile } from "./profile";
export { addDaysLocal, dailyTotals, dayKey, formatDuration, parseWorkLog, startOfWeek, timeByProject, workSummary } from "./work-log";
export { hourPattern, PATTERN_WEEKS, weekReport } from "./work-report";
export { todayBrief } from "./today";
export { sessionsIcs } from "./work-export";
export { libraryVault } from "./obsidian-vault";
export { answerChatCard, chatReviewQueue, showChatCard } from "./chat-review";
export { notesFileName, notesMarkdown, parseNotesFile } from "./reader-notes";
export { claimSearchTool, LIBRARY_MCP_TOOLS, libraryTool, notesTool, paperTool, TraceToolError } from "./mcp-tools";
export { parseLibraryTags } from "./library-tags";
export { formatLabel, importPlan, parseReferenceFile } from "./reference-import";
export { addAllToReadingList, addToReadingList, isReadingListFile, mergeReadingOrder, parseReadingList, readingItemSchema, readingListToJson, removeFromReadingList, savedFrom, savedReason, workKey } from "./reading-list";
export {
  defaultPublicationInclude,
  expiryFromDays,
  projectContentFingerprint,
  projectForPublication,
  publicationPath,
  publicationRecordSchema,
} from "./publications";
export {
  isRevisionFileName,
  revisionFileName,
  revisionId,
  revisionRecordSchema,
  revisionsToPrune,
  shouldSnapshot,
} from "./project-revisions";
import { researchProjectSchema, type ResearchProject } from "./schema";
import {
  MAX_REGENERATION_INSTRUCTION,
  buildSectionRegenerationPrompt,
  claimPolicySchema,
  evidenceFingerprint,
  findSection,
  formatSectionTarget,
  parseSectionTarget,
  regenerationGoalSchema,
  sectionTargetSchema,
  spliceSection,
  type RegeneratedSection,
} from "./section-regeneration";
import {
  MAX_EXPLANATION_LENGTH,
  MIN_EXPLANATION_LENGTH,
  buildExplainPrompt,
  explainedSection,
  explanationCoverage,
  explanationFeedbackSchema,
  formatExplainTarget,
  parseExplainTarget,
  validateExplanationFeedback,
} from "./explain-back";
import { compareExplanations, explanationHistory, explanationRecord, recordExplanation } from "./explanation-history";
import { parseStudyFile, studyFileToJson } from "./study-path";
import {
  describeValidationError,
  validateDeepReportIntegrity,
  validateEvidenceIntegrity,
  validateLearningIntegrity,
  validateStoryIntegrity,
  validateTechnicalAppendixIntegrity,
} from "./generation-validation";

/**
 * Plugin doğrulayıcısının giriş noktası.
 *
 * NEDEN BÖYLE: Plugin eskiden Zod kurallarının ~380 satırlık elle yazılmış bir
 * KOPYASINI taşıyordu. Kopya kaçınılmaz olarak sapmıştı — üst sınırlar hiç
 * denetlenmiyordu, dolayısıyla `validate` "ok" derken web uygulaması aynı
 * dosyayı reddediyordu.
 *
 * Artık kopya yok: bu dosya rolldown ile paketlenip plugin'e gömülüyor, yani
 * plugin AYNI şemayı ve AYNI bütünlük fonksiyonlarını çalıştırıyor. Parite
 * bir test konusu değil, yapısal bir garanti.
 */

export type ValidationOutcome =
  | { ok: true; project: ResearchProject }
  | { ok: false; issues: string[] };


export function validateProjectObject(
  input: unknown,
  options: { requireDepthBlocks?: boolean } = {},
): ValidationOutcome {
  const parsed = researchProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      ),
    };
  }

  const project = parsed.data;
  const issues: string[] = [];

  const run = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      issues.push(...describeValidationError(error));
    }
  };

  const counts = expectedSectionCounts(project);
  run(() => validateEvidenceIntegrity(project.evidence));
  run(() => validateStoryIntegrity(project.story, project.evidence, counts.story));
  if (project.deepReport) {
    run(() => validateDeepReportIntegrity(project.deepReport!, project.evidence, counts.report));
  }
  if (project.template) {
    issues.push(...templateIssues(project.template).map((issue) => `template: ${issue}`));
    issues.push(...storyTemplateIssues(project.story, project.evidence, project.template));
    if (project.deepReport) issues.push(...reportTemplateIssues(project.deepReport, project.template));
  }
  if (project.technicalAppendix) {
    run(() => validateTechnicalAppendixIntegrity(project.technicalAppendix!, project.evidence));
  }
  run(() => validateLearningIntegrity(project, options));
  // Sıkı denetim (teslimden önce) öğrenme katmanındaki sayıların kanıttan
  // geldiğini de istiyor; stüdyonun ürettiği katman aynı kurala tabi.
  if (options.requireDepthBlocks) issues.push(...untracedLearningNumbers(project));

  return issues.length ? { ok: false, issues } : { ok: true, project };
}

/* ------------------------------------------------------------------ *
 * Bölüm yeniden üretimi — plugin tarafı
 *
 * Web uygulaması modeli kendisi çağırıyor; plugin'de modeli ajan çalıştırıyor.
 * Akış bu yüzden ikiye bölünüyor: `buildSectionBrief` ajana istemi ve kilidi
 * veriyor, ajan bölümü yazıyor, `spliceSectionObject` onu AYNI takma
 * fonksiyonuyla projeye takıyor. Kilit bir belgede yazılı bir rica değil;
 * uygulamadaki kodun kendisi.
 * ------------------------------------------------------------------ */

const sectionBriefSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  target: z.string(),
  claimPolicy: claimPolicySchema,
  /** Eski özetlerde yok; o zaman düz yeniden yazım. */
  goal: regenerationGoalSchema.default("revise"),
  instruction: z.string().max(MAX_REGENERATION_INSTRUCTION),
  evidenceFingerprint: z.string(),
  prompt: z.string(),
  currentSection: z.unknown(),
});

export type SectionBrief = z.infer<typeof sectionBriefSchema>;

type Outcome<T> = { ok: true } & T | { ok: false; issues: string[] };

function parseProject(input: unknown): Outcome<{ project: ResearchProject }> {
  const parsed = researchProjectSchema.safeParse(input);
  if (parsed.success) return { ok: true, project: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
  };
}

export function buildSectionBrief(
  input: unknown,
  rawTarget: string,
  options: { claimPolicy?: string; instruction?: string; goal?: string } = {},
): Outcome<{ brief: SectionBrief }> {
  const parsed = parseProject(input);
  if (!parsed.ok) return parsed;
  const { project } = parsed;
  try {
    const target = parseSectionTarget(rawTarget);
    const goal = regenerationGoalSchema.safeParse(options.goal ?? "revise");
    if (!goal.success) return { ok: false, issues: ['--goal must be "revise" or "strengthen"'] };
    // Güçlendirme başka iddialara dayanmayı gerektiriyor; açıkça kilit istenmediyse açık politika.
    const policy = claimPolicySchema.safeParse(options.claimPolicy ?? (goal.data === "strengthen" ? "open" : "locked"));
    if (!policy.success) return { ok: false, issues: ['--claims must be "locked" or "open"'] };
    const instruction = (options.instruction ?? "").trim();
    if (instruction.length > MAX_REGENERATION_INSTRUCTION) {
      return { ok: false, issues: [`The instruction is longer than ${MAX_REGENERATION_INSTRUCTION} characters`] };
    }
    const currentSection = findSection(project, target);
    const prompt = buildSectionRegenerationPrompt(project, target, { claimPolicy: policy.data, instruction, goal: goal.data });
    return {
      ok: true,
      brief: {
        version: 1,
        projectId: project.id,
        target: formatSectionTarget(sectionTargetSchema.parse(target)),
        claimPolicy: policy.data,
        goal: goal.data,
        instruction,
        evidenceFingerprint: evidenceFingerprint(project.evidence),
        prompt,
        currentSection,
      },
    };
  } catch (error) {
    return { ok: false, issues: describeValidationError(error) };
  }
}

export function spliceSectionObject(
  input: unknown,
  rawBrief: unknown,
  section: unknown,
  options: { now?: string } = {},
): Outcome<{ project: ResearchProject; previous: RegeneratedSection }> {
  const parsed = parseProject(input);
  if (!parsed.ok) return parsed;
  const brief = sectionBriefSchema.safeParse(rawBrief);
  if (!brief.success) {
    return { ok: false, issues: ["The brief is not a Trace section brief; create it with the section command"] };
  }
  const { project } = parsed;
  if (brief.data.projectId !== project.id) {
    return { ok: false, issues: [`The brief belongs to project ${brief.data.projectId}, not ${project.id}`] };
  }
  try {
    const target = parseSectionTarget(brief.data.target);
    const previous = findSection(project, target);
    const next = spliceSection(project, target, section, {
      claimPolicy: brief.data.claimPolicy,
      expectedFingerprint: brief.data.evidenceFingerprint,
      goal: brief.data.goal,
      now: options.now,
    });
    return { ok: true, project: next, previous: previous! };
  } catch (error) {
    return { ok: false, issues: describeValidationError(error) };
  }
}

/* ------------------------------------------------------------------ *
 * "Kendi cümlelerinle anlat" — plugin tarafı
 *
 * Stüdyoda modeli uygulama çağırıyor; plugin'de ajanın kendi modeli. Akış
 * bölüm yeniden üretimi gibi ikiye bölünüyor: `buildExplanationBrief` ajana
 * yalnızca kanıtı içeren istemi veriyor, ajan geri bildirimi yazıyor,
 * `checkExplanationFeedback` onu stüdyonun kullandığı AYNI denetimden
 * geçiriyor (iddialar var mı, alıntılar okuyucunun metninde birebir geçiyor mu).
 * ------------------------------------------------------------------ */

const explanationBriefSchema = z.object({
  version: z.literal(1),
  kind: z.literal("explanation"),
  projectId: z.string(),
  target: z.string(),
  text: z.string().min(MIN_EXPLANATION_LENGTH).max(MAX_EXPLANATION_LENGTH),
  evidenceFingerprint: z.string(),
  prompt: z.string(),
});

export type ExplanationBrief = z.infer<typeof explanationBriefSchema>;

export function buildExplanationBrief(input: unknown, rawTarget: string, rawText: string): Outcome<{ brief: ExplanationBrief }> {
  const parsed = parseProject(input);
  if (!parsed.ok) return parsed;
  const { project } = parsed;
  const text = rawText.trim();
  if (text.length < MIN_EXPLANATION_LENGTH || text.length > MAX_EXPLANATION_LENGTH) {
    return { ok: false, issues: [`The explanation must be ${MIN_EXPLANATION_LENGTH}–${MAX_EXPLANATION_LENGTH} characters; it is ${text.length}`] };
  }
  try {
    const target = parseExplainTarget(rawTarget);
    if (!explainedSection(project, target)) return { ok: false, issues: [`There is no ${target.kind} section with the id ${target.sectionId}`] };
    return {
      ok: true,
      brief: {
        version: 1,
        kind: "explanation",
        projectId: project.id,
        target: formatExplainTarget(target),
        text,
        evidenceFingerprint: evidenceFingerprint(project.evidence),
        prompt: buildExplainPrompt(project, target, text),
      },
    };
  } catch (error) {
    return { ok: false, issues: describeValidationError(error) };
  }
}

/**
 * Denetlenmiş bir anlatışı çalışma kaydına ekler (`explanation-history.ts`):
 * stüdyo "Your earlier explanations" altında gösteriyor, bir sonraki anlatış
 * onunla karşılaştırılıyor. Çağıran önce `checkExplanationFeedback` ile
 * denetlemiş olmalı. Aynı metin iki kez kaydedilmiyor. `file` çalışma
 * dosyasının yeni hâli; çağıran kilidin altında yazıyor.
 */
export function recordCheckedExplanation(input: unknown, rawBrief: unknown, rawFeedback: unknown, rawStudyFile: unknown, model: string, now: string) {
  const parsed = parseProject(input);
  if (!parsed.ok) return parsed;
  const { project } = parsed;
  const brief = explanationBriefSchema.safeParse(rawBrief);
  const feedback = explanationFeedbackSchema.safeParse(rawFeedback);
  if (!brief.success || !feedback.success) return { ok: false as const, issues: ["Run explain-check first; the brief or the feedback is not valid"] };
  const target = parseExplainTarget(brief.data.target);
  const record = explanationRecord(project, target, brief.data.text, feedback.data, explanationCoverage(project, target, feedback.data), model, now);
  const study = parseStudyFile(rawStudyFile);
  const history = explanationHistory(study.get(project.id), target);
  const duplicate = Boolean(history[0] && history[0].text === record.text && history[0].sig === record.sig);
  if (!duplicate) study.set(project.id, recordExplanation(study.get(project.id), record, now));
  const latest = duplicate ? history[0] : record;
  const previous = duplicate ? history[1] : history[0];
  const change = previous ? compareExplanations(previous, latest) : undefined;
  const claim = (id: string) => {
    const found = project.evidence.claims.find((item) => item.id === id);
    return { claimId: id, statement: found?.statement ?? "", page: found?.sourceRefs[0]?.page ?? null };
  };
  return {
    ok: true as const,
    duplicate,
    file: studyFileToJson(study),
    explanations: explanationHistory(study.get(project.id), target).length,
    sinceLast: change
      ? {
          at: change.previous.at,
          sameSection: change.sameSection,
          before: change.before,
          after: change.after,
          conveyedThisTimeNotLast: change.gained.map(claim),
          conveyedLastTimeNotThis: change.lost.map(claim),
          leftOutBothTimes: change.stillMissed.map(claim),
        }
      : null,
  };
}

export function checkExplanationFeedback(input: unknown, rawBrief: unknown, rawFeedback: unknown) {
  const parsed = parseProject(input);
  if (!parsed.ok) return parsed;
  const brief = explanationBriefSchema.safeParse(rawBrief);
  if (!brief.success) return { ok: false as const, issues: ["The brief is not a Trace explanation brief; create it with the explain command"] };
  const { project } = parsed;
  if (brief.data.projectId !== project.id) return { ok: false as const, issues: [`The brief belongs to project ${brief.data.projectId}, not ${project.id}`] };
  if (brief.data.evidenceFingerprint !== evidenceFingerprint(project.evidence)) {
    return { ok: false as const, issues: ["The project's evidence changed after the brief was written; run explain again"] };
  }
  const feedback = explanationFeedbackSchema.safeParse(rawFeedback);
  if (!feedback.success) {
    return { ok: false as const, issues: feedback.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`) };
  }
  try {
    const target = parseExplainTarget(brief.data.target);
    validateExplanationFeedback(project, target, brief.data.text, feedback.data);
    const claim = (id: string) => {
      const found = project.evidence.claims.find((item) => item.id === id);
      return { claimId: id, statement: found?.statement ?? "", page: found?.sourceRefs[0]?.page ?? null, confidence: found?.confidence };
    };
    return {
      ok: true as const,
      target: brief.data.target,
      section: explainedSection(project, target)!.title,
      coverage: explanationCoverage(project, target, feedback.data),
      summary: feedback.data.summary,
      conveyed: feedback.data.covered.map((item) => ({ ...claim(item.claimId), note: item.note })),
      leftOut: feedback.data.missed.map((item) => ({ ...claim(item.claimId), note: item.note })),
      saidOtherwise: feedback.data.misstated.map((item) => ({ quote: item.quote, correction: item.correction, ...claim(item.claimId) })),
      notInEvidence: feedback.data.unsupported,
    };
  } catch (error) {
    return { ok: false as const, issues: describeValidationError(error) };
  }
}
