import { z } from "zod";
import {
  claimSchema,
  glossaryItemSchema,
  metricSchema,
  paperEvidenceSchema,
  paperMetadataSchema,
  type PaperEvidence,
  type Source,
  type SourceReference,
} from "./schema";
import { IntegrityError } from "./generation-validation";

export const evidencePassIds = ["overview", "methods", "results", "limitations"] as const;
export type EvidencePassId = (typeof evidencePassIds)[number];

export const evidenceOverviewSchema = z.object({
  paper: paperMetadataSchema,
  thesis: z.string(),
  plainSummary: z.string(),
  researchQuestion: z.string(),
  glossary: z.array(glossaryItemSchema),
  claims: z.array(claimSchema).min(1),
});

export const evidenceMethodsSchema = z.object({
  methods: z.array(z.string()).min(1),
  claims: z.array(claimSchema).min(1),
});

export const evidenceResultsSchema = z.object({
  findings: z.array(z.string()).min(1),
  claims: z.array(claimSchema).min(1),
  metrics: z.array(metricSchema),
});

export const evidenceLimitationsSchema = z.object({
  limitations: z.array(z.string()).min(1),
  claims: z.array(claimSchema).min(1),
});

export type EvidencePassOutputs = {
  overview: z.infer<typeof evidenceOverviewSchema>;
  methods: z.infer<typeof evidenceMethodsSchema>;
  results: z.infer<typeof evidenceResultsSchema>;
  limitations: z.infer<typeof evidenceLimitationsSchema>;
};

export const evidencePassSchemas: {
  [Key in EvidencePassId]: z.ZodType<EvidencePassOutputs[Key]>;
} = {
  overview: evidenceOverviewSchema,
  methods: evidenceMethodsSchema,
  results: evidenceResultsSchema,
  limitations: evidenceLimitationsSchema,
};

export const evidenceCheckpointSchema = z.object({
  version: z.literal(1),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  parts: z.object({
    overview: evidenceOverviewSchema.optional(),
    methods: evidenceMethodsSchema.optional(),
    results: evidenceResultsSchema.optional(),
    limitations: evidenceLimitationsSchema.optional(),
  }),
});

export type EvidenceCheckpoint = z.infer<typeof evidenceCheckpointSchema>;

export const evidencePassLabels: Record<EvidencePassId, string> = {
  overview: "Genel çerçeve",
  methods: "Yöntem ve mimari",
  results: "Bulgular ve metrikler",
  limitations: "Sınırlar ve kapsam",
};

function referencesForPass(value: EvidencePassOutputs[EvidencePassId]) {
  const references: Array<{ owner: string; reference: SourceReference }> = [];
  if ("claims" in value) {
    value.claims.forEach((claim) =>
      claim.sourceRefs.forEach((reference) => references.push({ owner: claim.id, reference })),
    );
  }
  if ("metrics" in value) {
    value.metrics.forEach((metric) =>
      references.push({ owner: metric.id, reference: metric.sourceRef }),
    );
  }
  if ("glossary" in value) {
    value.glossary.forEach((item) => {
      if (item.sourceRef) references.push({ owner: item.term, reference: item.sourceRef });
    });
  }
  return references;
}

export function validateEvidencePass(
  passId: EvidencePassId,
  value: EvidencePassOutputs[EvidencePassId],
  sourceIds: Set<string>,
) {
  const issues: string[] = [];
  const ids = value.claims.map((claim) => claim.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) issues.push(`Tekrarlanan claim ID: ${duplicateIds.join(", ")}`);

  referencesForPass(value).forEach(({ owner, reference }) => {
    if (!sourceIds.has(reference.sourceId)) {
      issues.push(`${owner} bilinmeyen kaynak kullanıyor: ${reference.sourceId}`);
    }
    if (reference.sourceId === "paper" && !reference.page) {
      issues.push(`${owner} için görünür PDF sayfası eksik`);
    }
    if (!reference.excerpt.trim()) issues.push(`${owner} için doğrulanabilir excerpt eksik`);
  });

  const allowedKinds = {
    overview: new Set(["background", "author-interpretation"]),
    methods: new Set(["method", "background"]),
    results: new Set(["reported-result", "author-interpretation", "background"]),
    limitations: new Set(["limitation", "author-interpretation"]),
  }[passId];
  const expectedPrefix = {
    overview: "overview-",
    methods: "method-",
    results: "result-",
    limitations: "limit-",
  }[passId];
  value.claims.forEach((claim) => {
    if (!allowedKinds.has(claim.kind)) {
      issues.push(`${claim.id} claim türü ${passId} aşamasına ait değil: ${claim.kind}`);
    }
    if (!claim.id.startsWith(expectedPrefix)) {
      issues.push(`${claim.id} ID değeri "${expectedPrefix}" ile başlamalı`);
    }
  });

  if (passId === "methods" && !value.claims.some((claim) => claim.kind === "method")) {
    issues.push("Yöntem aşaması en az bir method claim’i içermeli");
  }
  if (passId === "limitations" && !value.claims.some((claim) => claim.kind === "limitation")) {
    issues.push("Sınırlılık aşaması en az bir limitation claim’i içermeli");
  }

  if (issues.length) throw new IntegrityError(`${evidencePassLabels[passId]} evidence`, issues);
}

export function mergeEvidenceParts(
  parts: EvidenceCheckpoint["parts"],
  sources: Source[],
): PaperEvidence {
  const { overview, methods, results, limitations } = parts;
  if (!overview || !methods || !results || !limitations) {
    throw new IntegrityError("Evidence merge", ["Dört evidence aşamasının tamamlanması gerekli"]);
  }

  return paperEvidenceSchema.parse({
    paper: overview.paper,
    sources,
    thesis: overview.thesis,
    plainSummary: overview.plainSummary,
    researchQuestion: overview.researchQuestion,
    methods: methods.methods,
    findings: results.findings,
    limitations: limitations.limitations,
    claims: [
      ...overview.claims,
      ...methods.claims,
      ...results.claims,
      ...limitations.claims,
    ],
    metrics: results.metrics,
    glossary: overview.glossary,
  });
}
