import { evidenceHealth } from "../evidence-health";
import type { Claim, ResearchProject, SourceReference } from "../schema";

/**
 * Projenin okunabilir rapor hâli — biçimden bağımsız bloklar.
 *
 * Markdown ve yazdırılabilir HTML aynı bloklardan çiziliyor. İkisi ayrı ayrı
 * yazılsaydı zamanla ayrışırlardı: birine eklenen "reddedilen iddialar"
 * bölümü ötekinde unutulurdu. Trace'in kuralı dışa aktarımda da geçerli:
 * her iddia sayfasıyla ve alıntısıyla birlikte gider, güven işaretleri
 * (modelin beyanı, alıntı denetimi, insan kararı) ayrı ayrı yazılır.
 */
export type ReportBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "note"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "quote"; text: string; cite: string }
  | { type: "math"; latex: string }
  | { type: "code"; language: string; code: string }
  | { type: "table"; head: string[]; rows: string[][] };

const kindLabels: Record<Claim["kind"], string> = {
  "reported-result": "Reported result",
  "author-interpretation": "Author interpretation",
  method: "Method",
  background: "Background",
  limitation: "Limitation",
};

export function citeLabel(project: ResearchProject, reference: SourceReference) {
  const source = project.evidence.sources.find((item) => item.id === reference.sourceId);
  if (reference.page) return `p. ${reference.page}`;
  return source?.title ?? reference.sourceId;
}

/** Bir bölümün dayandığı iddiaların kısa dökümü: "[c1] p. 4 · [c2] p. 7". */
function supportLine(project: ResearchProject, claimIds: readonly string[]) {
  const claims = claimIds.map((id) => project.evidence.claims.find((claim) => claim.id === id)).filter((claim): claim is Claim => Boolean(claim));
  if (!claims.length) return undefined;
  return `Rests on: ${claims.map((claim) => `[${claim.id}] ${citeLabel(project, claim.sourceRefs[0])}`).join(" · ")}`;
}

export function reportDocument(project: ResearchProject): ReportBlock[] {
  const { evidence } = project;
  const health = evidenceHealth(project);
  const reviews = project.claimReviews ?? {};
  const blocks: ReportBlock[] = [];
  const push = (...items: Array<ReportBlock | undefined>) => items.forEach((item) => item && blocks.push(item));

  push(
    { type: "heading", level: 1, text: evidence.paper.title },
    { type: "paragraph", text: [evidence.paper.authors.join(", "), evidence.paper.venue, evidence.paper.year, evidence.paper.doi ? `doi:${evidence.paper.doi}` : ""].filter(Boolean).join(" · ") },
    {
      type: "note",
      text:
        `An evidence-grounded reading made with Trace. ${health.claims.verified} of ${health.claims.total} claims are marked verified by the model. ` +
        (health.excerpts.checked
          ? `${health.excerpts.located} of ${health.excerpts.total} quotes were found in the text of the page they cite.`
          : "The quotes were not checked against the PDF.") +
        (health.reviews.approved + health.reviews.rejected
          ? ` A person approved ${health.reviews.approved} claims and rejected ${health.reviews.rejected}.`
          : "") +
        " This is not a substitute for the paper.",
    },
    { type: "heading", level: 2, text: "Thesis" },
    { type: "paragraph", text: evidence.thesis },
    { type: "paragraph", text: evidence.plainSummary },
    { type: "heading", level: 2, text: "Research question" },
    { type: "paragraph", text: evidence.researchQuestion },
  );

  if (project.deepReport) {
    push({ type: "heading", level: 2, text: project.deepReport.title });
    for (const section of project.deepReport.sections) {
      push({ type: "heading", level: 3, text: section.title }, { type: "paragraph", text: section.summary });
      section.analysis.forEach((paragraph) => push({ type: "paragraph", text: paragraph }));
      const support = supportLine(project, section.claimIds);
      if (support) push({ type: "note", text: support });
    }
  } else {
    push({ type: "heading", level: 2, text: project.story.title }, { type: "paragraph", text: project.story.dek });
    for (const section of project.story.sections) {
      push({ type: "heading", level: 3, text: section.title }, { type: "paragraph", text: section.body });
      const support = supportLine(project, section.claimIds);
      if (support) push({ type: "note", text: support });
    }
  }

  push({ type: "heading", level: 2, text: "Method" }, { type: "list", ordered: true, items: evidence.methods });

  const appendix = project.technicalAppendix;
  if (appendix?.equations.length) {
    push({ type: "heading", level: 2, text: "Equations" });
    for (const equation of appendix.equations) {
      push({ type: "heading", level: 3, text: equation.label });
      push(equation.latex ? { type: "math", latex: equation.latex } : { type: "code", language: "text", code: equation.expression });
      push({ type: "paragraph", text: equation.explanation });
      if (equation.variables.length) push({ type: "list", items: equation.variables.map((variable) => `${variable.symbol}: ${variable.meaning}`) });
    }
  }

  if (evidence.metrics.length) {
    push(
      { type: "heading", level: 2, text: "Reported numbers" },
      {
        type: "table",
        head: ["Measurement", "Value", "Context", "Source"],
        rows: evidence.metrics.map((metric) => [metric.label, metric.displayValue, metric.context, citeLabel(project, metric.sourceRef)]),
      },
    );
  }

  push({ type: "heading", level: 2, text: "Findings" }, { type: "list", items: evidence.findings });
  push({ type: "heading", level: 2, text: "Limitations" }, { type: "list", items: evidence.limitations });

  push({ type: "heading", level: 2, text: "Evidence ledger" });
  const unlocated = new Set(health.excerpts.unlocatedClaims.map((item) => item.claim.id));
  for (const claim of evidence.claims) {
    const review = reviews[claim.id];
    const marks = [
      kindLabels[claim.kind],
      claim.confidence === "verified" ? "verified by the model" : "needs review",
      unlocated.has(claim.id) ? "quote not found on its page" : undefined,
      review ? `${review.status} by ${review.by}` : undefined,
    ].filter(Boolean);
    push({ type: "heading", level: 3, text: `[${claim.id}] ${claim.statement}` }, { type: "note", text: marks.join(" · ") });
    claim.sourceRefs.forEach((reference) => push({ type: "quote", text: reference.excerpt, cite: citeLabel(project, reference) }));
    if (review?.note) push({ type: "note", text: `Reviewer's note: ${review.note}` });
  }

  if (evidence.glossary.length) {
    push({ type: "heading", level: 2, text: "Glossary" }, { type: "list", items: evidence.glossary.map((item) => `${item.term}: ${item.definition}`) });
  }

  push(
    { type: "heading", level: 2, text: "Sources" },
    { type: "list", items: evidence.sources.map((source) => `[${source.id}] ${source.title}${source.url ? ` — ${source.url}` : ""}`) },
  );
  return blocks;
}
