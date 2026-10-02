import { stringsFor, type Strings } from "../../visuals/i18n";
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
 *
 * Başlıklar ve notlar makalenin dilini izliyor (`stringsFor`): Türkçe bir
 * makalenin raporu Türkçe, ötekiler İngilizce. Dosyayı açan kişi stüdyonun
 * dil seçimini bilmiyor.
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

export function citeLabel(project: ResearchProject, reference: SourceReference, t: Strings = stringsFor(project.language)) {
  const source = project.evidence.sources.find((item) => item.id === reference.sourceId);
  if (reference.page) return t.page(reference.page);
  return source?.title ?? reference.sourceId;
}

/** Bir bölümün dayandığı iddiaların kısa dökümü: "[c1] p. 4 · [c2] p. 7". */
function supportLine(project: ResearchProject, claimIds: readonly string[], t: Strings) {
  const claims = claimIds.map((id) => project.evidence.claims.find((claim) => claim.id === id)).filter((claim): claim is Claim => Boolean(claim));
  if (!claims.length) return undefined;
  return t.reportRestsOn(claims.map((claim) => `[${claim.id}] ${citeLabel(project, claim.sourceRefs[0], t)}`).join(" · "));
}

export function reportDocument(project: ResearchProject): ReportBlock[] {
  const t = stringsFor(project.language);
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
      text: t.reportIntro({
        verified: health.claims.verified,
        total: health.claims.total,
        ...(health.excerpts.checked ? { quotes: { located: health.excerpts.located, total: health.excerpts.total } } : {}),
        ...(health.reviews.approved + health.reviews.rejected ? { reviews: { approved: health.reviews.approved, rejected: health.reviews.rejected } } : {}),
      }),
    },
    { type: "heading", level: 2, text: t.thesis },
    { type: "paragraph", text: evidence.thesis },
    { type: "paragraph", text: evidence.plainSummary },
    { type: "heading", level: 2, text: t.researchQuestion },
    { type: "paragraph", text: evidence.researchQuestion },
  );

  if (project.deepReport) {
    push({ type: "heading", level: 2, text: project.deepReport.title });
    for (const section of project.deepReport.sections) {
      push({ type: "heading", level: 3, text: section.title }, { type: "paragraph", text: section.summary });
      section.analysis.forEach((paragraph) => push({ type: "paragraph", text: paragraph }));
      const support = supportLine(project, section.claimIds, t);
      if (support) push({ type: "note", text: support });
    }
  } else {
    push({ type: "heading", level: 2, text: project.story.title }, { type: "paragraph", text: project.story.dek });
    for (const section of project.story.sections) {
      push({ type: "heading", level: 3, text: section.title }, { type: "paragraph", text: section.body });
      const support = supportLine(project, section.claimIds, t);
      if (support) push({ type: "note", text: support });
    }
  }

  push({ type: "heading", level: 2, text: t.reportMethod }, { type: "list", ordered: true, items: evidence.methods });

  const appendix = project.technicalAppendix;
  if (appendix?.equations.length) {
    push({ type: "heading", level: 2, text: t.equations });
    for (const equation of appendix.equations) {
      push({ type: "heading", level: 3, text: equation.label });
      push(equation.latex ? { type: "math", latex: equation.latex } : { type: "code", language: "text", code: equation.expression });
      push({ type: "paragraph", text: equation.explanation });
      if (equation.variables.length) push({ type: "list", items: equation.variables.map((variable) => `${variable.symbol}: ${variable.meaning}`) });
    }
  }

  if (evidence.metrics.length) {
    push(
      { type: "heading", level: 2, text: t.reportNumbers },
      {
        type: "table",
        head: [...t.reportTableHead],
        rows: evidence.metrics.map((metric) => [metric.label, metric.displayValue, metric.context, citeLabel(project, metric.sourceRef, t)]),
      },
    );
  }

  push({ type: "heading", level: 2, text: t.findings }, { type: "list", items: evidence.findings });
  push({ type: "heading", level: 2, text: t.limitations }, { type: "list", items: evidence.limitations });

  // Yanlış okumalar sınırlılıkların hemen ardından: ikisi de "makale neyi göstermiyor" sorusu.
  if (project.misreadings) {
    push({ type: "heading", level: 2, text: project.misreadings.title }, { type: "paragraph", text: project.misreadings.intro });
    for (const item of project.misreadings.items) {
      push(
        { type: "heading", level: 3, text: t.reportMisreading(item.misreading) },
        { type: "paragraph", text: item.correction },
        { type: "note", text: `${t.misreadingTraps[item.trap]} · ${item.claimIds.map((id) => `[${id}]`).join(" ")}` },
      );
    }
  }

  push({ type: "heading", level: 2, text: t.reportLedger });
  const unlocated = new Set(health.excerpts.unlocatedClaims.map((item) => item.claim.id));
  for (const claim of evidence.claims) {
    const review = reviews[claim.id];
    const marks = [
      t.claimKinds[claim.kind],
      claim.confidence === "verified" ? t.reportVerifiedByModel : t.reportNeedsReview,
      unlocated.has(claim.id) ? t.reportQuoteNotFound : undefined,
      review ? t.reportReview(review.status, review.by) : undefined,
    ].filter(Boolean);
    push({ type: "heading", level: 3, text: `[${claim.id}] ${claim.statement}` }, { type: "note", text: marks.join(" · ") });
    claim.sourceRefs.forEach((reference) => push({ type: "quote", text: reference.excerpt, cite: citeLabel(project, reference, t) }));
    if (review?.note) push({ type: "note", text: t.reportReviewerNote(review.note) });
  }

  if (evidence.glossary.length) {
    push({ type: "heading", level: 2, text: t.glossary }, { type: "list", items: evidence.glossary.map((item) => `${item.term}: ${item.definition}`) });
  }

  push(
    { type: "heading", level: 2, text: t.reportSources },
    { type: "list", items: evidence.sources.map((source) => `[${source.id}] ${source.title}${source.url ? ` — ${source.url}` : ""}`) },
  );
  return blocks;
}
