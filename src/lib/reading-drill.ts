import type { Claim, Metric, PaperEvidence, Quiz, QuizQuestion, ResearchProject } from "./schema";
import { seededRandom, seededShuffle } from "./seeded";

/**
 * "Hakem gibi oku": kanıtın kendisinden üretilen sorular.
 *
 * Trace'in öğrettiği asıl beceri bir makaleyi kanıtıyla okumak: bir cümle
 * ölçülmüş bir sonuç mu yoksa yazarların yorumu mu, hangi cümleye dayanıyor,
 * makale tam olarak hangi sayıyı veriyor. Bu sorular model yazmıyor; iddia
 * türünden, alıntılardan ve metriklerden kod üretiyor. Doğru yanıt bu yüzden
 * tanım gereği doğru ve her proje (öğrenme katmanı olmayan da) bunları alıyor.
 *
 * Seçim projenin kimliğiyle tohumlanıyor: aynı proje her açılışta aynı
 * soruları gösteriyor, tekrar eden okuyucu kaldığı yerden devam edebiliyor.
 */

const KINDS: Array<Claim["kind"]> = ["reported-result", "author-interpretation", "method", "background", "limitation"];

const random = seededRandom;
const shuffle = seededShuffle;

const quoted = (text: string) => `“${text.trim()}”`;
const pageOf = (claim: Claim) => claim.sourceRefs.find((reference) => reference.page)?.page;
const onPage = (page?: number) => (page ? ` (p. ${page})` : "");

/**
 * Drilin bütün metni: başlık, giriş ve soruların cümleleri. Türkçesi
 * görsellerin sözlüğünde (`src/visuals/i18n.ts`, `drill`): stüdyo arayüzün
 * dilini, bağımsız görüntüleyici makalenin dilini veriyor. Ajan çıktısı
 * İngilizce varsayılanla.
 *
 * Sorunun mührü (`questionSignature`) dilden bağımsız: çevrilmiş bir soru,
 * İngilizcesinin metniyle mühürleniyor (`signatureBasis`). Dil değişince
 * kayıtlı yanıtlar ve tekrar kartları düşmüyor.
 */
export type ReadingDrillWords = {
  title: string;
  intro: string;
  kinds: Record<Claim["kind"], { option: string; meaning: string }>;
  /** `statement` tırnaklı geliyor. */
  kindPrompt: (statement: string) => string;
  kindRight: (meaning: string, page?: number) => string;
  kindWrong: (meaning: string) => string;
  quotePrompt: (statement: string) => string;
  quoteRight: (page?: number) => string;
  quoteOther: (statement: string) => string;
  numberPrompt: (label: string) => string;
  /** `excerpt` tırnaklı geliyor. */
  numberRight: (context: string, excerpt: string, page?: number) => string;
  numberOther: (label: string) => string;
};

export const READING_DRILL_TITLE = "Read it like a reviewer";

export const READING_DRILL_WORDS: ReadingDrillWords = {
  title: READING_DRILL_TITLE,
  intro: "Questions made from the evidence itself, not by a model: what kind of statement a claim is, which sentence of the paper it rests on, and which number the paper reports. Every answer can be checked on its page.",
  kinds: {
    "reported-result": {
      option: "A reported result: something the authors measured",
      meaning: "A reported result is something the authors measured, usually a number or a comparison.",
    },
    "author-interpretation": {
      option: "The authors' interpretation of what a result means",
      meaning: "An interpretation is the authors' reading of a result; it goes beyond what was measured.",
    },
    method: {
      option: "The method: what the authors built or did",
      meaning: "The method is what the authors built or did, not what came out of it.",
    },
    background: {
      option: "Background the paper builds on",
      meaning: "Background is earlier work or prior knowledge the paper relies on, not its own finding.",
    },
    limitation: {
      option: "A limitation the paper concedes",
      meaning: "A limitation is a boundary the paper concedes: what it did not test, or where it may not hold.",
    },
  },
  kindPrompt: (statement) => `What kind of statement is this? ${statement}`,
  kindRight: (meaning, page) => `${meaning} That is what this sentence is${onPage(page)}.`,
  kindWrong: (meaning) => `${meaning} That is not what this sentence does.`,
  quotePrompt: (statement) => `Which sentence from the paper supports this claim? ${statement}`,
  quoteRight: (page) => `This is the sentence the claim rests on${onPage(page)}.`,
  quoteOther: (statement) => `This sentence supports a different claim: ${statement}`,
  numberPrompt: (label) => `Which number does the paper report for ${label}?`,
  numberRight: (context, excerpt, page) => `${context}. The paper: ${excerpt}${onPage(page)}`,
  numberOther: (label) => `That is the paper's figure for ${label}.`,
};

