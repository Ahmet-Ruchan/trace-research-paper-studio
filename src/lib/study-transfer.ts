import { z } from "zod";
import type { StudyReview } from "./review-schedule";
import type { ResearchProject } from "./schema";
import { MAX_ENTRIES, MAX_REVIEW_DAYS, studyProgressSchema, trimExplanations, type ReviewDay, type StudyAnswer, type StudyProgress } from "./study-path";

/**
 * Çalışma ilerlemesini taşımak.
 *
 * Yayınlanan ve dışa aktarılan sayfada ilerleme tarayıcıda duruyor: telefonda
 * başlanan çalışma dizüstünde yok, stüdyodaki de yayınlanan sayfada yok. Bir
 * dosya ikisini birleştiriyor: "Save progress to a file" ilerlemeyi indiriyor,
 * "Load progress from a file" onu buradakiyle BİRLEŞTİRİYOR (üzerine yazmıyor):
 * iki cihazda ayrı ayrı çalışılan adımlar da, tekrar kartlarının en ileri
 * hâli de kalıyor.
 *
 * Dosya yalnızca okuyucunun ilerlemesini taşıyor, makaleyi değil; yalnızca
 * aynı makaleye (proje kimliği) yükleniyor.
 */

export const STUDY_TRANSFER_KIND = "trace-study-progress";

export const studyTransferSchema = z.object({
  kind: z.literal(STUDY_TRANSFER_KIND),
  version: z.literal(1),
  projectId: z.string().min(1).max(300),
  paperTitle: z.string().max(600),
  exportedAt: z.string().max(40),
  progress: studyProgressSchema,
});
export type StudyTransfer = z.infer<typeof studyTransferSchema>;

export function studyTransferFile(project: Pick<ResearchProject, "id" | "evidence">, progress: StudyProgress, now: string): StudyTransfer {
  return { kind: STUDY_TRANSFER_KIND, version: 1, projectId: project.id, paperTitle: project.evidence.paper.title, exportedAt: now, progress };
}

export function studyTransferFileName(project: Pick<ResearchProject, "evidence">) {
  const slug = project.evidence.paper.title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "paper";
  return `${slug}.trace-progress.json`;
}

export type StudyTransferOutcome =
  | { ok: true; progress: StudyProgress }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "other-paper"; paperTitle: string };

export function readStudyTransfer(raw: unknown, project: Pick<ResearchProject, "id">): StudyTransferOutcome {
  const parsed = studyTransferSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  if (parsed.data.projectId !== project.id) return { ok: false, reason: "other-paper", paperTitle: parsed.data.paperTitle };
  return { ok: true, progress: parsed.data.progress };
}

const later = (left: string | undefined, right: string | undefined) => (left ?? "") >= (right ?? "");

/** Aynı soruya iki yanıt: en son verilen. */
function pickAnswer(left: StudyAnswer, right: StudyAnswer) {
  return later(left.at, right.at) ? left : right;
}

/** Aynı kart iki cihazda: daha çok tekrarlanan, eşitse en son tekrarlanan. */
function pickReview(left: StudyReview, right: StudyReview) {
  if (left.reviews !== right.reviews) return left.reviews > right.reviews ? left : right;
  return later(left.last, right.last) ? left : right;
}

/**
 * Aynı günün tekrarları iki cihazda: toplamak aynı dosyayı iki kez yüklemekte
 * iki kat sayardı; büyük olan tutuluyor (az sayabilir, fazla saymaz).
 */
function mergeReviewDays(left: readonly ReviewDay[], right: readonly ReviewDay[]) {
  const merged = new Map<string, ReviewDay>();
  for (const item of [...left, ...right]) {
    const existing = merged.get(item.day);
    merged.set(item.day, !existing || item.reviewed > existing.reviewed || (item.reviewed === existing.reviewed && item.remembered > existing.remembered) ? item : existing);
  }
  return [...merged.values()].sort((first, second) => first.day.localeCompare(second.day)).slice(-MAX_REVIEW_DAYS);
}

function byId<T extends { id: string }>(left: readonly T[], right: readonly T[], pick: (a: T, b: T) => T) {
  const merged = new Map<string, T>();
  for (const item of [...left, ...right]) {
    const existing = merged.get(item.id);
    merged.set(item.id, existing ? pick(existing, item) : item);
  }
  return [...merged.values()];
}

/**
 * İki ilerlemeyi birleştiriyor: bitmiş adımların birleşimi, her soru için en
 * son yanıt, her kart için en ileri hâli, bütün anlatışlar (sınırlar içinde).
 * Kalınan adım en son güncellenen taraftan.
 */
export function mergeStudyProgress(current: StudyProgress | undefined, incoming: StudyProgress, now: string): StudyProgress {
  if (!current) return { ...incoming, updatedAt: now };
  const newer = later(incoming.updatedAt, current.updatedAt) ? incoming : current;
  const finished = [current.finishedAt, incoming.finishedAt].filter((value): value is string => Boolean(value)).sort()[0];
  const explanations = new Map<string, NonNullable<StudyProgress["explanations"]>[number]>();
  for (const item of [...(current.explanations ?? []), ...(incoming.explanations ?? [])]) explanations.set(`${item.target}\u0000${item.at}\u0000${item.text}`, item);
  const reviews = byId(current.reviews ?? [], incoming.reviews ?? [], pickReview).slice(-MAX_ENTRIES);
  const reviewDays = mergeReviewDays(current.reviewDays ?? [], incoming.reviewDays ?? []);
  const merged: StudyProgress = {
    version: 1,
    ...(newer.current ? { current: newer.current } : {}),
    done: [...new Set([...current.done, ...incoming.done])].slice(-MAX_ENTRIES),
    answers: byId(current.answers, incoming.answers, pickAnswer).slice(-MAX_ENTRIES),
    startedAt: [current.startedAt, incoming.startedAt].sort()[0],
    updatedAt: now,
    ...(finished ? { finishedAt: finished } : {}),
    ...(reviews.length ? { reviews } : {}),
    ...(explanations.size ? { explanations: trimExplanations([...explanations.values()]) } : {}),
    ...(reviewDays.length ? { reviewDays } : {}),
  };
  return studyProgressSchema.parse(merged);
}
