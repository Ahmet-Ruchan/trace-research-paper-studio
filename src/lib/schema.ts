import { z } from "zod";

export const sourceSchema = z.object({
  id: z.string(),
  type: z.enum(["paper", "web"]),
  title: z.string(),
  url: z.string().optional(),
  fileName: z.string().optional(),
});

export const sourceReferenceSchema = z.object({
  sourceId: z.string(),
  page: z.number().int().positive().optional(),
  excerpt: z.string(),
  locator: z.string().optional(),
});

export const claimSchema = z.object({
  id: z.string(),
  statement: z.string(),
  kind: z.enum([
    "reported-result",
    "author-interpretation",
    "method",
    "background",
    "limitation",
  ]),
  confidence: z.enum(["verified", "needs-review"]),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
});

export const metricSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number(),
  displayValue: z.string(),
  unit: z.string(),
  context: z.string(),
  sourceRef: sourceReferenceSchema,
});

export const glossaryItemSchema = z.object({
  term: z.string(),
  definition: z.string(),
  sourceRef: sourceReferenceSchema.optional(),
});

export const paperMetadataSchema = z.object({
  title: z.string(),
  authors: z.array(z.string()),
  year: z.string(),
  venue: z.string(),
  doi: z.string().optional(),
});

export const paperEvidenceSchema = z.object({
  paper: paperMetadataSchema,
  sources: z.array(sourceSchema).min(1),
  thesis: z.string(),
  plainSummary: z.string(),
  researchQuestion: z.string(),
  methods: z.array(z.string()).min(1),
  findings: z.array(z.string()).min(1),
  limitations: z.array(z.string()).min(1),
  claims: z.array(claimSchema).min(4),
  metrics: z.array(metricSchema),
  glossary: z.array(glossaryItemSchema),
});

const visualBaseSchema = z.object({
  eyebrow: z.string(),
  caption: z.string(),
});

export const visualSchema = z.discriminatedUnion("type", [
  visualBaseSchema.extend({
    type: z.literal("metric"),
    items: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        note: z.string(),
      }),
    ),
  }),
  visualBaseSchema.extend({
    type: z.literal("flow"),
    items: z.array(
      z.object({
        label: z.string(),
        detail: z.string(),
      }),
    ),
  }),
  visualBaseSchema.extend({
    type: z.literal("comparison"),
    items: z.array(
      z.object({
        label: z.string(),
        value: z.number(),
        displayValue: z.string(),
        highlight: z.boolean(),
      }),
    ),
  }),
  visualBaseSchema.extend({
    type: z.literal("concept"),
    center: z.string(),
    items: z.array(
      z.object({
        label: z.string(),
        detail: z.string(),
      }),
    ),
  }),
  visualBaseSchema.extend({
    type: z.literal("layers"),
    items: z.array(
      z.object({
        label: z.string(),
        detail: z.string(),
        tone: z.enum(["paper", "accent", "ink"]),
      }),
    ),
  }),
  visualBaseSchema.extend({
    type: z.literal("quote"),
    quote: z.string(),
    attribution: z.string(),
  }),
  visualBaseSchema.extend({
    type: z.literal("architecture"),
    nodes: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        detail: z.string(),
        group: z.enum(["input", "core", "output", "evidence"]),
      }),
    ).min(3).max(8),
    edges: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string(),
      }),
    ).min(2).max(12),
  }),
  visualBaseSchema.extend({
    type: z.literal("equation"),
    formula: z.string(),
    terms: z.array(
      z.object({
        symbol: z.string(),
        label: z.string(),
        detail: z.string(),
      }),
    ).min(2).max(7),
    steps: z.array(z.string()).min(2).max(5),
  }),
  visualBaseSchema.extend({
    type: z.literal("timeline"),
    items: z.array(
      z.object({
        label: z.string(),
        detail: z.string(),
        tone: z.enum(["paper", "accent", "ink"]),
      }),
    ).min(3).max(7),
  }),
  visualBaseSchema.extend({
    type: z.literal("matrix"),
    columns: z.array(z.string()).min(2).max(5),
    rows: z.array(
      z.object({
        label: z.string(),
        cells: z.array(
          z.object({
            label: z.string(),
            tone: z.enum(["low", "medium", "high", "neutral"]),
          }),
        ).min(2).max(5),
      }),
    ).min(2).max(6),
  }),
  visualBaseSchema.extend({
    type: z.literal("infographic"),
    items: z.array(
      z.object({
        label: z.string(),
        detail: z.string(),
        badge: z.string(),
      }),
    ).min(3).max(6),
  }),
]);

