import { z } from "zod";
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
