/**
 * Stüdyonun "makaleyi adıyla bul" ve atıf grafiği özelliklerinin istemci
 * tarafı. Asıl iş sunucuda, plugin köprüsüyle AYNI çözümleyicide yapılıyor
 * (`paper-source.mjs`); burada yalnızca taşınan biçimler ve çağrılar var.
 */

export type PaperCandidate = {
  origin: string;
  title: string;
  authors: string[];
  year?: string;
  venue?: string;
  url?: string;
  matchScore?: number;
  /** Trace'in indirebildiği adresler, denenecek sırayla. Boşsa PDF elle yüklenmeli. */
  pdfUrls: string[];
  /** Açık kopya var ama Trace'in indirmediği bir sitede. */
  blockedPdfUrls: string[];
};

export type GraphNode = {
  openAlexId: string;
  title: string;
  year?: number;
  citationCount: number;
  authors: string[];
  authorCount: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  pdfAvailable: boolean;
  identifier: string;
};

export type CitationGraph =
  | {
      ok: true;
      retrievedAt: string;
      source: string;
      paper: GraphNode;
      referenceCount: number;
      citedByCount: number;
      references: GraphNode[];
      citedBy: GraphNode[];
      note: string;
      openAlexUrl: string;
    }
  | { ok: false; skipped?: string; error?: string };

export const originLabels: Record<string, string> = {
  arxiv: "arXiv",
  biorxiv: "bioRxiv",
  medrxiv: "medRxiv",
  pmc: "PubMed Central",
  acl: "ACL Anthology",
  openreview: "OpenReview",
  openalex: "OpenAlex",
};

async function readError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return data?.error ?? fallback;
}

/** Bir başlık, DOI, arXiv kimliği ya da depo bağlantısı için adayları getirir. */
export async function findPapers(query: string, expectTitle?: string): Promise<PaperCandidate[]> {
  const params = new URLSearchParams({ q: query });
  if (expectTitle) params.set("expect", expectTitle);
  const response = await fetch(`/api/resolve?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response, "The paper could not be looked up."));
  return ((await response.json()) as { candidates: PaperCandidate[] }).candidates;
}

/** Adayın PDF'ini sunucu üzerinden indirir; tarayıcı depolara doğrudan gidemez (CORS). */
export async function downloadCandidate(candidate: PaperCandidate): Promise<File> {
  const response = await fetch("/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: candidate.title, pdfUrls: candidate.pdfUrls, blockedPdfUrls: candidate.blockedPdfUrls }),
  });
  if (!response.ok) throw new Error(await readError(response, "The PDF could not be downloaded."));
  const name = candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "paper";
  return new File([await response.blob()], `${name}.pdf`, { type: "application/pdf" });
}

export async function loadCitationGraph(paper: { doi?: string; title: string; authors: string[] }): Promise<CitationGraph> {
  const response = await fetch("/api/citations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paper),
  });
  if (!response.ok) throw new Error(await readError(response, "The citation graph could not be loaded."));
  return (await response.json()) as CitationGraph;
}
