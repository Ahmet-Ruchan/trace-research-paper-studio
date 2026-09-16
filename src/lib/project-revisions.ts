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

export type ProjectChange = {
  area: "evidence" | "story" | "report" | "technical" | "learning" | "settings";
  /** Sabit, İngilizce, kısa: arayüzde doğrudan gösteriliyor. */
  summary: string;
  /** İçerik dilindeki başlık; varsa okuyucu hangi bölüm olduğunu tanısın diye. */
  subject?: string;
};

const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

function describeFields(fields: string[]) {
  return fields.length === 1 ? fields[0] : `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

function compareSections<T extends { id: string; title: string }>(
  area: ProjectChange["area"],
  noun: string,
  from: readonly T[],
  to: readonly T[],
  fields: Array<[string, (section: T) => unknown]>,
  changes: ProjectChange[],
) {
  const before = new Map(from.map((section) => [section.id, section]));
  const after = new Map(to.map((section) => [section.id, section]));
  for (const section of to) {
    const previous = before.get(section.id);
    if (!previous) {
      changes.push({ area, summary: `${noun} added`, subject: section.title });
      continue;
    }
    const changed = fields.filter(([, read]) => !same(read(previous), read(section))).map(([name]) => name);
    if (changed.length) changes.push({ area, summary: `${noun} ${describeFields(changed)} changed`, subject: section.title });
  }
  for (const section of from) {
    if (!after.has(section.id)) changes.push({ area, summary: `${noun} removed`, subject: section.title });
  }
  const order = (sections: readonly T[]) => sections.map((section) => section.id).filter((id) => before.has(id) && after.has(id));
  if (!same(order(from), order(to))) changes.push({ area, summary: `${noun}s reordered` });
}

/**
 * `from` sürümünden `to` sürümüne ne değişti. Tam bir metin farkı değil —
 * geçmiş panelinde "bu sürüme dönersem neyi kaybederim" sorusunu yanıtlayacak
 * kadar ayrıntı.
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

  const storyHeader = (["title", "dek", "readingTime", "accent", "closing"] as const).filter((key) => !same(from.story[key], to.story[key]));
  if (storyHeader.length) changes.push({ area: "story", summary: `Story ${describeFields(storyHeader)} changed` });
  compareSections("story", "Story section", from.story.sections, to.story.sections, [
    ["kicker", (section) => section.kicker],
    ["title", (section) => section.title],
    ["text", (section) => section.body],
    ["visual", (section) => section.visual],
    ["claims", (section) => [...section.claimIds].sort()],
  ], changes);

  if (from.deepReport || to.deepReport) {
    if (!from.deepReport) changes.push({ area: "report", summary: "Deep report added" });
    else if (!to.deepReport) changes.push({ area: "report", summary: "Deep report removed" });
    else {
      const header = (["title", "dek", "openQuestions"] as const).filter((key) => !same(from.deepReport![key], to.deepReport![key]));
      if (header.length) changes.push({ area: "report", summary: `Report ${describeFields(header)} changed` });
      compareSections("report", "Report section", from.deepReport.sections, to.deepReport.sections, [
        ["kind", (section) => section.kind],
        ["title", (section) => section.title],
        ["summary", (section) => section.summary],
        ["analysis", (section) => section.analysis],
        ["claims", (section) => [...section.claimIds].sort()],
      ], changes);
    }
  }

  if (!same(from.technicalAppendix, to.technicalAppendix)) {
    changes.push({ area: "technical", summary: `Technical appendix ${!from.technicalAppendix ? "added" : !to.technicalAppendix ? "removed" : "changed"}` });
  }

  const learning = [
    ["primer", "Primer"],
    ["derivations", "Derivations"],
    ["quiz", "Quiz"],
    ["interactives", "Interactives"],
    ["applicationGuide", "Application guide"],
    ["figures", "Figures"],
  ] as const;
  for (const [key, label] of learning) {
    const left = from[key];
    const right = to[key];
    if (same(left, right)) continue;
    changes.push({ area: "learning", summary: `${label} ${left === undefined ? "added" : right === undefined ? "removed" : "changed"}` });
  }

  return changes;
}