export const storySectionSchema = z.object({
  id: z.string(),
  indexLabel: z.string(),
  kicker: z.string(),
  title: z.string(),
  body: z.string(),
  claimIds: z.array(z.string()).min(1),
  visual: visualSchema,
});

export const storySpecSchema = z.object({
  title: z.string(),
  dek: z.string(),
  readingTime: z.string(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sections: z.array(storySectionSchema).min(5).max(8),
  closing: z.object({
    title: z.string(),
    body: z.string(),
  }),
});

export const deepReportSectionSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "contribution",
    "mechanism",
    "experiment",
    "critique",
    "reproduction",
    "implication",
  ]),
  title: z.string(),
  summary: z.string(),
  analysis: z.array(z.string()).min(2).max(5),
  claimIds: z.array(z.string()).min(1),
});

export const deepReportSchema = z.object({
  title: z.string(),
  dek: z.string(),
  readingTime: z.string(),
  sections: z.array(deepReportSectionSchema).min(6).max(9),
  openQuestions: z.array(z.string()).min(3).max(8),
});

const technicalClaimLinksSchema = z.object({
  claimIds: z.array(z.string()).min(1),
});

export const technicalAppendixSchema = z.object({
  title: z.string(),
  overview: z.string(),
  equations: z.array(technicalClaimLinksSchema.extend({
    id: z.string(),
    label: z.string(),
    expression: z.string(),
    explanation: z.string(),
    variables: z.array(z.object({ symbol: z.string(), meaning: z.string() })).max(10),
  })).max(8),
  algorithmSteps: z.array(technicalClaimLinksSchema.extend({
    label: z.string(),
    detail: z.string(),
  })).min(2).max(10),
  codeSketches: z.array(technicalClaimLinksSchema.extend({
    title: z.string(),
    language: z.string(),
    code: z.string(),
    explanation: z.string(),
  })).max(3),
  complexity: z.array(technicalClaimLinksSchema.extend({
    operation: z.string(),
    cost: z.string(),
    context: z.string(),
  })).max(6),
  implementationNotes: z.array(z.string()).min(2).max(10),
});

export const generationResultSchema = z.object({
  evidence: paperEvidenceSchema,
  story: storySpecSchema,
});

export const researchProjectSchema = generationResultSchema.extend({
  version: z.literal(1),
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  language: z.enum(["tr", "en"]),
  audience: z.enum(["general", "student", "expert"]),
  depth: z.enum(["concise", "standard", "deep"]),
  deepReport: deepReportSchema.optional(),
  technicalAppendix: technicalAppendixSchema.optional(),
  generation: z.object({
    provider: z.string(),
    model: z.string(),
    assignments: z.object({
      evidence: z.object({ provider: z.string(), model: z.string() }),
      technical: z.object({ provider: z.string(), model: z.string() }),
      report: z.object({ provider: z.string(), model: z.string() }),
      visual: z.object({ provider: z.string(), model: z.string() }),
    }).optional(),
  }).optional(),
});

export type Source = z.infer<typeof sourceSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type PaperEvidence = z.infer<typeof paperEvidenceSchema>;
export type StoryVisual = z.infer<typeof visualSchema>;
export type StorySection = z.infer<typeof storySectionSchema>;
export type StorySpec = z.infer<typeof storySpecSchema>;
export type DeepReport = z.infer<typeof deepReportSchema>;
export type DeepReportSection = z.infer<typeof deepReportSectionSchema>;
export type TechnicalAppendix = z.infer<typeof technicalAppendixSchema>;
export type ResearchProject = z.infer<typeof researchProjectSchema>;
