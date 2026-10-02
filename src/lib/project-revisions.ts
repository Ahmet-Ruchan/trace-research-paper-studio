import { z } from "zod";
import { canonicalJson } from "./canonical-json";
import type { ResearchProject } from "./schema";

/**
 * Proje revizyonları.
 *
 * Kütüphane bir projeyi dosyaya yazarken önceki hâlini revizyon olarak saklar.
 * Bu modül saf: dosya adı biçimi, kayıt şeması, "şimdi anlık görüntü alınmalı
 * mı" kararı ve iki sürüm arasındaki farkın özeti. Dosya sistemi işi ayrı —
 * stüdyoda `trace-storage.ts`, plugin'de köprü. İkisi de BU kuralları kullanıyor
 * (plugin paketlenmiş doğrulayıcı üzerinden); biri "on dakikada bir" derken
 * öteki "her yazımda" derse geçmiş iki yerden farklı büyür.
 */

export const revisionReasons = ["edit", "regenerate", "restore", "import", "manual", "agent", "verify", "learning"] as const;
export type RevisionReason = (typeof revisionReasons)[number];
export const revisionReasonSchema = z.enum(revisionReasons);

/** Proje başına tutulan revizyon sayısı. Her biri projenin tam kopyası. */
export const REVISION_LIMIT = 40;

/**
 * Yazarken otomatik kaydetme her yarım saniyede bir çalışıyor. Her yazımda
 * revizyon almak, bir paragrafı düzelten kullanıcının geçmişini dakikalar içinde
 * doldurup gerçekten önemli sürümleri limitin dışına iterdi.
 */
export const EDIT_COALESCE_MS = 10 * 60 * 1000;

export const MAX_REVISION_LABEL = 80;

// Nedenler listeden türetiliyor: desen elle yazılıyken listeye eklenen yeni bir
// neden kimlik üretiminde reddediliyor ve kayıt 500 ile düşüyordu.
export const revisionIdPattern = new RegExp(`^\\d{8}T\\d{9}Z-(${revisionReasons.join("|")})-[0-9a-f]{8}$`);

export const revisionRecordSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(revisionIdPattern),
  projectId: z.string(),
  savedAt: z.string(),
  reason: revisionReasonSchema,
  label: z.string().max(MAX_REVISION_LABEL).optional(),
  project: z.unknown(),
});
export type RevisionRecord = z.infer<typeof revisionRecordSchema>;

export type RevisionSummary = {
  id: string;
  savedAt: string;
  reason: RevisionReason;
  label?: string;
  title: string;
  projectUpdatedAt: string;
  claims: number;
  storySections: number;
  reportSections: number;
};

/**
 * "20260916T081530123Z-regenerate-1a2b3c4d". Sözlük sırası zaman sırası,
 * dolayısıyla dizin listesi ek bir dizin dosyası olmadan sıralanabiliyor.
 * Kimlik dosya adına girdiği için biçim kesin: yol ayırıcı taşıyamaz.
 */
export function revisionId(savedAt: string, reason: RevisionReason, random: string) {
  const compact = savedAt.replace(/[-:.]/g, "");
  const id = `${compact}-${reason}-${random.toLowerCase().slice(0, 8)}`;
  if (!revisionIdPattern.test(id)) throw new Error(`Cannot build a revision id from ${savedAt} / ${random}`);
  return id;
}

export function revisionFileName(id: string) {
  if (!revisionIdPattern.test(id)) throw new Error("Invalid revision id");
  return `${id}.revision.json`;
}

export function isRevisionFileName(name: string) {
  return name.endsWith(".revision.json") && revisionIdPattern.test(name.slice(0, -".revision.json".length));
}

/** `updatedAt` dışındaki her şey. Bir projeyi yalnızca açmak zaman damgasını yeniliyor, içeriği değil. */
export function sameProjectContent(left: unknown, right: unknown) {
  const strip = (value: unknown) =>
    value && typeof value === "object" ? { ...(value as Record<string, unknown>), updatedAt: undefined } : value;
  return canonicalJson(strip(left)) === canonicalJson(strip(right));
}

/**
 * Üzerine yazılmak üzere olan sürüm revizyon olarak saklanmalı mı?
 *
 * - İçerik aynıysa hayır: yalnızca zaman damgası değişmiş.
 * - Düzenleme ise en yeni revizyon on dakikadan eskiyse evet. Böylece uzun bir
 *   düzenleme oturumu her on dakikada bir iz bırakıyor.
 * - Yeniden üretim, geri yükleme, içe aktarma, ajan yazımı ve elle kayıt her
 *   zaman evet: bunlar tek hamlede büyük değişiklikler ve geri dönülebilmeli.
 */
