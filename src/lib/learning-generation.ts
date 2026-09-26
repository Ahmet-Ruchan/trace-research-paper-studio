import { z } from "zod";
import { IntegrityError, validateLearningIntegrity } from "./generation-validation";
import {
  APPLICATION_GUIDE_RULES,
  DERIVATION_RULES,
  INTERACTIVE_RULES,
  LEARNING_EVIDENCE_RULES,
  PRIMER_RULES,
  QUIZ_RULES,
} from "./learning-rules";
import { bulletList, languageName } from "./prompts";
import {
  LEARNING_REQUIREMENTS,
  applicationGuideSchema,
  derivationSchema,
  interactiveSchema,
  primerSchema,
  quizSchema,
  type PaperEvidence,
  type ResearchProject,
  type TechnicalAppendix,
} from "./schema";
import { sectionEvidenceView } from "./section-regeneration";

/**
 * Öğrenme katmanını modelle üretmek.
 *
 * Katman (ön bilgi, türetimler, oyun alanları, quiz, uygulama rehberi) eskiden
 * yalnızca ajan yolunda vardı; stüdyonun kendi analizi onu hiç yazmıyordu.
 * Burada her blok AYRI bir istek: tek istekte hepsi 30–40 bin karakter tutuyor
 * ve bulut modellerinin 120 saniyelik sınırına sığmıyor. Her blok kanıta
 * kilitli (PDF gönderilmiyor), kendi şemasıyla ve eklentinin kullandığı aynı
 * bütünlük denetimiyle doğrulanıyor.
 */
export const learningBlockIds = ["primer", "quiz", "derivations", "interactives", "applicationGuide"] as const;
export type LearningBlockId = (typeof learningBlockIds)[number];
export type LearningBlocks = Partial<Pick<ResearchProject, LearningBlockId>>;

type Depth = ResearchProject["depth"];

export type LearningContext = {
  evidence: PaperEvidence;
  depth: Depth;
  language: string;
  audience: ResearchProject["audience"];
  /** Türetimler denklemlere bağlanıyor, oyun alanları formülleri buradan alıyor. */
  technicalAppendix?: TechnicalAppendix;
  /** Bir insanın reddettiği iddialar: istemde gösterilmiyor, atıf da reddediliyor. */
  rejectedClaimIds?: readonly string[];
};

const counts: Record<"primer" | "quiz" | "derivations" | "interactives", Record<Depth, string>> = {
  primer: { concise: "3–5", standard: "4–7", deep: "5–9" },
  quiz: { concise: "4–5", standard: "5–8", deep: "8–12" },
  derivations: { concise: "1", standard: "1–2", deep: "2–4" },
  interactives: { concise: "1–2", standard: "2–3", deep: "2–4" },
};

type BlockSpec = {
  /** Cümle içinde: "The primer could not be written." */
  noun: string;
  /** İlerleme başlığı. */
  title: string;
  schema: z.ZodType;
  schemaName: string;
  maxOutputTokens: number;
  /** Örnek projede ölçülen çıktı uzunluğu, karakter; hız tahmini buna göre. */
  expectedCharacters: number;
  usesTechnicalAppendix: boolean;
  task: (depth: Depth) => string;
  rules: readonly string[];
  /** Model çıktısını projeye takılacak bloğa çevirir. */
  toBlocks: (value: unknown) => LearningBlocks;
};

