import { ZodError } from "zod";
import type { PaperEvidence, SourceReference, StorySpec } from "./schema";

export class IntegrityError extends Error {
  readonly issues: string[];

  constructor(stage: string, issues: string[]) {
    super(`${stage} bütünlük denetimi başarısız: ${issues.join("; ")}`);
    this.name = "IntegrityError";
    this.issues = issues;
  }
}

function duplicates(values: string[]) {
  const seen = new Set<string>();
  return [...new Set(values.filter((value) => (seen.has(value) ? true : !seen.add(value))))];
}

function checkReference(
  reference: SourceReference,
  owner: string,
  sourceIds: Set<string>,
  issues: string[],
) {
  if (!sourceIds.has(reference.sourceId)) {
    issues.push(`${owner} bilinmeyen kaynak kullanıyor: ${reference.sourceId}`);
  }
  if (!reference.excerpt.trim()) issues.push(`${owner} için doğrulanabilir excerpt eksik`);
  if (reference.sourceId === "paper" && !reference.page) {
    issues.push(`${owner} için PDF sayfası eksik`);
  }
}

export function validateEvidenceIntegrity(evidence: PaperEvidence) {
  const issues: string[] = [];
  const sourceIds = new Set(evidence.sources.map((source) => source.id));
  const duplicateSources = duplicates(evidence.sources.map((source) => source.id));
  const duplicateClaims = duplicates(evidence.claims.map((claim) => claim.id));
  const duplicateMetrics = duplicates(evidence.metrics.map((metric) => metric.id));

  if (!sourceIds.has("paper")) issues.push('Ana PDF kaynağı "paper" eksik');
  if (duplicateSources.length) issues.push(`Tekrarlanan source ID: ${duplicateSources.join(", ")}`);
  if (duplicateClaims.length) issues.push(`Tekrarlanan claim ID: ${duplicateClaims.join(", ")}`);
  if (duplicateMetrics.length) issues.push(`Tekrarlanan metric ID: ${duplicateMetrics.join(", ")}`);

  evidence.claims.forEach((claim) => {
    claim.sourceRefs.forEach((reference) =>
      checkReference(reference, `Claim ${claim.id}`, sourceIds, issues),
    );
    if (claim.confidence === "verified" && claim.sourceRefs.every((reference) => !reference.excerpt.trim())) {
      issues.push(`Verified claim ${claim.id} için doğrulanabilir excerpt eksik`);
    }
  });
  evidence.metrics.forEach((metric) =>
    checkReference(metric.sourceRef, `Metric ${metric.id}`, sourceIds, issues),
  );
  evidence.glossary.forEach((item) => {
    if (item.sourceRef) checkReference(item.sourceRef, `Terim ${item.term}`, sourceIds, issues);
  });

  if (!evidence.claims.some((claim) => claim.kind === "method")) {
    issues.push("En az bir yöntem claim’i gerekli");
  }
  if (!evidence.claims.some((claim) => claim.kind === "limitation")) {
    issues.push("En az bir sınırlılık claim’i gerekli");
  }
  if (!evidence.claims.some((claim) => claim.confidence === "verified")) {
    issues.push("En az bir doğrudan doğrulanmış claim gerekli");
  }

  if (issues.length) throw new IntegrityError("Evidence", issues);
}

export function validateStoryIntegrity(
  story: StorySpec,
  evidence: PaperEvidence,
  expectedSectionCount: number,
) {
  const issues: string[] = [];
  const claims = new Map(evidence.claims.map((claim) => [claim.id, claim]));
  const metricValues = evidence.metrics.map((metric) => metric.value);
  const duplicateSections = duplicates(story.sections.map((section) => section.id));

  if (story.sections.length !== expectedSectionCount) {
    issues.push(`${expectedSectionCount} yerine ${story.sections.length} bölüm üretildi`);
  }
  if (duplicateSections.length) issues.push(`Tekrarlanan section ID: ${duplicateSections.join(", ")}`);

  story.sections.forEach((section, index) => {
    const expectedIndex = String(index + 1).padStart(2, "0");
    if (section.indexLabel !== expectedIndex) {
      issues.push(`${section.id} indexLabel değeri ${expectedIndex} olmalı`);
    }
    section.claimIds.forEach((claimId) => {
      if (!claims.has(claimId)) issues.push(`${section.id} bilinmeyen claim kullanıyor: ${claimId}`);
    });
    if (section.visual.type === "comparison") {
      section.visual.items.forEach((item) => {
        const exists = metricValues.some((value) => Math.abs(value - item.value) < 1e-9);
        if (!exists) issues.push(`${section.id} görselindeki ${item.value} evidence metrics içinde yok`);
      });
    }
  });

  const linkedClaims = story.sections.flatMap((section) =>
    section.claimIds.map((claimId) => claims.get(claimId)).filter(Boolean),
  );
  if (!linkedClaims.some((claim) => claim?.kind === "method")) {
    issues.push("Story bir yöntem claim’ine bağlanmalı");
  }
  if (!linkedClaims.some((claim) => claim?.kind === "limitation")) {
    issues.push("Story bir sınırlılık claim’ine bağlanmalı");
  }

  if (issues.length) throw new IntegrityError("Story", issues);
}

export function describeValidationError(error: unknown) {
  if (error instanceof IntegrityError) return error.issues;
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
  }
  return [error instanceof Error ? error.message : "Bilinmeyen doğrulama hatası"];
}
