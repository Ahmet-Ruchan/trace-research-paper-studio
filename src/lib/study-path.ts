import { z } from "zod";
import { canonicalJson, stableHash } from "./canonical-json";
import { conceptCardId, questionCardId, scheduleFirst, studyReviewSchema, type StudyReview } from "./review-schedule";
import type { Primer, Quiz, QuizQuestion, ResearchProject } from "./schema";

/**
 * Rehberli çalışma: makaleyi bir öğrenme yolu olarak baştan sona yürümek.
 *
 * Lab her şeyi yan yana koyuyor; okuyucu nereden başlayacağını, bir bölümü
 * anlayıp anlamadığını ve nerede kaldığını kendisi bulmak zorundaydı. Bu yol
 * projenin kendi içeriğinden kuruluyor, model gerekmiyor:
 *
 *   hazırlan — soru ve tez, sonra makalenin varsaydığı kavramlar (ön koşul sırasıyla)
 *   oku      — hikâye bölümleri; her birinin ardından aynı iddialara dayanan bir soru
 *   çalış    — türetimler ve etkileşimli keşifler
 *   sına     — sık yapılan yanlış okumalar ve bölümlere dağıtılmamış quiz soruları
 *   uygula   — uygulama rehberi
 *   gözden geçir — ilk denemede kaçan yerler ve atlananlar
 *
 * Bölüm sorusu önce quiz'den, yoksa kanıttan üretilen okuma alıştırmasından
 * seçiliyor; böylece öğrenme katmanı olmayan bir projede de her bölüm bir
 * soruyla bitebiliyor.
 */

export type StudyPhase = "prepare" | "read" | "work" | "check" | "apply" | "review";

export type StudyStep =
  | { id: "start"; kind: "start"; phase: "prepare" }
  | { id: string; kind: "concept"; phase: "prepare"; conceptId: string; title: string }
  | { id: string; kind: "section"; phase: "read"; sectionId: string; title: string; checkId?: string }
  | { id: string; kind: "derivation"; phase: "work"; derivationId: string; title: string }
  | { id: string; kind: "interactive"; phase: "work"; interactiveId: string; title: string }
  | { id: "misreadings"; kind: "misreadings"; phase: "check"; title: string }
  | { id: "quiz"; kind: "quiz"; phase: "check"; questionIds: string[] }
  | { id: "guide"; kind: "guide"; phase: "apply"; title: string }
  | { id: "finish"; kind: "finish"; phase: "review" };

export type StudyPath = {
  steps: StudyStep[];
  /** Yoldaki her sorunun kendisi: bölüm soruları ve quiz'in geri kalanı. */
  questions: ReadonlyMap<string, QuizQuestion>;
};

/**
 * Ön koşullar önce gelecek biçimde sıralar. Doğrulayıcı döngüyü reddediyor;
 * yine de bozuk bir veri sonsuz döngüye değil özgün sıraya düşüyor.
 */
export function orderByPrerequisites(concepts: Primer["concepts"]): Primer["concepts"] {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const result: Primer["concepts"] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (concept: Primer["concepts"][number]) => {
    if (placed.has(concept.id) || visiting.has(concept.id)) return;
    visiting.add(concept.id);
    for (const id of concept.prerequisiteIds) {
      const prerequisite = byId.get(id);
      if (prerequisite) visit(prerequisite);
    }
    visiting.delete(concept.id);
    placed.add(concept.id);
    result.push(concept);
  };
  concepts.forEach(visit);
  return result.length === concepts.length ? result : concepts;
}

/** Bölümle en çok iddiayı paylaşan, henüz kullanılmamış soru; eşitlikte listede önce gelen. */
function bestCheck(claimIds: readonly string[], pool: readonly QuizQuestion[], used: ReadonlySet<string>) {
  const claims = new Set(claimIds);
  let best: QuizQuestion | undefined;
  let bestScore = 0;
  for (const question of pool) {
    if (used.has(question.id)) continue;
    const score = question.claimIds.filter((id) => claims.has(id)).length;
    if (score > bestScore) {
      best = question;
      bestScore = score;
    }
  }
  return best;
}