const specs: Record<LearningBlockId, BlockSpec> = {
  primer: {
    noun: "the primer",
    title: "Writing the primer",
    schema: primerSchema,
    schemaName: "trace_primer",
    expectedCharacters: 5_100,
    maxOutputTokens: 8_192,
    usesTechnicalAppendix: false,
    task: (depth) =>
      `Build the primer: ${counts.primer[depth]} concepts the paper assumes and never explains, linked by their prerequisites. title names the primer; overview is one short paragraph telling the reader what these concepts are for and how to use them.`,
    rules: PRIMER_RULES,
    toBlocks: (value) => ({ primer: value as NonNullable<ResearchProject["primer"]> }),
  },
  quiz: {
    noun: "the quiz",
    title: "Writing the quiz",
    schema: quizSchema,
    schemaName: "trace_quiz",
    expectedCharacters: 6_800,
    maxOutputTokens: 12_288,
    usesTechnicalAppendix: false,
    task: (depth) =>
      `Build a comprehension quiz of ${counts.quiz[depth]} questions. Cover the method, the main results and at least one limitation, and include at least one question about something the evidence does NOT establish. Mix the kinds: at least one multi or true-false question. Wrong options are plausible misreadings of the paper, never jokes. title and intro say what the quiz checks.`,
    rules: QUIZ_RULES,
    toBlocks: (value) => ({ quiz: value as NonNullable<ResearchProject["quiz"]> }),
  },
  derivations: {
    noun: "the derivations",
    title: "Writing the step-by-step derivations",
    schema: z.object({ derivations: z.array(derivationSchema).min(1).max(6) }),
    schemaName: "trace_derivations",
    expectedCharacters: 7_100,
    maxOutputTokens: 12_288,
    usesTechnicalAppendix: true,
    task: (depth) =>
      `Write ${counts.derivations[depth]} step-by-step derivation(s): the ones a reader most needs to rebuild the paper's argument, such as why a formula has its form or where a cost or a scaling comes from. goal says what the derivation shows. plain is mandatory: it is the fallback when the mathematics cannot render and the screen-reader label. rationale carries the teaching value; a step that only restates its own formula is wasted. shapes (optional) gives array or tensor shapes when they matter. When a derivation explains an equation listed in the technical appendix below, set equationId to that equation's id; otherwise omit it. A numericExample should end at a result the reader can check against the paper's own numbers.`,
    rules: DERIVATION_RULES,
    toBlocks: (value) => ({ derivations: (value as { derivations: NonNullable<ResearchProject["derivations"]> }).derivations }),
  },
  interactives: {
    noun: "the interactive explorations",
    title: "Building the playgrounds",
    schema: z.object({ interactives: z.array(interactiveSchema).min(1).max(8) }),
    schemaName: "trace_interactives",
    expectedCharacters: 9_000,
    maxOutputTokens: 12_288,
    usesTechnicalAppendix: true,
    task: (depth) =>
      `Build ${counts.interactives[depth]} interactive explorations. Use a formula-playground for a formula the paper states together with its own settings, a mechanism-simulation to step through how the method processes its input, and a dataset-explorer for a table of reported results. Use only the kinds the evidence supports. Each item has a title and a description telling the reader what to try and what to notice.`,
    rules: INTERACTIVE_RULES,
    toBlocks: (value) => ({ interactives: (value as { interactives: NonNullable<ResearchProject["interactives"]> }).interactives }),
  },
  applicationGuide: {
    noun: "the application guide",
    title: "Writing the application guide",
    schema: applicationGuideSchema,
    schemaName: "trace_application_guide",
    expectedCharacters: 6_500,
    maxOutputTokens: 12_288,
    usesTechnicalAppendix: true,
    task: () =>
      "Write the application guide: how a practitioner would use this method in their own work, and when they should not. title and overview frame it.",
    rules: APPLICATION_GUIDE_RULES,
    toBlocks: (value) => ({ applicationGuide: value as NonNullable<ResearchProject["applicationGuide"]> }),
  },
};

export function learningBlockSpec(block: LearningBlockId) {
  const { noun, title, schema, schemaName, maxOutputTokens, expectedCharacters, usesTechnicalAppendix } = specs[block];
  return { noun, title, schema, schemaName, maxOutputTokens, expectedCharacters, usesTechnicalAppendix };
}

