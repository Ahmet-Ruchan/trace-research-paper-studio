import { collectParams, evaluateFormula, parseFormula } from "./formula";
import { learningBlockIds, learningBlockSpec, missingLearningBlocks, type LearningBlockId } from "./learning-generation";
import type { Claim, Interactive, QuizQuestion, ResearchProject } from "./schema";
import { markTerms, termIndex } from "./term-index";

/**
 * Öğrenme sağlığı: kanıt sağlığının öğrenme katmanındaki karşılığı.
 *
 * Kanıt sağlığı "bu cümle bir sayfaya bağlı mı" diye soruyor. Burada soru
 * "okuyucu bundan gerçekten öğrenebilir mi": hiçbir sorunun sınamadığı bölüm,
 * yalnızca yöntemi soran bir quiz, kaydırıcısı hiçbir şeyi değiştirmeyen bir
 * oyun alanı, formülünü tekrar eden bir türetim adımı, hikâyenin hiç
 * kullanmadığı bir ön bilgi kavramı. Hepsi projenin kendi verisinden
 * hesaplanıyor; model çağrılmıyor, paylaşılan bir JSON aynı sonucu veriyor.
 *
 * Tek bir puan yok, kanıt sağlığındaki nedenle: ortalama, hangi parçanın
 * neden zayıf olduğunu gizler.
 */

/** Quiz'in sınaması gereken iddia türleri; yöntem ve arka plan zaten her yerde. */
export const QUIZ_KINDS_TO_COVER = ["reported-result", "author-interpretation", "limitation"] as const;
export type QuizKindToCover = (typeof QUIZ_KINDS_TO_COVER)[number];

export type SectionCheck = {
  id: string;
  title: string;
  indexLabel?: string;
  claimIds: readonly string[];
  /** Bölümle iddia paylaşan quiz soruları. */
  questionIds: string[];
};

export type LearningHealth = {
  missingBlocks: LearningBlockId[];
  sections: SectionCheck[];
  /** Hiçbir quiz sorusunun sınamadığı bölümler; quiz yoksa boş (eksik blok zaten söylüyor). */
  uncheckedSections: SectionCheck[];
  quiz?: {
    total: number;
    /** Soruların dayandığı iddia türleri: bir soru her türünde bir kez sayılıyor. */
    byKind: Record<Claim["kind"], number>;
    /** Kanıtta olduğu hâlde hiçbir sorunun dayanmadığı türler. */
    uncovered: QuizKindToCover[];
  };
  flatPlaygrounds: Array<{ id: string; title: string; reason: "outputs" | "chart" }>;
  restatingSteps: Array<{ derivationId: string; title: string; stepIds: string[] }>;
  unusedConcepts: Array<{ id: string; term: string }>;
  /** Bulgu sayısı; sıfırsa panel "sorun yok" diyor. */
  findings: number;
};

const SAMPLES = 9;

type PlaygroundOutput = Extract<Interactive, { kind: "formula-playground" }>["outputs"][number];

function varies(values: readonly (number | null)[]) {
  const finite = values.filter((value): value is number => value !== null);
  if (finite.length < 2) return false;
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  return high - low > 1e-9 * Math.max(1, Math.abs(high), Math.abs(low));
}

function sweep(min: number, max: number) {
  return Array.from({ length: SAMPLES }, (_, index) => min + ((max - min) * index) / (SAMPLES - 1));
}

/**
 * Kaydırıcıyı oynatmak bir şey değiştiriyor mu? Her parametre, diğerleri
 * makale değerinde tutulurken kendi aralığında taranıyor. Bütün çıktılar
 * sabitse oyun alanı hiçbir şey göstermiyor; grafik varsa ve bütün serileri
 * x ekseni boyunca düzse grafik düz bir çizgi.
 */
export function playgroundFlatness(interactive: Interactive): "outputs" | "chart" | undefined {
  if (interactive.kind !== "formula-playground") return undefined;
  const paper = Object.fromEntries(interactive.parameters.map((parameter) => [parameter.name, parameter.paperValue]));
  const evaluate = (formula: string, overrides: Record<string, number>) => {
    try {
      return evaluateFormula(formula, { ...paper, ...overrides });
    } catch {
      return null;
    }
  };
  const outputVaries = (output: PlaygroundOutput, only?: string) => {
    let used: Set<string>;
    try {
      used = collectParams(parseFormula(output.formula));
    } catch {
      return false;
    }
    return interactive.parameters.some((parameter) =>
      (!only || parameter.name === only) &&
      used.has(parameter.name) &&
      varies(sweep(parameter.min, parameter.max).map((value) => evaluate(output.formula, { [parameter.name]: value }))),
    );
  };
  if (!interactive.outputs.some((output) => outputVaries(output))) return "outputs";
  const chart = interactive.chart;
  if (chart) {
    const series = chart.series.flatMap((item) => interactive.outputs.find((output) => output.id === item.outputId) ?? []);
    if (series.length && !series.some((output) => outputVaries(output, chart.xParam))) return "chart";
  }
  return undefined;
}

const normalise = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.,;:!?]+$/, "");

/** Gerekçe okumayla aynıysa ya da yalnızca birkaç harf farkla onu içeriyorsa adım bir şey öğretmiyor. */
export function restatesItself(step: { plain: string; rationale: string }) {
  const rationale = normalise(step.rationale);
  const plain = normalise(step.plain);
  if (rationale === plain) return true;
  const [short, long] = rationale.length < plain.length ? [rationale, plain] : [plain, rationale];
  return long.includes(short) && long.length - short.length < 12;
}