export function shouldSnapshot(options: {
  previous: unknown;
  next: unknown;
  reason: RevisionReason;
  newestRevisionAt?: string;
  now: string;
}) {
  if (options.previous === undefined) return false;
  if (options.reason !== "manual" && sameProjectContent(options.previous, options.next)) return false;
  if (options.reason !== "edit") return true;
  if (!options.newestRevisionAt) return true;
  return Date.parse(options.now) - Date.parse(options.newestRevisionAt) >= EDIT_COALESCE_MS;
}

export function summarizeRevision(record: RevisionRecord, project: ResearchProject): RevisionSummary {
  return {
    id: record.id,
    savedAt: record.savedAt,
    reason: record.reason,
    label: record.label,
    title: project.story.title,
    projectUpdatedAt: project.updatedAt,
    claims: project.evidence.claims.length,
    storySections: project.story.sections.length,
    reportSections: project.deepReport?.sections.length ?? 0,
  };
}

/** Limitin dışında kalan revizyon kimlikleri; en eskiler. */
export function revisionsToPrune(ids: readonly string[], limit = REVISION_LIMIT) {
  return [...ids].sort().reverse().slice(limit);
}

/* ------------------------------------------------------------------ *
 * Fark özeti
 * ------------------------------------------------------------------ */

export type TextChange = {
  /** Alanın adı: "text", "summary", "options". */
  field: string;
  before: string;
  after: string;
};

export type ProjectChange = {
  area: "evidence" | "story" | "report" | "technical" | "learning" | "settings";
  /** Kısa, arayüzün dilinde (`RevisionWords`, varsayılan İngilizce): doğrudan gösteriliyor. */
  summary: string;
  /** İçerik dilindeki başlık; varsa okuyucu hangi bölüm olduğunu tanısın diye. */
  subject?: string;
  /**
   * Değişen metin alanları, `from` ve `to` halleriyle. Arayüz bunlardan
   * kelime farkı çiziyor; yapısal alanlar (görsel, iddia listesi) burada yok,
   * onlar için özet cümlesi yeterli.
   */
  texts?: TextChange[];
};

/** Farkı anlatan blok ve öğe adları. */
export type RevisionNoun =
  | "story" | "storySection" | "deepReport" | "report" | "reportSection" | "technicalAppendix" | "equation"
  | "primer" | "primerConcept" | "derivations" | "derivation" | "quiz" | "quizQuestion" | "misreadings" | "misreading"
  | "interactives" | "applicationGuide" | "figures";

/** Karşılaştırılan alanlar; `TextChange.field` bunlardan biri. */
export type RevisionField =
  | "title" | "dek" | "readingTime" | "accent" | "closing" | "kicker" | "text" | "visual" | "claims"
  | "openQuestions" | "kind" | "summary" | "analysis" | "label" | "expression" | "latex" | "explanation" | "variables"
  | "overview" | "term" | "level" | "intuition" | "formal" | "whyItMatters" | "prerequisites" | "goal" | "equation"
  | "steps" | "example" | "intro" | "prompt" | "options" | "misreading" | "trap" | "correction"
  | "language" | "audience" | "depth";

/**
 * Fark özetinin cümleleri. Varsayılan İngilizce; stüdyo arayüzün dilindekini
 * veriyor (Türkçesi `src/i18n/messages`). Cümleler bütün halinde: dillerin
 * kelime sırası farklı.
 */
export type RevisionWords = {
  nouns: Record<RevisionNoun, string>;
  /** Alanın ekrandaki adı; `TextChange.field` anahtar olarak kalıyor. */
  fields: Record<RevisionField, string>;
  /** "a, b and c" */
  list: (items: readonly string[]) => string;
  added: (noun: string) => string;
  removed: (noun: string) => string;
  /** Bir bölümün ya da başlığın alanları: "Story section text and claims changed". */
  fieldsChanged: (noun: string, fields: string) => string;
  /** Bütün bir blok: "Interactives changed". */
  changed: (noun: string) => string;
  reordered: (noun: string) => string;
  /** Projenin dil, kitle, derinlik ayarları. */
  settingsChanged: (fields: string) => string;
  evidence: (counts: { added: number; removed: number; edited: number }) => string;
};

