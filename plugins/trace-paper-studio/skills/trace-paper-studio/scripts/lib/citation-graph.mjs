/**
 * Atıf grafiği: makalenin dayandığı çalışmalar ve onu izleyenler.
 *
 * Kaynak OpenAlex — anahtarsız ve iki yönü de veriyor. Bu veri KANIT DEĞİL:
 * makalenin sayfalarından değil dış bir dizinden geliyor ve atıf sayıları
 * eskiyor. Bu yüzden `.trace.json` içine yazılmıyor; bağlam dosyasında ve
 * stüdyoda, alındığı tarihle birlikte gösteriliyor.
 *
 * Her düğüm yeniden çözülebilir bir kimlik taşır (arXiv kimliği, yoksa DOI,
 * yoksa başlık); böylece grafikteki bir makale tek adımda analiz edilebilir.
 */

import { doiHasRepository, openAlexArxivId, openAlexPdfUrls, isAllowedUrl, request } from "./paper-source.mjs";

const NODE_FIELDS =
  "id,doi,title,publication_year,cited_by_count,authorships,primary_location,best_oa_location,locations,open_access";
const MAX_REFERENCE_IDS = 200;
const OPENALEX_OR_LIMIT = 100;

const shortId = (openAlexId) => String(openAlexId ?? "").split("/").pop();

const normalizeTitle = (value) =>
  String(value ?? "").toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();

const surname = (name) => normalizeTitle(name).split(" ").pop();

export function toGraphNode(work) {
  const doi = work.doi ? String(work.doi).replace(/^https?:\/\/doi\.org\//i, "") : undefined;
  const publisherDoi = doi && !/^10\.48550\//i.test(doi) ? doi : undefined;
  const arxivId = openAlexArxivId(work);
  const authors = (work.authorships ?? []).map((authorship) => authorship.author?.display_name).filter(Boolean);
  return {
    openAlexId: shortId(work.id),
    title: work.title ?? "Untitled work",
    year: work.publication_year ?? undefined,
    citationCount: work.cited_by_count ?? 0,
    authors: authors.slice(0, 3),
    authorCount: authors.length,
    venue: work.primary_location?.source?.display_name ?? undefined,
    doi: publisherDoi,
    arxivId,
    url: work.primary_location?.landing_page_url ?? work.doi ?? work.id,
    // Trace'in indirebildiği bir kopya var mı — "analiz et" düğmesinin sözü bu.
    pdfAvailable: Boolean(arxivId) || doiHasRepository(publisherDoi) || openAlexPdfUrls(work).some(isAllowedUrl),
    // Yeniden çözmek için en güvenilir kimlik.
    identifier: arxivId ? `arxiv:${arxivId}` : publisherDoi ?? work.title,
  };
}

/**
 * Başlıktan OpenAlex kaydını bulur — YALNIZCA birebir başlık eşleşmesiyle.
 *
 * Yakın eşleşme kabul edilmiyor: otoriter görünümlü yanlış bir atıf grafiği,
 * grafiğin hiç olmamasından kötüdür. Yazar biliniyorsa ilk yazarın soyadı da
 * tutmalı. Aynı makalenin ön baskı ve yayımlanmış kayıtları ayrı durabiliyor;
 * atıfların toplandığı kayıt, yani en çok atıf alan seçilir.
 */
export async function findOpenAlexWork({ title, authors = [] }) {
  const clean = String(title ?? "").replace(/[,|:"]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  const url =
    "https://api.openalex.org/works?" +
    new URLSearchParams({ filter: `title.search:${clean}`, "per-page": "10", select: NODE_FIELDS });
  const data = await (await request(url)).json();
  const target = normalizeTitle(title);
  const firstAuthor = authors[0] ? surname(authors[0]) : undefined;
  const matches = (data?.results ?? []).filter((work) => {
    if (normalizeTitle(work.title) !== target) return false;
    if (!firstAuthor) return true;
    const names = (work.authorships ?? []).map((authorship) => surname(authorship.author?.display_name));
    return !names.length || names.includes(firstAuthor);
  });
  return matches.sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0))[0];
}

async function fetchWorksByIds(ids, limit) {
  const works = [];
  for (let start = 0; start < ids.length; start += OPENALEX_OR_LIMIT) {
    const batch = ids.slice(start, start + OPENALEX_OR_LIMIT).map(shortId);
    const url =
      "https://api.openalex.org/works?" +
      new URLSearchParams({
        filter: `openalex:${batch.join("|")}`,
        sort: "cited_by_count:desc",
        "per-page": String(Math.min(limit, 50)),
        select: NODE_FIELDS,
      });
    const data = await (await request(url)).json();
    works.push(...(data?.results ?? []));
  }
  return works.sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0)).slice(0, limit);
}

/**
 * İki yönlü grafik. Her yön en çok atıf alan `limit` çalışmayla sınırlı:
 * bir makalenin binlerce atıfı olabilir ve ekrana sığan, okunabilen bir
 * harita amaçlanıyor — tam liste için OpenAlex bağlantısı veriliyor.
 *
 * Başarısızlık sessiz: grafik bir bonustur ve bir ağ hatası akışı düşürmemeli.
 */
export async function fetchCitationGraph({ openAlexId, doi, title, authors } = {}, { limit = 12 } = {}) {
  try {
    let work;
    const select = `${NODE_FIELDS},referenced_works`;
    if (openAlexId) {
      work = await (await request(`https://api.openalex.org/works/${shortId(openAlexId)}?select=${select}`)).json();
    } else if (doi && !/^10\.48550\//i.test(doi)) {
      work = await (await request(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=${select}`)).json();
    } else {
      const found = await findOpenAlexWork({ title, authors });
      if (found) {
        work = await (await request(`https://api.openalex.org/works/${shortId(found.id)}?select=${select}`)).json();
      }
    }
    if (!work?.id) {
      return { ok: false, skipped: "the paper could not be matched to an OpenAlex record with certainty" };
    }

    const referenceIds = (work.referenced_works ?? []).slice(0, MAX_REFERENCE_IDS);
    const references = referenceIds.length ? await fetchWorksByIds(referenceIds, limit) : [];
    const citingUrl =
      "https://api.openalex.org/works?" +
      new URLSearchParams({
        filter: `cites:${shortId(work.id)}`,
        sort: "cited_by_count:desc",
        "per-page": String(limit),
        select: NODE_FIELDS,
      });
    const citing = (await (await request(citingUrl)).json())?.results ?? [];

    return {
      ok: true,
      retrievedAt: new Date().toISOString(),
      source: "OpenAlex",
      paper: toGraphNode(work),
      referenceCount: (work.referenced_works ?? []).length,
      citedByCount: work.cited_by_count ?? 0,
      references: references.map(toGraphNode),
      citedBy: citing.map(toGraphNode),
      note: `Each direction lists the ${limit} most-cited works. Counts come from OpenAlex and change over time.`,
      openAlexUrl: `https://openalex.org/${shortId(work.id)}`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