export function studyPath(project: ResearchProject, drill?: Quiz): StudyPath {
  const questions = new Map<string, QuizQuestion>();
  const used = new Set<string>();
  const quiz = project.quiz?.questions ?? [];
  const drillQuestions = (drill?.questions ?? []).filter((question) => !quiz.some((item) => item.id === question.id));

  const steps: StudyStep[] = [{ id: "start", kind: "start", phase: "prepare" }];
  for (const concept of orderByPrerequisites(project.primer?.concepts ?? [])) {
    steps.push({ id: `concept:${concept.id}`, kind: "concept", phase: "prepare", conceptId: concept.id, title: concept.term });
  }
  for (const section of project.story.sections) {
    // Önce makale için yazılmış quiz; o bitince kanıttan üretilen alıştırma.
    const check = bestCheck(section.claimIds, quiz, used) ?? bestCheck(section.claimIds, drillQuestions, used);
    if (check) {
      used.add(check.id);
      questions.set(check.id, check);
    }
    steps.push({ id: `section:${section.id}`, kind: "section", phase: "read", sectionId: section.id, title: section.title, checkId: check?.id });
  }
  for (const derivation of project.derivations ?? []) {
    steps.push({ id: `derivation:${derivation.id}`, kind: "derivation", phase: "work", derivationId: derivation.id, title: derivation.title });
  }
  for (const interactive of project.interactives ?? []) {
    steps.push({ id: `interactive:${interactive.id}`, kind: "interactive", phase: "work", interactiveId: interactive.id, title: interactive.title });
  }
  // Yanlış okumalar son sınavdan önce: okuyucu tuzakları görüp sonra sınanıyor.
  if (project.misreadings) steps.push({ id: "misreadings", kind: "misreadings", phase: "check", title: project.misreadings.title });
  const rest = quiz.filter((question) => !used.has(question.id));
  if (rest.length) {
    for (const question of rest) questions.set(question.id, question);
    steps.push({ id: "quiz", kind: "quiz", phase: "check", questionIds: rest.map((question) => question.id) });
  }
  if (project.applicationGuide) steps.push({ id: "guide", kind: "guide", phase: "apply", title: project.applicationGuide.title });
  steps.push({ id: "finish", kind: "finish", phase: "review" });
  return { steps, questions };
}

/* ------------------------------------------------------------------ *
 * İlerleme
 *
 * Kayıt projenin içinde değil: çalışmak projeyi değiştirmiyor, geçmişte sürüm
 * bırakmıyor ve paylaşılan bir JSON kişinin kendi yanıtlarını dışarı
 * taşımıyor. Stüdyoda kütüphanenin yanında (`study.json`), görüntüleyicide
 * tarayıcıda duruyor.
 * ------------------------------------------------------------------ */

const MAX_ID = 300;
export const MAX_ENTRIES = 400;

export const studyAnswerSchema = z.object({
  id: z.string().min(1).max(MAX_ID),
  correct: z.boolean(),
  attempts: z.number().int().min(1).max(99),
  revealed: z.boolean(),
  at: z.string().max(40),
  /** Sorunun içeriğinin mührü: soru yeniden yazılırsa eski yanıt geçersiz. */
  sig: z.string().max(40),
});
export type StudyAnswer = z.infer<typeof studyAnswerSchema>;

/**
 * Okuyucunun bir bölümü kendi cümleleriyle anlatışı ve modelin denetiminin
 * özeti (`explanation-history.ts`): hangi iddiaları aktardığı, hangilerini
 * atladığı. Bir sonraki anlatışta neyin eklendiği bundan hesaplanıyor.
 */
export const studyExplanationSchema = z.object({
  /** "story:<id>" ya da "report:<id>". */
  target: z.string().min(1).max(MAX_ID),
  at: z.string().max(40),
  /** Anlatış 3000 karakterle sınırlı (`explain-back.ts`); bu yalnızca bir akıl sınırı. */
  text: z.string().min(1).max(4000),
  model: z.string().max(200),
  covered: z.array(z.string().max(MAX_ID)).max(200),
  missed: z.array(z.string().max(MAX_ID)).max(200),
  misstated: z.number().int().min(0).max(200),
  unsupported: z.number().int().min(0).max(200),
  total: z.number().int().min(0).max(200),
  /** Bölümün mührü: bölüm yeniden yazılırsa eski anlatış başka bir metne ait. */
  sig: z.string().max(40),
});
export type StudyExplanation = z.infer<typeof studyExplanationSchema>;

export const MAX_EXPLANATIONS = 60;
/** Bölüm başına en yeni bu kadar anlatış tutuluyor. */
export const MAX_EXPLANATIONS_PER_SECTION = 5;

/** Sınırlar içinde bırakıyor: bölüm başına en yeni beş, toplam en çok altmış, en eski düşüyor. */
export function trimExplanations(items: readonly StudyExplanation[]) {
  const ordered = [...items].sort((left, right) => left.at.localeCompare(right.at));
  const perSection = new Map<string, number>();
  const kept: StudyExplanation[] = [];
  for (const item of [...ordered].reverse()) {
    const count = perSection.get(item.target) ?? 0;
    if (count >= MAX_EXPLANATIONS_PER_SECTION) continue;
    perSection.set(item.target, count + 1);
    kept.push(item);
  }
  return kept.reverse().slice(-MAX_EXPLANATIONS);
}

/** Gün gün tekrar sayısı en çok bu kadar gün tutuluyor. */
export const MAX_REVIEW_DAYS = 400;

