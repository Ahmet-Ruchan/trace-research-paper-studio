import { IntegrityError } from "./generation-validation";
import {
  narrativeTemplateSchema,
  reportKinds,
  type Claim,
  type DeepReport,
  type NarrativeTemplate,
  type PaperEvidence,
  type ResearchProject,
  type StorySpec,
  type VisualType,
} from "./schema";

export {
  claimKinds,
  narrativeTemplateSchema,
  reportKinds,
  templateSlotSchema,
  visualTypes,
  type NarrativeTemplate,
  type TemplateSlot,
  type VisualType,
} from "./schema";

/**
 * Yeniden kullanılabilir anlatı şablonları.
 *
 * Bir şablon bir anlatının İSKELETİ: kaç bölüm, hangi sırayla, her biri ne
 * iş görüyor, hangi görsel dilbilgisiyle ve ağırlıklı olarak hangi tür
 * iddialara dayanarak. İçerik taşımaz — başka bir makaleye uygulandığında
 * her cümle yine o makalenin kanıtından yazılır.
 *
 * Neden var: bir laboratuvar her hafta aynı biçimde okuma notu yazıyorsa,
 * beğendiği yapıyı her seferinde istemle tarif etmek yerine bir kez kaydedip
 * yeniden kullanabilmeli. Şablon projeye de kopyalanıyor; böylece sonradan
 * bir bölüm yeniden üretildiğinde ya da proje plugin'de doğrulandığında yapı
 * aynı kurallarla korunuyor.
 */

const ADVANCED_VISUALS: readonly VisualType[] = ["architecture", "equation", "timeline", "matrix", "infographic"];
/** Makalenin sayılarına dayanan görseller. Kanıtta metrik yoksa bu yuvalar başka bir görsel kullanabilir. */
const NUMERIC_VISUALS: readonly VisualType[] = ["comparison", "metric"];

/* ------------------------------------------------------------------ *
 * Şablonun kendisi tutarlı mı
 * ------------------------------------------------------------------ */

/**
 * Bir şablon, bütünlük denetiminin anlatıya uyguladığı kuralları karşılamak
 * zorunda. Karşılamıyorsa ona göre üretilen her anlatı reddedilir ve kullanıcı
 * sebebini ancak model ücretini ödedikten sonra öğrenir. Bu yüzden şablon
 * kaydedilirken ve kullanılmadan önce denetleniyor.
 */
export function templateIssues(template: NarrativeTemplate): string[] {
  const issues: string[] = [];
  const visuals = new Set(template.story.map((slot) => slot.visual));
  if (visuals.size < 3) issues.push("A template needs at least three different visual types");
  if (![...visuals].some((visual) => ADVANCED_VISUALS.includes(visual))) {
    issues.push(`A template needs at least one of: ${ADVANCED_VISUALS.join(", ")}`);
  }
  const kinds = new Set(template.story.flatMap((slot) => slot.claimKinds));
  if (!kinds.has("method")) issues.push("One section must draw on method claims");
  if (!kinds.has("limitation")) issues.push("One section must draw on limitation claims");
  if (template.report) {
    const present = new Set(template.report);
    const missing = reportKinds.filter((kind) => !present.has(kind));
    if (missing.length) issues.push(`The report order must include every section kind; missing ${missing.join(", ")}`);
  }
  return issues;
}

export function assertUsableTemplate(template: NarrativeTemplate) {
  const issues = templateIssues(template);
  if (issues.length) throw new IntegrityError("Template", issues);
}

/* ------------------------------------------------------------------ *
 * Projeden şablon
 * ------------------------------------------------------------------ */

const purposeByKind: Record<Claim["kind"], string> = {
  background: "Set up the problem and why it matters",
  method: "Explain how the method works",
  "reported-result": "Present what the authors measured",
  "author-interpretation": "Interpret what the results mean",
  limitation: "State the limits and open boundaries",
};

export function slugifyTemplateName(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "template";
}

