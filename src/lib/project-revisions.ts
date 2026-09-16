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

export const revisionReasons = ["edit", "regenerate", "restore", "import", "manual", "agent"] as const;
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

export const revisionIdPattern = /^\d{8}T\d{9}Z-(edit|regenerate|restore|import|manual|agent)-[0-9a-f]{8}$/;

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
  /** Sabit, İngilizce, kısa: arayüzde doğrudan gösteriliyor. */
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

const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

function describeFields(fields: string[]) {
  return fields.length === 1 ? fields[0] : `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

type Field<T> = {
  name: string;
  read: (item: T) => unknown;
  /** Verilirse alan metin olarak farkı gösterilebilir. */
  text?: (item: T) => string;
};

const textField = <T,>(name: string, text: (item: T) => string): Field<T> => ({ name, read: text, text });
const dataField = <T,>(name: string, read: (item: T) => unknown): Field<T> => ({ name, read });
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
  noun: string,
  from: readonly T[],
  to: readonly T[],
  title: (item: T) => string,
  fields: Field<T>[],
  changes: ProjectChange[],
) {
  const before = new Map(from.map((item) => [item.id, item]));
  const after = new Map(to.map((item) => [item.id, item]));
  for (const item of to) {
    const previous = before.get(item.id);
    if (!previous) {
      changes.push({ area, summary: `${noun} added`, subject: title(item) });
      continue;
    }
    const changed = fields.filter((field) => !same(field.read(previous), field.read(item))).map((field) => field.name);
    if (changed.length) {
      changes.push(withTexts(
        { area, summary: `${noun} ${describeFields(changed)} changed`, subject: title(item) },
        changedTexts(fields, previous, item),
      ));
    }
  }
  for (const item of from) {
    if (!after.has(item.id)) changes.push({ area, summary: `${noun} removed`, subject: title(item) });
  }
  const order = (items: readonly T[]) => items.map((item) => item.id).filter((id) => before.has(id) && after.has(id));
  if (!same(order(from), order(to))) changes.push({ area, summary: `${noun}s reordered` });
}

/** Bir bloğun başlık alanları (bölümler dışında kalan metin). */
function compareHeader<T>(area: ProjectChange["area"], label: string, from: T, to: T, fields: Field<T>[], changes: ProjectChange[]) {
  const changed = fields.filter((field) => !same(field.read(from), field.read(to))).map((field) => field.name);
  if (changed.length) {
    changes.push(withTexts({ area, summary: `${label} ${describeFields(changed)} changed` }, changedTexts(fields, from, to)));
  }
}

const lines = (values: readonly string[]) => values.join("\n\n");

/**
 * `from` sürümünden `to` sürümüne ne değişti. Geçmiş panelinde "bu sürüme
 * dönersem neyi kaybederim" sorusunu yanıtlıyor: hangi bölüm, hangi alan ve
 * metin alanlarında kelime kelime ne.
 */
export function describeProjectChanges(from: ResearchProject, to: ResearchProject): ProjectChange[] {
  const changes: ProjectChange[] = [];

  if (!same(from.evidence, to.evidence)) {
    const beforeClaims = new Map(from.evidence.claims.map((claim) => [claim.id, claim]));
    const afterIds = new Set(to.evidence.claims.map((claim) => claim.id));
    const added = to.evidence.claims.filter((claim) => !beforeClaims.has(claim.id)).length;
    const removed = from.evidence.claims.filter((claim) => !afterIds.has(claim.id)).length;
    const edited = to.evidence.claims.filter((claim) => beforeClaims.has(claim.id) && !same(beforeClaims.get(claim.id), claim)).length;
    const parts = [
      added ? `${added} claim${added === 1 ? "" : "s"} added` : "",
      removed ? `${removed} removed` : "",
      edited ? `${edited} edited` : "",
    ].filter(Boolean);
    changes.push({ area: "evidence", summary: parts.length ? `Evidence: ${parts.join(", ")}` : "Evidence details changed" });
  }

  const settings = (["language", "audience", "depth"] as const).filter((key) => from[key] !== to[key]);
  if (settings.length) changes.push({ area: "settings", summary: `${describeFields(settings)} changed` });

  type Story = ResearchProject["story"];
  compareHeader<Story>("story", "Story", from.story, to.story, [
    textField("title", (story) => story.title),
    textField("dek", (story) => story.dek),
    dataField("readingTime", (story) => story.readingTime),
    dataField("accent", (story) => story.accent),
    textField("closing", (story) => `${story.closing.title}\n\n${story.closing.body}`),
  ], changes);
  compareItems("story", "Story section", from.story.sections, to.story.sections, (section) => section.title, [
    textField("kicker", (section) => section.kicker),
    textField("title", (section) => section.title),
    textField("text", (section) => section.body),
    dataField("visual", (section) => section.visual),
    sortedClaims(),
  ], changes);

  if (from.deepReport || to.deepReport) {
    if (!from.deepReport) changes.push({ area: "report", summary: "Deep report added" });
    else if (!to.deepReport) changes.push({ area: "report", summary: "Deep report removed" });
    else {
      type Report = NonNullable<ResearchProject["deepReport"]>;
      compareHeader<Report>("report", "Report", from.deepReport, to.deepReport, [
        textField("title", (report) => report.title),
        textField("dek", (report) => report.dek),
        textField("openQuestions", (report) => lines(report.openQuestions)),
      ], changes);
      compareItems("report", "Report section", from.deepReport.sections, to.deepReport.sections, (section) => section.title, [
        dataField("kind", (section) => section.kind),
        textField("title", (section) => section.title),
        textField("summary", (section) => section.summary),
        textField("analysis", (section) => lines(section.analysis)),
        sortedClaims(),
      ], changes);
    }
  }

  if (!same(from.technicalAppendix, to.technicalAppendix)) {
    if (!from.technicalAppendix || !to.technicalAppendix) {
      changes.push({ area: "technical", summary: `Technical appendix ${!from.technicalAppendix ? "added" : "removed"}` });
    } else {
      const { equations: beforeEquations, ...beforeRest } = from.technicalAppendix;
      const { equations: afterEquations, ...afterRest } = to.technicalAppendix;
      if (!same(beforeRest, afterRest)) changes.push({ area: "technical", summary: "Technical appendix changed" });
      compareItems("technical", "Equation", beforeEquations, afterEquations, (equation) => equation.label, [
        textField("label", (equation) => equation.label),
        textField("expression", (equation) => equation.expression),
        dataField("latex", (equation) => equation.latex),
        textField("explanation", (equation) => equation.explanation),
        textField("variables", (equation) => equation.variables.map((variable) => `${variable.symbol}: ${variable.meaning}`).join("\n")),
        sortedClaims(),
      ], changes);
    }
  }

  const blockChange = (key: "primer" | "derivations" | "quiz" | "interactives" | "applicationGuide" | "figures", label: string) => {
    const left = from[key];
    const right = to[key];
    if (same(left, right)) return false;
    if (left === undefined || right === undefined) {
      changes.push({ area: "learning", summary: `${label} ${left === undefined ? "added" : "removed"}` });
      return false;
    }
    return true;
  };

  // Tek tek yeniden üretilebilen öğrenme öğeleri öğe düzeyinde karşılaştırılıyor.
  if (blockChange("primer", "Primer")) {
    compareHeader("learning", "Primer", from.primer!, to.primer!, [
      textField("title", (primer) => primer.title),
      textField("overview", (primer) => primer.overview),
    ], changes);
    compareItems("learning", "Primer concept", from.primer!.concepts, to.primer!.concepts, (concept) => concept.term, [
      textField("term", (concept) => concept.term),
      dataField("level", (concept) => concept.level),
      textField("intuition", (concept) => concept.intuition),
      textField("formal", (concept) => concept.formal ?? ""),
      textField("whyItMatters", (concept) => concept.whyItMatters),
      dataField("prerequisites", (concept) => [...concept.prerequisiteIds].sort()),
      sortedClaims(),
    ], changes);
  }
  if (blockChange("derivations", "Derivations")) {
    compareItems("learning", "Derivation", from.derivations!, to.derivations!, (derivation) => derivation.title, [
      textField("title", (derivation) => derivation.title),
      textField("goal", (derivation) => derivation.goal),
      dataField("equation", (derivation) => derivation.equationId),
      textField("steps", (derivation) => derivation.steps.map((step) => `${step.plain} — ${step.rationale}`).join("\n")),
      textField("example", (derivation) => derivation.numericExample
        ? `${derivation.numericExample.setup}\n${derivation.numericExample.walkthrough.join("\n")}\n${derivation.numericExample.result}`
        : ""),
      sortedClaims(),
    ], changes);
  }
  if (blockChange("quiz", "Quiz")) {
    compareHeader("learning", "Quiz", from.quiz!, to.quiz!, [
      textField("title", (quiz) => quiz.title),
      textField("intro", (quiz) => quiz.intro),
    ], changes);
    compareItems("learning", "Quiz question", from.quiz!.questions, to.quiz!.questions, (question) => question.prompt, [
      textField("prompt", (question) => question.prompt),
      dataField("kind", (question) => question.kind),
      textField("options", (question) => question.options
        .map((option) => `${option.correct ? "✓" : "✗"} ${option.label} — ${option.explanation}`)
        .join("\n")),
      sortedClaims(),
    ], changes);
  }
  for (const [key, label] of [["interactives", "Interactives"], ["applicationGuide", "Application guide"], ["figures", "Figures"]] as const) {
    if (blockChange(key, label)) changes.push({ area: "learning", summary: `${label} changed` });
  }

  return changes;
}
