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
    /** Opsiyonel LaTeX. Verilirse MathML olarak gösterilir; yoksa `expression` düz metin olarak. */
    latex: z.string().optional(),
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

/* ------------------------------------------------------------------ *
 * Öğrenme katmanı
 *
 * Aşağıdaki blokların hepsi Zod düzeyinde opsiyoneldir; böylece bu
 * katmandan önce üretilmiş projeler içe aktarılmaya devam eder. Hangi
 * bloğun hangi `depth` değerinde ZORUNLU olduğu anlamsal bir kural
 * olduğu için generation-validation.ts içinde denetlenir.
 * ------------------------------------------------------------------ */

/** Makalenin varsaydığı ama açıklamadığı ön bilgi. */
export const primerConceptSchema = z.object({
  id: z.string(),
  term: z.string(),
  level: z.enum(["temel", "orta", "ileri"]),
  intuition: z.string(),
  formal: z.string().optional(),
  whyItMatters: z.string(),
  prerequisiteIds: z.array(z.string()).max(4),
  claimIds: z.array(z.string()).max(6),
});

export const primerSchema = z.object({
  title: z.string(),
  overview: z.string(),
  concepts: z.array(primerConceptSchema).min(3).max(12),
});

/** Adım adım matematiksel türetim. */
export const derivationStepSchema = z.object({
  id: z.string(),
  latex: z.string(),
  plain: z.string(),
  rationale: z.string(),
  shapes: z.string().optional(),
});

export const derivationSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  /** technicalAppendix.equations[].id — verilirse türetim o denklemin altında gösterilir. */
  equationId: z.string().optional(),
  steps: z.array(derivationStepSchema).min(2).max(10),
  numericExample: z
    .object({
      setup: z.string(),
      walkthrough: z.array(z.string()).min(1).max(6),
      result: z.string(),
    })
    .optional(),
  claimIds: z.array(z.string()).min(1),
});

/** Kanıta bağlı anlama kontrolü. */
export const quizOptionSchema = z.object({
  label: z.string(),
  correct: z.boolean(),
  explanation: z.string(),
});

export const quizQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  kind: z.enum(["single", "multi", "true-false"]),
  options: z.array(quizOptionSchema).min(2).max(5),
  claimIds: z.array(z.string()).min(1),
  page: z.number().int().positive().optional(),
});

export const quizSchema = z.object({
  title: z.string(),
  intro: z.string(),
  questions: z.array(quizQuestionSchema).min(3).max(12),
});

/* --- İnteraktifler ---------------------------------------------------
 * Bunlar BİLDİRİMSELDİR. Hiçbir alan çalıştırılabilir JS taşımaz; `formula`
 * alanları formula.ts içindeki kısıtlı dilbilgisiyle ayrıştırılıp saf bir AST
 * üzerinde yürütülür. Bu, güvenilmeyen bir .trace.json'un içe aktarılmasının
 * kod çalıştırmaya dönüşmesini engeller.
 * ------------------------------------------------------------------ */

/** Kullanıcının oynattığı bir değişken. `paperValue` makalenin kendi değeri. */
export const interactiveParameterSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Parametre adı formül tanımlayıcısı olmalı"),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  paperValue: z.number(),
  unit: z.string().optional(),
});

export const interactiveOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  formula: z.string(),
  unit: z.string().optional(),
  precision: z.number().int().min(0).max(6).optional(),
});