/**
 * Bir projenin anlatısından şablon çıkarır. Amaç metinleri İÇERİKTEN değil
 * iddia türlerinden türetiliyor: "Transformer'ın dikkat mekanizması" gibi bir
 * başlık başka bir makalede anlamsız olurdu. Kullanıcı kaydetmeden önce
 * amaçları düzenleyebiliyor.
 */
export function templateFromProject(
  project: ResearchProject,
  options: { name: string; description?: string; now?: string; id?: string },
): NarrativeTemplate {
  const kinds = new Map(project.evidence.claims.map((claim) => [claim.id, claim.kind]));
  const story = project.story.sections.map((section) => {
    // Map ekleme sırasını koruyor: beraberlikte bölümün İLK andığı tür öne
    // geçer. Yazar bölümü genellikle ana dayanağıyla açıyor; sabit bir tür
    // sırası ise yöntem bölümünü "yorum" diye etiketleyebiliyordu.
    const counts = new Map<Claim["kind"], number>();
    for (const id of section.claimIds) {
      const kind = kinds.get(id);
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const firstSeen = [...counts.keys()];
    const ranked = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || firstSeen.indexOf(left[0]) - firstSeen.indexOf(right[0]))
      .map(([kind]) => kind)
      .slice(0, 3);
    return {
      purpose: ranked[0] ? purposeByKind[ranked[0]] : "Carry the narrative forward",
      visual: section.visual.type,
      claimKinds: ranked,
    };
  });
  const now = options.now ?? new Date().toISOString();
  return narrativeTemplateSchema.parse({
    version: 1,
    id: options.id ?? `${slugifyTemplateName(options.name)}-${now.replace(/\D/g, "").slice(0, 14)}`,
    name: options.name,
    description: options.description ?? "",
    createdAt: now,
    source: { projectId: project.id, title: project.evidence.paper.title.slice(0, 300) },
    story,
    report: project.deepReport?.sections.map((section) => section.kind),
  });
}

/* ------------------------------------------------------------------ *
 * Hazır şablonlar
 * ------------------------------------------------------------------ */

const BUILT_IN_DATE = "2026-09-16T00:00:00.000Z";

export const builtInTemplates: readonly NarrativeTemplate[] = [
  {
    version: 1,
    id: "method-walkthrough",
    name: "Method walkthrough",
    description: "For readers who want to rebuild the idea: the problem, then the mechanism step by step, then what it achieved and where it stops.",
    createdAt: BUILT_IN_DATE,
    builtIn: true,
    story: [
      { purpose: "Set up the problem the paper attacks", visual: "concept", claimKinds: ["background"] },
      { purpose: "Show the overall architecture or pipeline", visual: "architecture", claimKinds: ["method"] },
      { purpose: "Unpack the core mechanism or equation", visual: "equation", claimKinds: ["method"] },
      { purpose: "Walk through training or the procedure in order", visual: "timeline", claimKinds: ["method"] },
      { purpose: "Present the headline measured results", visual: "comparison", claimKinds: ["reported-result"] },
      { purpose: "State the limits and open boundaries", visual: "layers", claimKinds: ["limitation", "author-interpretation"] },
    ],
    report: ["contribution", "mechanism", "mechanism", "experiment", "reproduction", "critique", "implication"],
  },
  {
    version: 1,
    id: "results-briefing",
    name: "Results briefing",
    description: "For a busy reader: what was found first, how much it matters, then just enough method to trust it, and the caveats.",
    createdAt: BUILT_IN_DATE,
    builtIn: true,
    story: [
      { purpose: "Lead with the most important measured result", visual: "metric", claimKinds: ["reported-result"] },
      { purpose: "Compare against the baselines", visual: "comparison", claimKinds: ["reported-result"] },
      { purpose: "Explain just enough of the method to trust the result", visual: "flow", claimKinds: ["method"] },
      { purpose: "Interpret what the results mean in practice", visual: "infographic", claimKinds: ["author-interpretation", "reported-result"] },
      { purpose: "Weigh the caveats and limitations", visual: "matrix", claimKinds: ["limitation"] },
    ],
    report: ["contribution", "experiment", "mechanism", "critique", "reproduction", "implication"],
  },
];

export function findBuiltInTemplate(id: string) {
  return builtInTemplates.find((template) => template.id === id);
}

