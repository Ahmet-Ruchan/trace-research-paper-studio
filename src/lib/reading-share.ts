import { z } from "zod";
import { mergeReadingOrder, savedFrom, savedReason, type ReadingItem } from "./reading-list";
import type { ReadingOrder } from "./reading-order";
import type { ResearchProject } from "./schema";

/**
 * Okuma listesini bir bağlantıyla paylaşmak.
 *
 * Paylaşılan, listenin O ANKİ bir kopyası: çalışmalar okuma sırasındaki
 * yerleri ve nedenleriyle, istenirse kütüphanedeki makaleler de. Okuyucunun
 * notları, ilerlemesi ve ne kadarını okuduğu girmiyor. Kopya Trace sunucusunun
 * kendisinden `/r/<kimlik>` adresinde sunuluyor; makale yayınları gibi
 * (`publications.ts`) bağlantıyı bilen açıyor, listeleme yok, yayından
 * kaldırılabiliyor ve isteğe bağlı bir son kullanma tarihi var.
 */

export const readingShareIdPattern = /^[a-f0-9]{20}$/;
export const MAX_SHARED_WORKS = 500;

export const sharedWorkSchema = z.object({
  kind: z.enum(["saved", "paper"]),
  title: z.string().max(500),
  authors: z.array(z.string().max(200)).max(12).default([]),
  year: z.string().max(10).optional(),
  venue: z.string().max(300).optional(),
  link: z.string().max(2000).optional(),
  /** Neden burada: "Before X: that paper builds on it." */
  why: z.string().max(600).optional(),
});
export type SharedWork = z.infer<typeof sharedWorkSchema>;

export const readingShareSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(readingShareIdPattern),
  title: z.string().trim().min(1).max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["live", "unpublished"]),
  expiresAt: z.iso.datetime().nullable(),
  /** Kütüphanedeki makaleler de sırada mı. */
  includePapers: z.boolean(),
  works: z.array(sharedWorkSchema).max(MAX_SHARED_WORKS),
});
export type ReadingShare = z.infer<typeof readingShareSchema>;
export type ReadingShareState = "live" | "unpublished" | "expired";
export type ReadingShareSummary = Omit<ReadingShare, "works"> & { state: ReadingShareState; path: string; count: number };

export function readingShareState(share: Pick<ReadingShare, "status" | "expiresAt">, now: string): ReadingShareState {
  if (share.status === "unpublished") return "unpublished";
  if (share.expiresAt && Date.parse(share.expiresAt) <= Date.parse(now)) return "expired";
  return "live";
}

export const readingSharePath = (id: string) => `/r/${id}`;

export function summarizeReadingShare(share: ReadingShare, now: string): ReadingShareSummary {
  const { works, ...rest } = share;
  return { ...rest, state: readingShareState(share, now), path: readingSharePath(share.id), count: works.filter((work) => work.kind === "saved").length };
}

/** Çalışmanın açılacağı yer: kendi adresi, yoksa arXiv ya da DOI. */
export function workLink(item: Pick<ReadingItem, "url" | "identifier">) {
  if (item.url) return item.url;
  const identifier = item.identifier?.trim() ?? "";
  const arxiv = /^arxiv:(.+)$/i.exec(identifier);
  if (arxiv) return `https://arxiv.org/abs/${arxiv[1]}`;
  const doi = /^(?:doi:)?(10\.\d{4,9}\/\S+)$/i.exec(identifier);
  if (doi) return `https://doi.org/${doi[1]}`;
  return undefined;
}

const paperWork = (project: ResearchProject, why?: string): SharedWork => ({
  kind: "paper",
  title: project.evidence.paper.title,
  authors: project.evidence.paper.authors.slice(0, 12),
  ...(project.evidence.paper.year ? { year: project.evidence.paper.year } : {}),
  ...(project.evidence.paper.venue ? { venue: project.evidence.paper.venue } : {}),
  ...(project.evidence.paper.doi ? { link: `https://doi.org/${project.evidence.paper.doi.replace(/^https?:\/\/doi\.org\//, "")}` } : {}),
  ...(why ? { why } : {}),
});

const savedWork = (item: ReadingItem, why?: string): SharedWork => {
  const link = workLink(item);
  return {
    kind: "saved",
    title: item.title,
    authors: item.authors.slice(0, 12),
    ...(item.year ? { year: String(item.year) } : {}),
    ...(item.venue ? { venue: item.venue } : {}),
    ...(link ? { link } : {}),
    ...(why ? { why } : {}),
  };
};