/**
 * Bir günde tekrar edilen ve hatırlanan kart sayısı (yerel gün). Kart yalnızca
 * son tekrarını biliyor; haftalık hedef "bu hafta kaç tekrar" diye soruyor.
 */
export const reviewDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewed: z.number().int().min(0).max(99_999),
  remembered: z.number().int().min(0).max(99_999),
});
export type ReviewDay = z.infer<typeof reviewDaySchema>;

export const studyProgressSchema = z.object({
  version: z.literal(1),
  current: z.string().max(MAX_ID).optional(),
  done: z.array(z.string().max(MAX_ID)).max(MAX_ENTRIES),
  answers: z.array(studyAnswerSchema).max(MAX_ENTRIES),
  startedAt: z.string().max(40),
  updatedAt: z.string().max(40),
  finishedAt: z.string().max(40).optional(),
  /** Tekrar kartları (`review-schedule.ts`); çalışmada yanıtlanan sorular ve okunan kavramlar. */
  reviews: z.array(studyReviewSchema).max(MAX_ENTRIES).optional(),
  /** Kendi cümleleriyle anlatışlar; bölüm başına en yenileri. */
  explanations: z.array(studyExplanationSchema).max(MAX_EXPLANATIONS).optional(),
  /** Gün gün tekrarlar, eskiden yeniye. */
  reviewDays: z.array(reviewDaySchema).max(MAX_REVIEW_DAYS).optional(),
});
export type StudyProgress = z.infer<typeof studyProgressSchema>;

/** Kartı yoksa ekler; varsa dokunmuyor (tekrar geçmişi çalışmada yeniden okumakla silinmemeli). */
function withReview(progress: StudyProgress, review: StudyReview, replaceIf?: (existing: StudyReview) => boolean) {
  const reviews = progress.reviews ?? [];
  const existing = reviews.find((item) => item.id === review.id);
  if (existing && !replaceIf?.(existing)) return progress;
  return { ...progress, reviews: [...reviews.filter((item) => item.id !== review.id), review].slice(-MAX_ENTRIES) };
}

