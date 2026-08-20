import { researchProjectSchema, type ResearchProject } from "./schema";
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

const storyTarget = { concise: 5, standard: 6, deep: 8 } as const;
const reportTarget = { concise: 6, standard: 7, deep: 9 } as const;

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

  run(() => validateEvidenceIntegrity(project.evidence));
  run(() => validateStoryIntegrity(project.story, project.evidence, storyTarget[project.depth]));
  if (project.deepReport) {
    run(() => validateDeepReportIntegrity(project.deepReport!, project.evidence, reportTarget[project.depth]));
  }
  if (project.technicalAppendix) {
    run(() => validateTechnicalAppendixIntegrity(project.technicalAppendix!, project.evidence));
  }
  run(() => validateLearningIntegrity(project, options));

  return issues.length ? { ok: false, issues } : { ok: true, project };
}