/**
 * Listenin paylaşılacak hâli: okuma sırasındaki yerleriyle kaydedilmiş
 * çalışmalar (istenirse aralarında kütüphanedeki makaleler), sonra sırada
 * yeri olmayanlar. Analiz edilmiş bir çalışma, makaleler dahil değilse yine
 * çalışma olarak giriyor.
 */
export function readingShareWorks(order: ReadingOrder, list: readonly ReadingItem[], library: readonly ResearchProject[], includePapers: boolean): SharedWork[] {
  const merged = mergeReadingOrder(order, list, library);
  const works: SharedWork[] = [];
  for (const entry of merged.entries) {
    if (entry.kind === "saved") works.push(savedWork(entry.place.item, entry.place.why ? savedReason(entry.place.why) : undefined));
    else if (includePapers) works.push(paperWork(entry.step.project));
  }
  for (const place of merged.others) {
    if (place.owned && includePapers) works.push(paperWork(place.owned, "On the list, and already analysed."));
    else works.push(savedWork(place.item, place.why ? savedFrom(place.why) : undefined));
  }
  return works.slice(0, MAX_SHARED_WORKS);
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeLink = (link: string) => (/^https?:\/\//i.test(link) ? link : undefined);

/** Okuyucunun gördüğü sayfa: kendi kendine yeten, betiksiz HTML. */
export function readingShareHtml(share: ReadingShare) {
  const items = share.works
    .map((work) => {
      const href = work.link ? safeLink(work.link) : undefined;
      const title = href ? `<a href="${escapeHtml(href)}" rel="noreferrer noopener" target="_blank">${escapeHtml(work.title)}</a>` : escapeHtml(work.title);
      const meta = [work.authors.slice(0, 4).join(", ") + (work.authors.length > 4 ? " et al." : ""), work.venue, work.year].filter(Boolean).join(" · ");
      return `<li class="${work.kind}"><span class="kind">${work.kind === "paper" ? "Read with Trace" : "To read"}</span><h2>${title}</h2>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}${work.why ? `<p class="why">${escapeHtml(work.why)}</p>` : ""}</li>`;
    })
    .join("");
  const updated = share.updatedAt.slice(0, 10);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(share.title)}</title><style>
:root{color-scheme:light dark;--paper:#f2efe7;--surface:#fbfaf6;--ink:#191b18;--soft:#5d625b;--line:#d9d4c7;--accent:#2f6f4f}
@media (prefers-color-scheme:dark){:root{--paper:#121411;--surface:#1a1c18;--ink:#ecebe5;--soft:#a8aca4;--line:#33362f;--accent:#7cc39b}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 Georgia,serif}main{max-width:44rem;margin:0 auto;padding:48px 20px 64px}
header p{margin:0;color:var(--soft);font:13px/1.5 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}h1{margin:8px 0 6px;font-weight:500;font-size:2.2rem;line-height:1.15}
.lede{color:var(--soft);font:15px/1.6 system-ui,sans-serif;margin:0 0 28px}ol{list-style:none;margin:0;padding:0;display:grid;gap:12px;counter-reset:work}
li{counter-increment:work;position:relative;padding:16px 18px 16px 56px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}li::before{content:counter(work);position:absolute;left:18px;top:16px;color:var(--soft);font:600 14px/1.6 system-ui,sans-serif}
li.paper{background:transparent}.kind{color:var(--soft);font:11px/1.4 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase}h2{margin:2px 0 4px;font-size:1.15rem;font-weight:500;line-height:1.35;overflow-wrap:anywhere}
a{color:var(--accent)}.meta{margin:0;color:var(--soft);font:14px/1.5 system-ui,sans-serif}.why{margin:6px 0 0;font:14px/1.55 system-ui,sans-serif}footer{margin-top:32px;color:var(--soft);font:13px/1.6 system-ui,sans-serif}
</style></head><body><main><header><p>Reading list</p><h1>${escapeHtml(share.title)}</h1></header><p class="lede">${share.works.length} ${share.works.length === 1 ? "work" : "works"}, in the order to read them: a work comes before a paper that builds on it or needs a concept it explains, after a paper it cites. Updated ${escapeHtml(updated)}.</p><ol>${items}</ol><footer>Shared from Trace, an evidence-grounded research studio. Only the list is shared: no notes and no reading progress.</footer></main></body></html>`;
}