function kindQuestion(claim: Claim, next: () => number, words: ReadingDrillWords): QuizQuestion {
  const others = shuffle(KINDS.filter((kind) => kind !== claim.kind), next).slice(0, 3);
  const options = shuffle([claim.kind, ...others], next).map((kind) => ({
    label: words.kinds[kind].option,
    correct: kind === claim.kind,
    explanation: kind === claim.kind ? words.kindRight(words.kinds[kind].meaning, pageOf(claim)) : words.kindWrong(words.kinds[kind].meaning),
  }));
  return {
    id: `drill-kind-${claim.id}`,
    prompt: words.kindPrompt(quoted(claim.statement)),
    kind: "single",
    options,
    claimIds: [claim.id],
    page: pageOf(claim),
  };
}

function quoteQuestion(claim: Claim, pool: readonly Claim[], next: () => number, words: ReadingDrillWords): QuizQuestion | undefined {
  const own = claim.sourceRefs.find((reference) => reference.sourceId === "paper" && reference.excerpt.trim().length >= 20);
  if (!own) return undefined;
  const excerpt = own.excerpt.trim();
  const distractors = shuffle(
    pool.filter((other) => other.id !== claim.id && other.sourceRefs.every((reference) => reference.excerpt.trim() !== excerpt)),
    next,
  )
    // Aynı türden iddiaların alıntıları birbirine benziyor: soru onlarla zorlaşıyor.
    .sort((left, right) => Number(right.kind === claim.kind) - Number(left.kind === claim.kind))
    .flatMap((other) => {
      const reference = other.sourceRefs.find((candidate) => candidate.excerpt.trim().length >= 20);
      return reference ? [{ claim: other, excerpt: reference.excerpt.trim() }] : [];
    })
    .filter((item, index, all) => all.findIndex((entry) => entry.excerpt === item.excerpt) === index)
    .slice(0, 3);
  if (distractors.length < 2) return undefined;
  const options = shuffle([
    { label: quoted(excerpt), correct: true, explanation: words.quoteRight(own.page) },
    ...distractors.map(({ claim: other, excerpt: text }) => ({
      label: quoted(text),
      correct: false,
      explanation: words.quoteOther(quoted(other.statement)),
    })),
  ], next);
  return {
    id: `drill-quote-${claim.id}`,
    prompt: words.quotePrompt(quoted(claim.statement)),
    kind: "single",
    options,
    claimIds: [claim.id],
    page: own.page,
  };
}

function numberQuestion(metric: Metric, metrics: readonly Metric[], claims: readonly Claim[], next: () => number, words: ReadingDrillWords): QuizQuestion | undefined {
  const unit = metric.unit.trim().toLowerCase();
  const alternatives = shuffle(
    metrics.filter((other) => other.id !== metric.id && other.unit.trim().toLowerCase() === unit && other.value !== metric.value),
    next,
  ).filter((item, index, all) => all.findIndex((entry) => entry.displayValue === item.displayValue) === index && item.displayValue !== metric.displayValue);
  if (alternatives.length < 2) return undefined;
  const options = shuffle([
    { label: metric.displayValue, correct: true, explanation: words.numberRight(metric.context, quoted(metric.sourceRef.excerpt), metric.sourceRef.page) },
    ...alternatives.slice(0, 3).map((other) => ({
      label: other.displayValue,
      correct: false,
      explanation: words.numberOther(other.label),
    })),
  ], next);
  // Sayıyı taşıyan bir iddia varsa kanıt olarak o gösteriliyor.
  const carrier = claims.find((claim) => claim.statement.includes(metric.displayValue) || claim.sourceRefs.some((reference) => reference.excerpt.includes(metric.displayValue)));
  return {
    id: `drill-number-${metric.id}`,
    prompt: words.numberPrompt(metric.label),
    kind: "single",
    options,
    claimIds: carrier ? [carrier.id] : [],
    page: metric.sourceRef.page,
  };
}

