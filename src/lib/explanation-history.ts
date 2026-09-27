import { canonicalJson, stableHash } from "./canonical-json";
import { explainedSection, formatExplainTarget, type ExplainTarget, type ExplanationFeedback } from "./explain-back";
import type { ResearchProject } from "./schema";
import { emptyStudyProgress, MAX_EXPLANATIONS, type StudyExplanation, type StudyProgress } from "./study-path";

/**
 * Kendi cümlelerinle anlatışların geçmişi.
 *
 * Bir bölümü bir kez anlatmak, bir hafta sonra yeniden anlatmaktan az şey
 * söylüyor: okuyucu neyi eklediğini, neyi hâlâ atladığını ve neyi artık
 * söylemediğini ancak iki anlatışı yan yana görünce anlıyor. Karşılaştırma
 * modelin değil kodun işi: iki denetimin iddia kimlikleri karşılaştırılıyor.
 *
 * Geçmiş çalışma ilerlemesinde (`study.json`) duruyor, projede değil:
 * okuyucunun cümleleri paylaşılan bir JSON'la dışarı gitmiyor. Bölüm başına
 * en yeni beş anlatış, bütün makale için en çok altmış tutuluyor.
 */

export const MAX_EXPLANATIONS_PER_SECTION = 5;

/** Bölümün mührü: bölüm yeniden yazıldıysa eski anlatış başka bir metne ait. */
export function explainedSectionSignature(project: ResearchProject, target: ExplainTarget) {
  const section = explainedSection(project, target);
  return section ? stableHash(canonicalJson(section)) : "";
}

export function explanationRecord(
  project: ResearchProject,
  target: ExplainTarget,
  text: string,
  feedback: ExplanationFeedback,
  coverage: { total: number },
  model: string,
  at: string,
): StudyExplanation {
  // Yalnızca bölümün dayandığı iddialar sayılıyor; "X of Y" ile aynı küme.
  const inSection = new Set(explainedSection(project, target)?.claimIds ?? []);
  const ids = (items: Array<{ claimId: string }>) => [...new Set(items.map((item) => item.claimId))].filter((id) => inSection.has(id));
  return {
    target: formatExplainTarget(target),
    at,
    text: text.trim(),
    model: model.slice(0, 200),
    covered: ids(feedback.covered),
    missed: ids(feedback.missed),
    misstated: feedback.misstated.length,
    unsupported: feedback.unsupported.length,
    total: coverage.total,
    sig: explainedSectionSignature(project, target),
  };
}

/** Anlatışı ekler; bölümün en eski anlatışları ve toplam sınırı aşanlar düşüyor. */
export function recordExplanation(progress: StudyProgress | undefined, record: StudyExplanation, now: string): StudyProgress {
  const base = progress ?? emptyStudyProgress(now);
  const all = [...(base.explanations ?? []), record];
  const forTarget = all.filter((item) => item.target === record.target);
  const dropped = new Set(forTarget.slice(0, Math.max(0, forTarget.length - MAX_EXPLANATIONS_PER_SECTION)));
  const kept = all.filter((item) => !dropped.has(item)).slice(-MAX_EXPLANATIONS);
  return { ...base, explanations: kept, updatedAt: now };
}

/** Bir bölümün anlatışları, en yenisi önce. */
export function explanationHistory(progress: StudyProgress | undefined, target: ExplainTarget) {
  const id = formatExplainTarget(target);
  return (progress?.explanations ?? []).filter((item) => item.target === id).sort((left, right) => right.at.localeCompare(left.at));
}

/** Bir bölümün geçmişini siler; başka bir şeye dokunmuyor. */
export function forgetExplanations(progress: StudyProgress | undefined, target: ExplainTarget, now: string): StudyProgress | undefined {
  if (!progress?.explanations?.length) return progress;
  const id = formatExplainTarget(target);
  const next: StudyProgress = { ...progress, explanations: progress.explanations.filter((item) => item.target !== id), updatedAt: now };
  if (!next.explanations?.length) delete next.explanations;
  return next;
}

export type ExplanationChange = {
  previous: StudyExplanation;
  /** Önceki anlatış aynı bölüm metnine mi ait; değilse iddia kümesi değişmiş olabilir. */
  sameSection: boolean;
  /** Bu kez aktarılan, önce aktarılmayan iddialar. */
  gained: string[];
  /** Önce aktarılan, bu kez aktarılmayan iddialar. */
  lost: string[];
  /** İki kez de atlanan iddialar. */
  stillMissed: string[];
  before: { covered: number; total: number };
  after: { covered: number; total: number };
};

/** İki anlatışın farkı; iddia kimlikleri üzerinden, model yok. */
export function compareExplanations(previous: StudyExplanation, current: StudyExplanation): ExplanationChange {
  const before = new Set(previous.covered);
  const after = new Set(current.covered);
  const missedBefore = new Set(previous.missed);
  return {
    previous,
    sameSection: previous.sig === current.sig,
    gained: current.covered.filter((id) => !before.has(id)),
    lost: previous.covered.filter((id) => !after.has(id)),
    stillMissed: current.missed.filter((id) => missedBefore.has(id)),
    before: { covered: previous.covered.length, total: previous.total },
    after: { covered: current.covered.length, total: current.total },
  };
}