export const interactiveSchema = z.discriminatedUnion("kind", [
  /** Makalenin denklemini canlı çalıştıran kaydırma çubukları. */
  z.object({
    kind: z.literal("formula-playground"),
    id: z.string(),
    title: z.string(),
    description: z.string(),
    parameters: z.array(interactiveParameterSchema).min(1).max(4),
    outputs: z.array(interactiveOutputSchema).min(1).max(4),
    chart: z
      .object({
        xParam: z.string(),
        series: z.array(z.object({ outputId: z.string(), label: z.string() })).min(1).max(4),
        samples: z.number().int().min(8).max(200),
        yScale: z.enum(["linear", "log"]),
      })
      .optional(),
    paperAnchor: z.string(),
    claimIds: z.array(z.string()).min(1),
  }),

  /** Mekanizmayı kare kare ilerleten simülasyon. */
  z.object({
    kind: z.literal("mechanism-simulation"),
    id: z.string(),
    title: z.string(),
    description: z.string(),
    stageNodes: z
      .array(z.object({ id: z.string(), label: z.string(), detail: z.string() }))
      .min(2)
      .max(10),
    frames: z
      .array(
        z.object({
          label: z.string(),
          caption: z.string(),
          activeNodeIds: z.array(z.string()).min(1).max(10),
          grid: z
            .object({
              rowLabels: z.array(z.string()).min(1).max(8),
              columnLabels: z.array(z.string()).min(1).max(8),
              values: z.array(z.array(z.number())).min(1).max(8),
            })
            .optional(),
        }),
      )
      .min(2)
      .max(12),
    claimIds: z.array(z.string()).min(1),
  }),

  /** Makaledeki tablonun sıralanabilir/filtrelenebilir hali. */
  z.object({
    kind: z.literal("dataset-explorer"),
    id: z.string(),
    title: z.string(),
    description: z.string(),
    columns: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          type: z.enum(["text", "number"]),
          unit: z.string().optional(),
        }),
      )
      .min(2)
      .max(8),
    rows: z
      .array(
        z.object({
          cells: z.array(z.union([z.string(), z.number()])).min(2).max(8),
          highlight: z.boolean().optional(),
        }),
      )
      .min(2)
      .max(40),
    defaultSort: z.object({ columnId: z.string(), direction: z.enum(["asc", "desc"]) }).optional(),
    sourceRef: sourceReferenceSchema,
    claimIds: z.array(z.string()).min(1),
  }),
]);

/** "Bunu kendi projemde nasıl kullanırım." */
export const applicationGuideSchema = z.object({
  title: z.string(),
  overview: z.string(),
  recipe: z
    .array(
      z.object({
        step: z.string(),
        detail: z.string(),
        code: z.object({ language: z.string(), source: z.string() }).optional(),
        claimIds: z.array(z.string()).min(1),
      }),
    )
    .min(2)
    .max(8),
  hyperparameters: z
    .array(
      z.object({
        name: z.string(),
        paperValue: z.string(),
        range: z.string(),
        guidance: z.string(),
        claimIds: z.array(z.string()).min(1),
      }),
    )
    .max(8),
  pitfalls: z
    .array(
      z.object({
        symptom: z.string(),
        cause: z.string(),
        fix: z.string(),
        claimIds: z.array(z.string()).min(1),
      }),
    )
    .max(6),
  whenNotToUse: z.array(z.string()).min(1).max(5),
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
  primer: primerSchema.optional(),
  derivations: z.array(derivationSchema).max(6).optional(),
  quiz: quizSchema.optional(),
  interactives: z.array(interactiveSchema).max(8).optional(),
  applicationGuide: applicationGuideSchema.optional(),
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
export type Primer = z.infer<typeof primerSchema>;
export type PrimerConcept = z.infer<typeof primerConceptSchema>;
export type Derivation = z.infer<typeof derivationSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;
export type Interactive = z.infer<typeof interactiveSchema>;
export type InteractiveParameter = z.infer<typeof interactiveParameterSchema>;
export type ApplicationGuide = z.infer<typeof applicationGuideSchema>;
export type ResearchProject = z.infer<typeof researchProjectSchema>;

/** `depth` başına hangi öğrenme bloklarının zorunlu olduğu. */
export const LEARNING_REQUIREMENTS = {
  concise: ["primer"],
  standard: ["primer", "derivations", "quiz"],
  deep: ["primer", "derivations", "quiz", "interactives", "applicationGuide"],
} as const satisfies Record<ResearchProject["depth"], readonly string[]>;
