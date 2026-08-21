/**
 * Makale çözümleme ve bağlam toplama.
 *
 * Kullanıcı elinde PDF olmadan da "şu makaleyi anlat" diyebilmeli. Bu modül
 * adı arXiv'de arar, PDF'i indirir ve makale hakkında güncel/resmi üstveriyi
 * toplar (sürüm geçmişi, DOI, yayımlandığı yer, atıf sayısı).
 *
 * GÜVENLİK: Ağdan dosya indirmek dikkatli yapılmalı.
 *   - Yalnızca izin listesindeki host'lara istek atılır; yönlendirme başka bir
 *     host'a çıkarsa istek düşürülür (SSRF ve keyfi indirme koruması).
 *   - Yalnızca HTTPS.
 *   - Boyut sınırı akış sırasında uygulanır, Content-Length'e güvenilmez.
 *   - İndirilen dosya %PDF- imzasıyla doğrulanır; çalıştırılmaz, açılmaz.
 *   - Zaman aşımı her istekte zorunlu.
 */

import { writeFileSync } from "node:fs";

const ALLOWED_HOSTS = new Set([
  "export.arxiv.org",
  "arxiv.org",
  "www.arxiv.org",
  "api.openalex.org",
  "api.semanticscholar.org",
]);

const MAX_PDF_BYTES = 35 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const USER_AGENT = "TracePaperStudio/0.3 (+https://github.com/Ahmet-Ruchan/trace-research-paper-studio)";

export class SourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "SourceError";
  }
}

function assertAllowed(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new SourceError(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new SourceError(`Only HTTPS is supported: ${parsed.protocol}//`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new SourceError(
      `Host not allowed: ${parsed.hostname}. Allowed: ${[...ALLOWED_HOSTS].join(", ")}`,
    );
  }
  return parsed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Semantic Scholar anahtarsız kullanımda paylaşımlı ve dar bir kotada çalışır;
 * arka arkaya çağrılarda 429 olağandır. Anahtarı olan kullanıcı
 * SEMANTIC_SCHOLAR_API_KEY tanımlayarak bu sınırı aşabilir.
 */
function extraHeaders(url) {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  return key && new URL(url).hostname === "api.semanticscholar.org" ? { "x-api-key": key } : {};
}

async function request(url, { accept = "application/json", attempt = 0, hops = 0, retries = 3 } = {}) {
  assertAllowed(url);
  if (hops > 4) throw new SourceError(`Too many redirects: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "manual", // yönlendirmeyi elle doğrularız
      signal: controller.signal,
      headers: { accept, "user-agent": USER_AGENT, ...extraHeaders(url) },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new SourceError(`Redirect has no target: ${url}`);
      const next = new URL(location, url).toString();
      assertAllowed(next); // yönlendirme izin listesinden çıkamaz
      return request(next, { accept, hops: hops + 1, retries });
    }

    // Anahtarsız akademik API'ler paylaşımlı kotada; 429 kalıcı hata değildir.
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      clearTimeout(timer);
      const retryAfter = Number(response.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 8000)
        : Math.min(1000 * 2 ** attempt, 8000);
      await sleep(backoff);
      return request(url, { accept, attempt: attempt + 1, hops, retries });
    }

    if (!response.ok) throw new SourceError(`${response.status} ${response.statusText} — ${url}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/* --- arXiv Atom ayrıştırma ---------------------------------------- */

function tagText(xml, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1].trim()) : undefined;
}

function tagAll(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) =>
    decodeXml(m[1].trim()),
  );
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ");
}

function parseEntries(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1];
    const id = tagText(entry, "id") ?? "";
    const versioned = id.split("/abs/")[1] ?? "";
    const arxivId = versioned.replace(/v\d+$/, "");
    const pdfMatch = /<link[^>]*title="pdf"[^>]*href="([^"]+)"/.exec(entry);
    return {
      arxivId,
      version: /v(\d+)$/.exec(versioned)?.[1],
      absUrl: `https://arxiv.org/abs/${versioned || arxivId}`,
      pdfUrl: (pdfMatch?.[1] ?? `http://arxiv.org/pdf/${versioned || arxivId}`).replace(
        /^http:/,
        "https:",
      ),
      title: tagText(entry, "title"),
      summary: tagText(entry, "summary"),
      authors: tagAll(entry, "name"),
      published: tagText(entry, "published"),
      updated: tagText(entry, "updated"),
      doi: tagText(entry, "arxiv:doi"),
      journalRef: tagText(entry, "arxiv:journal_ref"),
      comment: tagText(entry, "arxiv:comment"),
      primaryCategory: /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(entry)?.[1],
      categories: [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]),
    };
  });
}