/**
 * En fazla `limit` soru: tür, alıntı ve sayı soruları sırayla. Soru
 * üretilecek kadar kanıt yoksa (üçten az soru) hiç gösterilmiyor.
 */
export function readingDrill(
  evidence: PaperEvidence,
  options: { seed: string; rejectedClaimIds?: readonly string[]; limit?: number; words?: ReadingDrillWords },
): Quiz | undefined {
  const words = options.words ?? READING_DRILL_WORDS;
  const drill = buildDrill(evidence, options, words);
  if (!drill || words === READING_DRILL_WORDS) return drill;
  // Aynı tohum, aynı sıra: İngilizcesi soru soru aynı yerde; mühür ondan.
  const english = buildDrill(evidence, options, READING_DRILL_WORDS)!;
  return {
    ...drill,
    questions: drill.questions.map((question, index) => {
      const basis = english.questions[index];
      return basis?.id === question.id ? { ...question, signatureBasis: { prompt: basis.prompt, options: basis.options } } : question;
    }),
  };
}

function buildDrill(evidence: PaperEvidence, options: { seed: string; rejectedClaimIds?: readonly string[]; limit?: number }, words: ReadingDrillWords): Quiz | undefined {
  const next = random(options.seed);
  const rejected = new Set(options.rejectedClaimIds ?? []);
  const usable = evidence.claims.filter((claim) => !rejected.has(claim.id));
  // Doğrulanmış iddialar önce: doğru yanıt makalenin sayfasında görülebiliyor.
  const ordered = shuffle(usable, next).sort((left, right) => Number(right.confidence === "verified") - Number(left.confidence === "verified"));

  // Tür sorularında en öğretici ayrım ölçüm ile yorum arasında; ikisi önce.
  const kindOrder: Array<Claim["kind"]> = ["author-interpretation", "reported-result", "limitation", "method", "background"];
  const byKind = kindOrder.flatMap((kind) => ordered.filter((claim) => claim.kind === kind).slice(0, 1));
  const kindQuestions = byKind.map((claim) => kindQuestion(claim, next, words));
  const quoteQuestions = ordered
    .filter((claim) => !byKind.slice(0, 2).includes(claim))
    .map((claim) => quoteQuestion(claim, usable, next, words))
    .filter((question): question is QuizQuestion => Boolean(question));
  const numberQuestions = shuffle(evidence.metrics, next)
    .map((metric) => numberQuestion(metric, evidence.metrics, usable, next, words))
    .filter((question): question is QuizQuestion => Boolean(question));

  const limit = options.limit ?? 6;
  const questions: QuizQuestion[] = [];
  for (let round = 0; questions.length < limit && round < limit; round += 1) {
    for (const source of [kindQuestions, quoteQuestions, numberQuestions]) {
      if (questions.length < limit && source[round]) questions.push(source[round]);
    }
  }
  if (questions.length < 3) return undefined;
  return {
    title: words.title,
    intro: words.intro,
    questions,
  };
}

/** Projenin kendi drili: kimliğiyle tohumlanmış, bir insanın reddettiği iddialar hariç. */
export function readingDrillFor(project: Pick<ResearchProject, "id" | "evidence" | "claimReviews">, words?: ReadingDrillWords) {
  const rejected = Object.entries(project.claimReviews ?? {}).filter(([, review]) => review.status === "rejected").map(([id]) => id);
  return readingDrill(project.evidence, { seed: project.id, rejectedClaimIds: rejected, words });
}