/* ------------------------------------------------------------------ *
 * İstem
 * ------------------------------------------------------------------ */

function article(word: string) {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function kindList(kinds: readonly string[]) {
  return kinds.length ? kinds.join(" or ") : "any kind";
}

export function templateStoryInstructions(template: NarrativeTemplate) {
  const slots = template.story
    .map((slot, index) => `${String(index + 1).padStart(2, "0")} — ${slot.purpose}. Visual: ${slot.visual}. Draw mainly on claims of kind ${kindList(slot.claimKinds)}.`)
    .join("\n");
  return `Follow the narrative template "${template.name}". Produce exactly ${template.story.length} sections, in this order:
${slots}
Each section's visual type must be the one listed. If the evidence has no metrics, a section listed as comparison or metric may use another visual instead of inventing numbers. The purposes describe structure only; every fact still comes from the evidence.`;
}

export function templateReportInstructions(template: NarrativeTemplate) {
  if (!template.report) return "";
  return `Follow the narrative template "${template.name}": produce exactly ${template.report.length} sections whose kinds are, in this order: ${template.report.join(", ")}.`;
}

/** Tek bir anlatı bölümünün şablondaki yeri; bölüm yeniden üretimi bunu isteme koyuyor. */
export function templateSlotInstruction(template: NarrativeTemplate, index: number) {
  const slot = template.story[index];
  if (!slot) return undefined;
  return `This project follows the narrative template "${template.name}". This section's purpose: ${slot.purpose}. Its visual type must be ${slot.visual}, and it should draw mainly on claims of kind ${kindList(slot.claimKinds)}.`;
}

/* ------------------------------------------------------------------ *
 * Uyum denetimi
 * ------------------------------------------------------------------ */

export function storyTemplateIssues(story: StorySpec, evidence: PaperEvidence, template: NarrativeTemplate): string[] {
  const issues: string[] = [];
  if (story.sections.length !== template.story.length) {
    issues.push(`The template "${template.name}" has ${template.story.length} sections; the story has ${story.sections.length}`);
  }
  const kinds = new Map(evidence.claims.map((claim) => [claim.id, claim.kind]));
  const availableKinds = new Set(evidence.claims.map((claim) => claim.kind));
  const hasMetrics = evidence.metrics.length > 0;

  story.sections.forEach((section, index) => {
    const slot = template.story[index];
    if (!slot) return;
    const numericFallback = !hasMetrics && NUMERIC_VISUALS.includes(slot.visual);
    if (section.visual.type !== slot.visual && !numericFallback) {
      issues.push(`${section.id}: the template asks for ${article(slot.visual)} visual here, not ${section.visual.type}`);
    }
    // Makalede o türden hiç iddia yoksa şart koşmak, karşılanamayacak bir kural olurdu.
    const expected = slot.claimKinds.filter((kind) => availableKinds.has(kind));
    if (expected.length && !section.claimIds.some((id) => expected.includes(kinds.get(id) as Claim["kind"]))) {
      issues.push(`${section.id}: the template asks this section to cite ${article(expected.join(" or "))} claim`);
    }
  });
  return issues;
}

export function reportTemplateIssues(report: DeepReport, template: NarrativeTemplate): string[] {
  if (!template.report) return [];
  const actual = report.sections.map((section) => section.kind);
  if (actual.length !== template.report.length) {
    return [`The template "${template.name}" has ${template.report.length} report sections; the report has ${actual.length}`];
  }
  return actual.flatMap((kind, index) =>
    kind === template.report![index]
      ? []
      : [`${report.sections[index].id}: the template asks for ${article(template.report![index])} section here, not ${kind}`],
  );
}

export function validateStoryTemplate(story: StorySpec, evidence: PaperEvidence, template: NarrativeTemplate) {
  const issues = storyTemplateIssues(story, evidence, template);
  if (issues.length) throw new IntegrityError("Template", issues);
}

export function validateReportTemplate(report: DeepReport, template: NarrativeTemplate) {
  const issues = reportTemplateIssues(report, template);
  if (issues.length) throw new IntegrityError("Template", issues);
}