/* --- Genel API ----------------------------------------------------- */

async function queryArxiv(searchQuery, limit) {
  const url =
    "https://export.arxiv.org/api/query?" +
    new URLSearchParams({
      search_query: searchQuery,
      start: "0",
      max_results: String(limit),
      sortBy: "relevance",
      sortOrder: "descending",
    });
  const response = await request(url, { accept: "application/atom+xml" });
  return parseEntries(await response.text());
}

/**
 * Başlıkla arXiv'de arar.
 *
 * ÖNCE başlık alanında (`ti:`) arar, SONRA tam metinde (`all:`). Sıra önemli:
 * `all:` araması popüler türev makaleleri öne çıkarıp aslını hiç döndürmeyebiliyor.
 * Ölçüldü — "denoising diffusion probabilistic models" için `all:` orijinal
 * makaleyi (2006.11239) ilk altıda hiç getirmezken `ti:` birinci sıraya koyuyor.
 */
export async function searchArxiv(query, limit = 5) {
  const clean = query.replace(/"/g, "");
  const byTitle = await queryArxiv(`ti:"${clean}"`, limit);
  const byAll = await queryArxiv(`all:"${clean}"`, limit).catch(() => []);

  const seen = new Set();
  return [...byTitle, ...byAll].filter((entry) => {
    if (!entry.arxivId || seen.has(entry.arxivId)) return false;
    seen.add(entry.arxivId);
    return true;
  });
}

/** arXiv kimliğiyle doğrudan tek kayıt getirir. */
export async function fetchArxivById(id) {
  const clean = String(id).trim().replace(/^arxiv:/i, "").replace(/v\d+$/, "");
  const url =
    "https://export.arxiv.org/api/query?" +
    new URLSearchParams({ id_list: clean, max_results: "1" });
  const response = await request(url, { accept: "application/atom+xml" });
  const entries = parseEntries(await response.text());
  if (!entries.length) throw new SourceError(`No arXiv record found: ${id}`);
  return entries[0];
}

/**
 * Başlıkları normalize edip karşılaştırır. arXiv arama motoru bazen alakasız
 * ama popüler sonuçları öne çıkardığı için, tam başlık eşleşmesini tercih
 * ederiz; hiçbiri yeterince benzemiyorsa çağırana karar bırakırız.
 */
export function rankByTitle(entries, query) {
  const normalize = (value) =>
    String(value ?? "")
      .toLocaleLowerCase("en")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const target = normalize(query);
  const targetWords = new Set(target.split(" ").filter(Boolean));

  return entries
    .map((entry) => {
      const title = normalize(entry.title);
      let score;
      if (title === target) {
        score = 1;
      } else {
        // Dice katsayısı: hem eksik hem FAZLA kelimeyi cezalandırır. Basit
        // kapsama oranı kullanmak "Tool Attention Is All You Need: ..." gibi
        // başlıkları gerçek makaleyle eşit puanlıyordu.
        const titleWords = new Set(title.split(" ").filter(Boolean));
        let overlap = 0;
        for (const word of targetWords) if (titleWords.has(word)) overlap += 1;
        score = (2 * overlap) / (titleWords.size + targetWords.size || 1);
      }
      return { ...entry, matchScore: Number(score.toFixed(3)) };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

/** PDF'i indirir. İmza ve boyut doğrulanır; dosya asla çalıştırılmaz. */
export async function downloadPdf(url, destination) {
  const response = await request(url, { accept: "application/pdf" });
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/pdf|octet-stream/i.test(contentType)) {
    throw new SourceError(`Expected a PDF; received content type: ${contentType}`);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_PDF_BYTES) {
      throw new SourceError(`The PDF exceeds the ${MAX_PDF_BYTES / 1024 / 1024} MB limit`);
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new SourceError("The downloaded file does not carry a valid PDF signature");
  }
  writeFileSync(destination, buffer);
  return { path: destination, sizeBytes: buffer.length, url };
}

/**
 * Makale hakkında güncel/resmi bağlam. Başarısız olan kaynak sessizce atlanır:
 * bağlam bir bonustur, makalenin kendisi değil — ağ hatası tüm akışı düşürmemeli.
 */
export async function fetchSemanticScholar(arxivId) {
  const fields = [
    "title", "abstract", "venue", "publicationVenue", "year", "publicationDate",
    "citationCount", "influentialCitationCount", "referenceCount", "fieldsOfStudy",
    "externalIds", "openAccessPdf", "tldr", "authors.name", "authors.hIndex",
  ].join(",");
  const url = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(arxivId)}?fields=${fields}`;
  try {
    const response = await request(url, { retries: 5 });
    const data = await response.json();
    return {
      ok: true,
      url,
      retrievedAt: new Date().toISOString(),
      venue: data.publicationVenue?.name ?? data.venue ?? undefined,
      year: data.year,
      publicationDate: data.publicationDate,
      citationCount: data.citationCount,
      influentialCitationCount: data.influentialCitationCount,
      referenceCount: data.referenceCount,
      fieldsOfStudy: data.fieldsOfStudy,
      doi: data.externalIds?.DOI,
      corpusId: data.externalIds?.CorpusId,
      tldr: data.tldr?.text,
      authors: (data.authors ?? []).map((author) => author.name),
    };
  } catch (error) {
    return { ok: false, url, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * OpenAlex: anahtarsız, cömert kotalı ve kapsamlı. Birincil bağlam kaynağı.
 * Semantic Scholar anahtarsız kullanımda sık 429 verdiği için ikincil kaldı.
 */
export async function fetchOpenAlex(arxivId, doi) {
  // SADECE gerçek yayıncı DOI'si ile sorgulanır. İki alternatif yol da
  // ÖLÇÜLDÜ ve YANLIŞ KAYIT döndürüyor:
  //   - works/arxiv:<id>            → 404
  //   - works/doi:10.48550/arXiv.<id> → başka bir makale
  // Örnek: LoRA (2106.09685) için 10.48550 formu "LoRA Fine-Tuning of a 3B
  // Code LLM" kaydını 2.516 atıfla döndürüyor; doğrusu 22.087. Otoriter
  // görünümlü yanlış veri, eksik veriden çok daha kötüdür.
  if (!doi || /^10\.48550\//i.test(doi)) {
    return { ok: false, skipped: "no publisher DOI; querying by arXiv id returns the wrong record" };
  }
  const target = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`;
  try {
    const response = await request(target);
    const data = await response.json();
    const location = data.primary_location ?? {};
    return {
      ok: true,
      url: target,
      retrievedAt: new Date().toISOString(),
      openAlexId: data.id,
      title: data.title,
      venue: location.source?.display_name,
      venueType: location.source?.type,
      publicationDate: data.publication_date,
      year: data.publication_year,
      citationCount: data.cited_by_count,
      citationsByYear: (data.counts_by_year ?? [])
        .slice(0, 8)
        .map((entry) => ({ year: entry.year, citations: entry.cited_by_count })),
      referencedWorks: data.referenced_works_count,
      doi: data.doi,
      isOpenAccess: data.open_access?.is_oa,
      concepts: (data.concepts ?? [])
        .filter((concept) => concept.score > 0.3)
        .slice(0, 8)
        .map((concept) => concept.display_name),
      authors: (data.authorships ?? []).map((authorship) => authorship.author?.display_name).filter(Boolean),
    };
  } catch (error) {
    return { ok: false, url: target, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Tüm bağlam kaynaklarını toplar. Her kaynak bağımsız olarak başarısız
 * olabilir: bağlam bir bonustur, makalenin kendisi değil — bir API'nin kotası
 * dolduğu için tüm akış düşmemeli.
 */
export async function collectContext(entry) {
  // Sıralı çağrı: paylaşımlı kotayı aynı anda iki istekle zorlamak 429 olasılığını
  // artırıyor. Bağlam toplamanın hızı kritik değil, güvenilirliği kritik.
  const openAlex = await fetchOpenAlex(entry.arxivId, entry.doi);
  const semanticScholar = await fetchSemanticScholar(entry.arxivId);
  return {
    retrievedAt: new Date().toISOString(),
    arxiv: {
      ok: true,
      url: entry.absUrl,
      arxivId: entry.arxivId,
      latestVersion: entry.version,
      title: entry.title,
      authors: entry.authors,
      summary: entry.summary,
      published: entry.published,
      updated: entry.updated,
      doi: entry.doi,
      journalRef: entry.journalRef,
      comment: entry.comment,
      primaryCategory: entry.primaryCategory,
      categories: entry.categories,
    },
    openAlex,
    semanticScholar,
  };
}

export const SOURCE_LIMITS = { MAX_PDF_BYTES, REQUEST_TIMEOUT_MS, ALLOWED_HOSTS: [...ALLOWED_HOSTS] };