export function parseStudyProgress(raw: unknown): StudyProgress | undefined {
  const parsed = studyProgressSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function emptyStudyProgress(now: string): StudyProgress {
  return { version: 1, done: [], answers: [], startedAt: now, updatedAt: now };
}

export function questionSignature(question: Pick<QuizQuestion, "prompt" | "options">) {
  return stableHash(canonicalJson({ prompt: question.prompt, options: question.options }));
}

/** Kayıtlı yanıt, yalnızca soru o yanıttan beri değişmediyse. */
export function savedAnswer(progress: StudyProgress | undefined, question: QuizQuestion) {
  const answer = progress?.answers.find((item) => item.id === question.id);
  return answer && answer.sig === questionSignature(question) ? answer : undefined;
}

export function isFirstTry(answer: Pick<StudyAnswer, "correct" | "attempts">) {
  return answer.correct && answer.attempts === 1;
}

export function visitStep(progress: StudyProgress | undefined, stepId: string, now: string): StudyProgress {
  const base = progress ?? emptyStudyProgress(now);
  return { ...base, current: stepId, updatedAt: now, ...(stepId === "finish" && !base.finishedAt ? { finishedAt: now } : {}) };
}

/**
 * "Start over": adımlar ve yanıtlar siliniyor; tekrar kartları, anlatışlar ve
 * gün gün tekrar sayıları kalıyor. Yolu baştan yürümek aylardır süren
 * tekrarları, okuyucunun neyi eklediğini gösteren geçmişi ya da haftalık
 * hedefin sayısını silmemeli.
 */
export function startOverProgress(previous: StudyProgress | undefined, now: string): StudyProgress | undefined {
  const kept = {
    ...(previous?.reviews?.length ? { reviews: previous.reviews } : {}),
    ...(previous?.explanations?.length ? { explanations: previous.explanations } : {}),
    ...(previous?.reviewDays?.length ? { reviewDays: previous.reviewDays } : {}),
  };
  return Object.keys(kept).length ? { ...emptyStudyProgress(now), ...kept } : undefined;
}

/** Adımı bitmiş sayar ve bir sonrakine geçer. */
export function completeStep(progress: StudyProgress | undefined, stepId: string, nextId: string | undefined, now: string): StudyProgress {
  const base = progress ?? emptyStudyProgress(now);
  const done = base.done.includes(stepId) ? base.done : [...base.done, stepId].slice(-MAX_ENTRIES);
  // Okunan kavram ertesi gün bir tekrar kartı olarak dönüyor.
  const learned = stepId.startsWith("concept:") ? withReview({ ...base, done }, scheduleFirst(conceptCardId(stepId.slice("concept:".length)), 0, now)) : { ...base, done };
  return visitStep(learned, nextId ?? stepId, now);
}

export type QuestionResult = { correct: boolean; attempts: number; revealed: boolean };

/** Bir sorunun son sonucu öncekinin yerini alıyor: "yeniden bak" listesi bugünü göstermeli. */
export function recordAnswer(progress: StudyProgress | undefined, question: QuizQuestion, result: QuestionResult, now: string): StudyProgress {
  const base = progress ?? emptyStudyProgress(now);
  const answer: StudyAnswer = {
    id: question.id,
    correct: result.correct,
    attempts: Math.min(99, Math.max(1, result.attempts)),
    revealed: result.revealed,
    at: now,
    sig: questionSignature(question),
  };
  const answers = [...base.answers.filter((item) => item.id !== question.id), answer].slice(-MAX_ENTRIES);
  // İlk denemede bilinen soru üç gün, gerisi ertesi gün dönüyor. Soru yeniden yazıldıysa kart baştan.
  const card = scheduleFirst(questionCardId(question.id), isFirstTry(answer) ? 1 : 0, now, answer.sig);
  return withReview({ ...base, answers, updatedAt: now }, card, (existing) => existing.sig !== answer.sig);
}

/** Kaldığı yer: kayıtlı adım hâlâ yoldaysa o, değilse ilk bitmemiş adım. */
export function resumeStepId(path: StudyPath, progress: StudyProgress | undefined) {
  if (progress?.current && path.steps.some((step) => step.id === progress.current)) return progress.current;
  const done = new Set(progress?.done ?? []);
  return path.steps.find((step) => !done.has(step.id))?.id ?? "start";
}

export type StudySummary = {
  /** Bitiş adımı hariç. */
  total: number;
  done: number;
  checks: { total: number; answered: number; firstTry: number };
  /** İlk denemede doğru yapılamayan sorulara göre yeniden bakılacak bölüm ve kavram adımları, yol sırasıyla. */
  revisit: StudyStep[];
  /** Bitiş adımına kadar bitmemiş adımlar. */
  skipped: StudyStep[];
};

export function studySummary(
  project: Pick<ResearchProject, "story" | "primer">,
  path: StudyPath,
  progress: StudyProgress | undefined,
): StudySummary {
  const learning = path.steps.filter((step) => step.kind !== "finish");
  const done = new Set(progress?.done ?? []);
  const answers = [...path.questions.values()].map((question) => savedAnswer(progress, question));
  const missed = [...path.questions.values()].filter((question, index) => answers[index] && !isFirstTry(answers[index]!));

  const revisit = new Set<string>();
  for (const question of missed) {
    const claims = new Set(question.claimIds);
    for (const step of path.steps) {
      if (step.kind !== "section") continue;
      const section = project.story.sections.find((item) => item.id === step.sectionId);
      // Bölümün kendi sorusu ya da aynı iddialara dayanan bir quiz sorusu.
      if (step.checkId === question.id || section?.claimIds.some((id) => claims.has(id))) revisit.add(step.id);
    }
    for (const concept of project.primer?.concepts ?? []) {
      if (concept.claimIds.some((id) => claims.has(id))) revisit.add(`concept:${concept.id}`);
    }
  }

  return {
    total: learning.length,
    done: learning.filter((step) => done.has(step.id)).length,
    checks: {
      total: path.questions.size,
      answered: answers.filter(Boolean).length,
      firstTry: answers.filter((answer) => answer && isFirstTry(answer)).length,
    },
    revisit: path.steps.filter((step) => revisit.has(step.id)),
    skipped: learning.filter((step) => !done.has(step.id)),
  };
}

/* ------------------------------------------------------------------ *
 * Kütüphane dosyası — study.json
 * ------------------------------------------------------------------ */

const studyFileSchema = z.object({
  version: z.literal(1),
  projects: z.array(z.unknown()),
});
const studyEntrySchema = z.object({ id: z.string().min(1).max(MAX_ID), progress: studyProgressSchema });

export function isStudyFile(raw: unknown) {
  return studyFileSchema.safeParse(raw).success;
}

/** Proje kimliği → ilerleme. Nesne değil `Map`: kimlik serbest metin ve "__proto__" da olabilir. */
export function parseStudyFile(raw: unknown): Map<string, StudyProgress> {
  const entries = new Map<string, StudyProgress>();
  const file = studyFileSchema.safeParse(raw);
  if (!file.success) return entries;
  for (const item of file.data.projects) {
    const entry = studyEntrySchema.safeParse(item);
    if (entry.success) entries.set(entry.data.id, entry.data.progress);
  }
  return entries;
}

export function studyFileToJson(entries: ReadonlyMap<string, StudyProgress>) {
  return { version: 1 as const, projects: [...entries].map(([id, progress]) => ({ id, progress })) };
}