/** "the primer, the quiz and the derivations" */
export function learningBlockList(blocks: readonly LearningBlockId[]) {
  const nouns = blocks.map((block) => specs[block].noun);
  return nouns.length <= 1 ? (nouns[0] ?? "") : `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

/** Derinliğin istediği bloklar, üretim sırasıyla: teknik eke dayananlar sonda. */
export function learningBlocksFor(depth: Depth): LearningBlockId[] {
  const required: readonly string[] = LEARNING_REQUIREMENTS[depth];
  return learningBlockIds.filter((block) => required.includes(block));
}

/** Projede henüz olmayan, derinliğin istediği bloklar. */
export function missingLearningBlocks(project: Pick<ResearchProject, "depth"> & LearningBlocks): LearningBlockId[] {
  return learningBlocksFor(project.depth).filter((block) => {
    const value = project[block];
    return value === undefined || (Array.isArray(value) && value.length === 0);
  });
}

export function applyLearningBlock(block: LearningBlockId, value: unknown): LearningBlocks {
  return specs[block].toBlocks(value);
}

/** İstemdeki kanıt: bölüm görünümü artı öğretimin ihtiyaç duyduğu sözlük ve sınırlılıklar. */
export function learningEvidenceView(evidence: PaperEvidence, rejectedClaimIds: readonly string[] = []) {
  const rejected = new Set(rejectedClaimIds);
  const view = sectionEvidenceView(evidence);
  return {
    ...view,
    plainSummary: evidence.plainSummary,
    methods: evidence.methods,
    limitations: evidence.limitations,
    glossary: evidence.glossary.map(({ term, definition }) => ({ term, definition })),
    claims: view.claims.filter((claim) => !rejected.has(claim.id)),
  };
}

function appendixView(appendix: TechnicalAppendix) {
  return {
    equations: appendix.equations.map(({ id, label, expression, latex, variables, claimIds }) => ({ id, label, expression, latex, variables, claimIds })),
    algorithmSteps: appendix.algorithmSteps.map(({ label, detail, claimIds }) => ({ label, detail, claimIds })),
    complexity: appendix.complexity.map(({ operation, cost, claimIds }) => ({ operation, cost, claimIds })),
  };
}

export function buildLearningPrompt(block: LearningBlockId, context: LearningContext) {
  const spec = specs[block];
  const appendix = spec.usesTechnicalAppendix && context.technicalAppendix
    ? `\nTechnical appendix (equations and algorithm the evidence supports; use their ids and claims):\n${JSON.stringify(appendixView(context.technicalAppendix))}\n`
    : "";
  return `You are the teaching editor of an evidence-first research system. A reader will study this paper with what you write: they should come away able to explain it, not just recognise it.

TASK: ${spec.task(context.depth)}

Use ONLY the evidence below. You cannot add facts.

Hard rules:
${bulletList(LEARNING_EVIDENCE_RULES)}
- Write all reader-facing text in ${languageName(context.language)} for audience "${context.audience}" at depth "${context.depth}". Keep official names and technical terms where useful.
- IDs are unique, stable kebab-case strings.
${bulletList(spec.rules)}
${appendix}
Evidence JSON (claims and metrics were already checked against the paper):
${JSON.stringify(learningEvidenceView(context.evidence, context.rejectedClaimIds))}

Return only the schema-compliant object for this task.`;
}

/**
 * Tek bloğun denetimi: eklentinin ve içe aktarmanın kullandığı bütünlük
 * denetimi, artı yalnızca üretimde uygulanan iki kural (reddedilen iddia ve
 * kendi formülünü tekrar eden türetim adımı).
 */
export function validateLearningBlock(block: LearningBlockId, value: unknown, context: LearningContext) {
  const blocks = applyLearningBlock(block, value);
  validateLearningIntegrity({
    evidence: context.evidence,
    depth: context.depth,
    technicalAppendix: context.technicalAppendix,
    ...blocks,
  });

  const issues: string[] = [];
  const rejected = new Set(context.rejectedClaimIds ?? []);
  if (rejected.size) {
    for (const id of citedClaimIds(blocks)) {
      if (rejected.has(id)) issues.push(`${block}: cites ${id}, which a reviewer rejected`);
    }
  }
  const same = (left: string, right: string) => left.replace(/\s+/g, " ").trim().toLowerCase() === right.replace(/\s+/g, " ").trim().toLowerCase();
  blocks.derivations?.forEach((derivation) => derivation.steps.forEach((step) => {
    if (same(step.rationale, step.plain)) issues.push(`derivations.${derivation.id}.${step.id}: the rationale only restates the formula; say why the step follows`);
  }));
  if (issues.length) throw new IntegrityError("Learning", issues);
}

function citedClaimIds(blocks: LearningBlocks) {
  return [
    ...(blocks.primer?.concepts.flatMap((concept) => concept.claimIds) ?? []),
    ...(blocks.quiz?.questions.flatMap((question) => question.claimIds) ?? []),
    ...(blocks.derivations?.flatMap((derivation) => derivation.claimIds) ?? []),
    ...(blocks.interactives?.flatMap((interactive) => interactive.claimIds) ?? []),
    ...(blocks.applicationGuide
      ? [
          ...blocks.applicationGuide.recipe.flatMap((item) => item.claimIds),
          ...blocks.applicationGuide.hyperparameters.flatMap((item) => item.claimIds),
          ...blocks.applicationGuide.pitfalls.flatMap((item) => item.claimIds),
        ]
      : []),
  ];
}

/** Yazılamayan blokların tek cümlelik özeti; kullanıcıya uyarı olarak gidiyor. */
export function describeLearningGaps(failed: ReadonlyArray<{ block: LearningBlockId; reason: string }>) {
  if (!failed.length) return undefined;
  const list = learningBlockList(failed.map(({ block }) => block));
  const reasons = [...new Set(failed.map(({ reason }) => reason))].join(" ");
  return `The learning layer is incomplete: ${list} could not be written. ${reasons} Everything else is complete; the missing parts can be added from the Lab.`;
}