export const REVISION_WORDS: RevisionWords = {
  nouns: {
    story: "Story",
    storySection: "Story section",
    deepReport: "Deep report",
    report: "Report",
    reportSection: "Report section",
    technicalAppendix: "Technical appendix",
    equation: "Equation",
    primer: "Primer",
    primerConcept: "Primer concept",
    derivations: "Derivations",
    derivation: "Derivation",
    quiz: "Quiz",
    quizQuestion: "Quiz question",
    misreadings: "Common misreadings",
    misreading: "Misreading",
    interactives: "Interactives",
    applicationGuide: "Application guide",
    figures: "Figures",
  },
  fields: {
    title: "title",
    dek: "dek",
    readingTime: "readingTime",
    accent: "accent",
    closing: "closing",
    kicker: "kicker",
    text: "text",
    visual: "visual",
    claims: "claims",
    openQuestions: "openQuestions",
    kind: "kind",
    summary: "summary",
    analysis: "analysis",
    label: "label",
    expression: "expression",
    latex: "latex",
    explanation: "explanation",
    variables: "variables",
    overview: "overview",
    term: "term",
    level: "level",
    intuition: "intuition",
    formal: "formal",
    whyItMatters: "whyItMatters",
    prerequisites: "prerequisites",
    goal: "goal",
    equation: "equation",
    steps: "steps",
    example: "example",
    intro: "intro",
    prompt: "prompt",
    options: "options",
    misreading: "misreading",
    trap: "trap",
    correction: "correction",
    language: "language",
    audience: "audience",
    depth: "depth",
  },
  list: (items) => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`),
  added: (noun) => `${noun} added`,
  removed: (noun) => `${noun} removed`,
  fieldsChanged: (noun, fields) => `${noun} ${fields} changed`,
  changed: (noun) => `${noun} changed`,
  reordered: (noun) => `${noun}s reordered`,
  settingsChanged: (fields) => `${fields} changed`,
  evidence: ({ added, removed, edited }) => {
    const parts = [
      added ? `${added} claim${added === 1 ? "" : "s"} added` : "",
      removed ? `${removed} removed` : "",
      edited ? `${edited} edited` : "",
    ].filter(Boolean);
    return parts.length ? `Evidence: ${parts.join(", ")}` : "Evidence details changed";
  },
};

const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

/** Bir alanın ekrandaki adı; bilinmeyen alan adıyla görünüyor. */
export function revisionFieldLabel(name: string, words: RevisionWords = REVISION_WORDS) {
  return Object.hasOwn(words.fields, name) ? words.fields[name as RevisionField] : name;
}

function describeFields(fields: readonly RevisionField[], words: RevisionWords) {
  return words.list(fields.map((name) => words.fields[name]));
}

type Field<T> = {
  name: RevisionField;
  read: (item: T) => unknown;
  /** Verilirse alan metin olarak farkı gösterilebilir. */
  text?: (item: T) => string;
};

const textField = <T,>(name: RevisionField, text: (item: T) => string): Field<T> => ({ name, read: text, text });
const dataField = <T,>(name: RevisionField, read: (item: T) => unknown): Field<T> => ({ name, read });
const sortedClaims = <T extends { claimIds: readonly string[] }>(): Field<T> => dataField("claims", (item) => [...item.claimIds].sort());

function changedTexts<T>(fields: Field<T>[], before: T, after: T): TextChange[] {
  return fields.flatMap((field) => (field.text && !same(field.read(before), field.read(after))
    ? [{ field: field.name, before: field.text(before), after: field.text(after) }]
    : []));
}

function withTexts(change: ProjectChange, texts: TextChange[]): ProjectChange {
  return texts.length ? { ...change, texts } : change;
}

function compareItems<T extends { id: string }>(
  area: ProjectChange["area"],
  noun: RevisionNoun,
  from: readonly T[],
  to: readonly T[],
  title: (item: T) => string,
  fields: Field<T>[],
  changes: ProjectChange[],
  words: RevisionWords,
) {
  const name = words.nouns[noun];
  const before = new Map(from.map((item) => [item.id, item]));
  const after = new Map(to.map((item) => [item.id, item]));
  for (const item of to) {
    const previous = before.get(item.id);
    if (!previous) {
      changes.push({ area, summary: words.added(name), subject: title(item) });
      continue;
    }
    const changed = fields.filter((field) => !same(field.read(previous), field.read(item))).map((field) => field.name);
    if (changed.length) {
      changes.push(withTexts(
        { area, summary: words.fieldsChanged(name, describeFields(changed, words)), subject: title(item) },
        changedTexts(fields, previous, item),
      ));
    }
  }
  for (const item of from) {
    if (!after.has(item.id)) changes.push({ area, summary: words.removed(name), subject: title(item) });
  }
  const order = (items: readonly T[]) => items.map((item) => item.id).filter((id) => before.has(id) && after.has(id));
  if (!same(order(from), order(to))) changes.push({ area, summary: words.reordered(name) });
}

/** Bir bloğun başlık alanları (bölümler dışında kalan metin). */
function compareHeader<T>(area: ProjectChange["area"], noun: RevisionNoun, from: T, to: T, fields: Field<T>[], changes: ProjectChange[], words: RevisionWords) {
  const changed = fields.filter((field) => !same(field.read(from), field.read(to))).map((field) => field.name);
  if (changed.length) {
    changes.push(withTexts({ area, summary: words.fieldsChanged(words.nouns[noun], describeFields(changed, words)) }, changedTexts(fields, from, to)));
  }
}

const lines = (values: readonly string[]) => values.join("\n\n");

/**
 * `from` sürümünden `to` sürümüne ne değişti. Geçmiş panelinde "bu sürüme
 * dönersem neyi kaybederim" sorusunu yanıtlıyor: hangi bölüm, hangi alan ve
 * metin alanlarında kelime kelime ne. Özetler `words` dilinde (varsayılan İngilizce).
 */
export function describeProjectChanges(from: ResearchProject, to: ResearchProject, words: RevisionWords = REVISION_WORDS): ProjectChange[] {
  const changes: ProjectChange[] = [];
  const { nouns } = words;

  if (!same(from.evidence, to.evidence)) {
    const beforeClaims = new Map(from.evidence.claims.map((claim) => [claim.id, claim]));
    const afterIds = new Set(to.evidence.claims.map((claim) => claim.id));
    const added = to.evidence.claims.filter((claim) => !beforeClaims.has(claim.id)).length;
    const removed = from.evidence.claims.filter((claim) => !afterIds.has(claim.id)).length;
    const edited = to.evidence.claims.filter((claim) => beforeClaims.has(claim.id) && !same(beforeClaims.get(claim.id), claim)).length;
    changes.push({ area: "evidence", summary: words.evidence({ added, removed, edited }) });
  }

  const settings = (["language", "audience", "depth"] as const).filter((key) => from[key] !== to[key]);
  if (settings.length) changes.push({ area: "settings", summary: words.settingsChanged(describeFields(settings, words)) });

  type Story = ResearchProject["story"];
  compareHeader<Story>("story", "story", from.story, to.story, [
    textField("title", (story) => story.title),
    textField("dek", (story) => story.dek),
    dataField("readingTime", (story) => story.readingTime),
    dataField("accent", (story) => story.accent),
    textField("closing", (story) => `${story.closing.title}\n\n${story.closing.body}`),
  ], changes, words);
  compareItems("story", "storySection", from.story.sections, to.story.sections, (section) => section.title, [
    textField("kicker", (section) => section.kicker),
    textField("title", (section) => section.title),
    textField("text", (section) => section.body),
    dataField("visual", (section) => section.visual),
    sortedClaims(),
  ], changes, words);

  if (from.deepReport || to.deepReport) {
    if (!from.deepReport) changes.push({ area: "report", summary: words.added(nouns.deepReport) });
    else if (!to.deepReport) changes.push({ area: "report", summary: words.removed(nouns.deepReport) });
    else {
      type Report = NonNullable<ResearchProject["deepReport"]>;
      compareHeader<Report>("report", "report", from.deepReport, to.deepReport, [
        textField("title", (report) => report.title),
        textField("dek", (report) => report.dek),
        textField("openQuestions", (report) => lines(report.openQuestions)),
      ], changes, words);
      compareItems("report", "reportSection", from.deepReport.sections, to.deepReport.sections, (section) => section.title, [
        dataField("kind", (section) => section.kind),
        textField("title", (section) => section.title),
        textField("summary", (section) => section.summary),
        textField("analysis", (section) => lines(section.analysis)),
        sortedClaims(),
      ], changes, words);
    }
  }

  if (!same(from.technicalAppendix, to.technicalAppendix)) {
    if (!from.technicalAppendix || !to.technicalAppendix) {
      const noun = nouns.technicalAppendix;
      changes.push({ area: "technical", summary: !from.technicalAppendix ? words.added(noun) : words.removed(noun) });
    } else {
      const { equations: beforeEquations, ...beforeRest } = from.technicalAppendix;
      const { equations: afterEquations, ...afterRest } = to.technicalAppendix;
      if (!same(beforeRest, afterRest)) changes.push({ area: "technical", summary: words.changed(nouns.technicalAppendix) });
      compareItems("technical", "equation", beforeEquations, afterEquations, (equation) => equation.label, [
        textField("label", (equation) => equation.label),
        textField("expression", (equation) => equation.expression),
        dataField("latex", (equation) => equation.latex),
        textField("explanation", (equation) => equation.explanation),
        textField("variables", (equation) => equation.variables.map((variable) => `${variable.symbol}: ${variable.meaning}`).join("\n")),
        sortedClaims(),
      ], changes, words);
    }
  }

  const blockChange = (key: "primer" | "derivations" | "quiz" | "misreadings" | "interactives" | "applicationGuide" | "figures", noun: RevisionNoun) => {
    const left = from[key];
    const right = to[key];
    if (same(left, right)) return false;
    if (left === undefined || right === undefined) {
      changes.push({ area: "learning", summary: left === undefined ? words.added(nouns[noun]) : words.removed(nouns[noun]) });
      return false;
    }
    return true;
  };

  // Tek tek yeniden üretilebilen öğrenme öğeleri öğe düzeyinde karşılaştırılıyor.
  if (blockChange("primer", "primer")) {
    compareHeader("learning", "primer", from.primer!, to.primer!, [
      textField("title", (primer) => primer.title),
      textField("overview", (primer) => primer.overview),
    ], changes, words);
    compareItems("learning", "primerConcept", from.primer!.concepts, to.primer!.concepts, (concept) => concept.term, [
      textField("term", (concept) => concept.term),
      dataField("level", (concept) => concept.level),
      textField("intuition", (concept) => concept.intuition),
      textField("formal", (concept) => concept.formal ?? ""),
      textField("whyItMatters", (concept) => concept.whyItMatters),
      dataField("prerequisites", (concept) => [...concept.prerequisiteIds].sort()),
      sortedClaims(),
    ], changes, words);
  }
  if (blockChange("derivations", "derivations")) {
    compareItems("learning", "derivation", from.derivations!, to.derivations!, (derivation) => derivation.title, [
      textField("title", (derivation) => derivation.title),
      textField("goal", (derivation) => derivation.goal),
      dataField("equation", (derivation) => derivation.equationId),
      textField("steps", (derivation) => derivation.steps.map((step) => `${step.plain} — ${step.rationale}`).join("\n")),
      textField("example", (derivation) => derivation.numericExample
        ? `${derivation.numericExample.setup}\n${derivation.numericExample.walkthrough.join("\n")}\n${derivation.numericExample.result}`
        : ""),
      sortedClaims(),
    ], changes, words);
  }
  if (blockChange("quiz", "quiz")) {
    compareHeader("learning", "quiz", from.quiz!, to.quiz!, [
      textField("title", (quiz) => quiz.title),
      textField("intro", (quiz) => quiz.intro),
    ], changes, words);
    compareItems("learning", "quizQuestion", from.quiz!.questions, to.quiz!.questions, (question) => question.prompt, [
      textField("prompt", (question) => question.prompt),
      dataField("kind", (question) => question.kind),
      textField("options", (question) => question.options
        .map((option) => `${option.correct ? "✓" : "✗"} ${option.label} — ${option.explanation}`)
        .join("\n")),
      sortedClaims(),
    ], changes, words);
  }
  if (blockChange("misreadings", "misreadings")) {
    compareHeader("learning", "misreadings", from.misreadings!, to.misreadings!, [
      textField("title", (block) => block.title),
      textField("intro", (block) => block.intro),
    ], changes, words);
    compareItems("learning", "misreading", from.misreadings!.items, to.misreadings!.items, (item) => item.misreading, [
      textField("misreading", (item) => item.misreading),
      dataField("trap", (item) => item.trap),
      textField("correction", (item) => item.correction),
      sortedClaims(),
    ], changes, words);
  }
  for (const key of ["interactives", "applicationGuide", "figures"] as const) {
    if (blockChange(key, key)) changes.push({ area: "learning", summary: words.changed(nouns[key]) });
  }

  return changes;
}