function sharesClaim(left: readonly string[], right: ReadonlySet<string>) {
  return left.some((id) => right.has(id));
}

export function learningHealth(project: ResearchProject): LearningHealth {
  const questions: readonly QuizQuestion[] = project.quiz?.questions ?? [];
  const sections: SectionCheck[] = project.story.sections.map((section) => {
    const claims = new Set(section.claimIds);
    return {
      id: section.id,
      title: section.title,
      indexLabel: section.indexLabel,
      claimIds: section.claimIds,
      questionIds: questions.filter((question) => sharesClaim(question.claimIds, claims)).map((question) => question.id),
    };
  });

  let quiz: LearningHealth["quiz"];
  if (questions.length) {
    const kinds = new Map(project.evidence.claims.map((claim) => [claim.id, claim.kind]));
    const byKind: Record<Claim["kind"], number> = { "reported-result": 0, "author-interpretation": 0, method: 0, background: 0, limitation: 0 };
    for (const question of questions) {
      for (const kind of new Set(question.claimIds.flatMap((id) => kinds.get(id) ?? []))) byKind[kind] += 1;
    }
    const available = new Set(project.evidence.claims.map((claim) => claim.kind));
    quiz = { total: questions.length, byKind, uncovered: QUIZ_KINDS_TO_COVER.filter((kind) => available.has(kind) && byKind[kind] === 0) };
  }

  const flatPlaygrounds = (project.interactives ?? []).flatMap((interactive) => {
    const reason = playgroundFlatness(interactive);
    return reason ? [{ id: interactive.id, title: interactive.title, reason }] : [];
  });

  const restatingSteps = (project.derivations ?? []).flatMap((derivation) => {
    const stepIds = derivation.steps.filter(restatesItself).map((step) => step.id);
    return stepIds.length ? [{ derivationId: derivation.id, title: derivation.title, stepIds }] : [];
  });

  // Kavram kullanılıyor: hikâye, rapor ya da quiz onunla iddia paylaşıyor ya
  // da metin onu anıyor. Kullanılan bir kavramın ön koşulları da kullanılıyor.
  const concepts = project.primer?.concepts ?? [];
  const entries = termIndex(project).filter((entry) => entry.conceptId);
  const used = new Set<string>();
  const texts = [
    ...project.story.sections.map((section) => [section.title, section.body]),
    ...(project.deepReport?.sections ?? []).map((section) => [section.title, section.summary, ...section.analysis]),
  ];
  for (const paragraphs of texts) {
    for (const segment of markTerms(paragraphs, entries, project.language).flat()) {
      if (segment.entry?.conceptId) used.add(segment.entry.conceptId);
    }
  }
  const citedElsewhere = new Set([
    ...project.story.sections.flatMap((section) => section.claimIds),
    ...(project.deepReport?.sections ?? []).flatMap((section) => section.claimIds),
    ...questions.flatMap((question) => question.claimIds),
  ]);
  for (const concept of concepts) if (sharesClaim(concept.claimIds, citedElsewhere)) used.add(concept.id);
  const pending = [...used];
  while (pending.length) {
    const id = pending.pop();
    const concept = concepts.find((item) => item.id === id);
    for (const id of concept?.prerequisiteIds ?? []) {
      if (!used.has(id)) {
        used.add(id);
        pending.push(id);
      }
    }
  }
  const unusedConcepts = concepts.filter((concept) => !used.has(concept.id)).map((concept) => ({ id: concept.id, term: concept.term }));

  const missingBlocks = missingLearningBlocks(project);
  const uncheckedSections = questions.length ? sections.filter((section) => !section.questionIds.length) : [];
  return {
    missingBlocks,
    sections,
    uncheckedSections,
    quiz,
    flatPlaygrounds,
    restatingSteps,
    unusedConcepts,
    findings:
      (missingBlocks.length ? 1 : 0) +
      uncheckedSections.length +
      (quiz?.uncovered.length ?? 0) +
      flatPlaygrounds.length +
      restatingSteps.length +
      unusedConcepts.length,
  };
}

/**
 * Bir bölümü sınamak için yeniden yazılabilecek soru: yeniden yazılınca hiçbir
 * bölümü sorusuz bırakmayan, yani sınadığı her bölümü başka bir sorunun da
 * sınadığı soru. Böyle bir soru yoksa `undefined`: bir açığı kapatırken
 * başka bir açık açmamak gerek.
 */
export function spareQuestion(health: Pick<LearningHealth, "sections">, questionIds: readonly string[]) {
  // Sondan başlanıyor: quiz'in ilk soruları çoğunlukla makalenin ana fikrini soruyor.
  return [...questionIds].reverse().find((id) =>
    health.sections.every((section) => !section.questionIds.includes(id) || section.questionIds.length > 1),
  );
}

/**
 * Eksik blokların adları ve listenin bağlacı; Türkçesi arayüz sözlüğünde
 * (`learning`). İngilizcesi üretimin kendi adları (`learningBlockList` ile aynı).
 */
export type MissingBlockWords = { nouns: Record<LearningBlockId, string>; list: (nouns: readonly string[]) => string };
export const MISSING_BLOCK_WORDS: MissingBlockWords = {
  nouns: Object.fromEntries(learningBlockIds.map((block) => [block, learningBlockSpec(block).noun])) as Record<LearningBlockId, string>,
  list: (nouns) => (nouns.length <= 1 ? (nouns[0] ?? "") : `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`),
};

/** "the primer, the quiz and the derivations" */
export function describeMissingBlocks(blocks: readonly LearningBlockId[], words: MissingBlockWords = MISSING_BLOCK_WORDS) {
  return words.list(blocks.map((block) => words.nouns[block]));
}
