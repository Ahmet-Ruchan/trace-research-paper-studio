/**
 * Makale çözümleme ve bağlam toplama.
 *
 * Kullanıcı elinde PDF olmadan da "şu makaleyi anlat" diyebilmeli. Bu modül
 * adı arXiv'de arar, PDF'i indirir ve makale hakkında güncel/resmi üstveriyi
 * toplar (sürüm geçmişi, DOI, yayımlandığı yer, atıf sayısı).
 *
 * arXiv tek kaynak değil: biyoloji ve tıp bioRxiv/medRxiv ile PubMed
 * Central'da, NLP ACL Anthology'de, ML konferansları OpenReview'da yaşıyor.
 * Bir DOI ya da bu depolardan birinin bağlantısı da çözülür; açık erişimli
 * kopya OpenAlex, Europe PMC ve (e-posta tanımlıysa) Unpaywall üzerinden aranır.
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
import { inflateRawSync } from "node:zlib";

const ALLOWED_HOSTS = new Set([
  "export.arxiv.org",
  "arxiv.org",
  "www.arxiv.org",
  "api.openalex.org",
  "api.semanticscholar.org",
  // Açık erişim depoları. Liste bilerek kısa: yayıncı siteleri YOK, çünkü
  // "herhangi bir PDF adresi" demek izin listesinin hiç olmaması demek.
  "api.biorxiv.org",
  "www.biorxiv.org",
  "www.medrxiv.org",
  "www.ebi.ac.uk",
  "ftp.ebi.ac.uk",
  "aclanthology.org",
  "openreview.net",
  "api2.openreview.net",
  "api.openreview.net",
  "api.unpaywall.org",
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

/** İzin listesi denetimini hata fırlatmadan soran sürüm: aday PDF adreslerini elemek için. */
export function isAllowedUrl(url) {
  try {
    assertAllowed(url);
    return true;
  } catch {
    return false;
  }
}

export async function request(url, { accept = "application/json", attempt = 0, hops = 0, retries = 3 } = {}) {
  assertAllowed(url);
  if (hops > 4) throw new SourceError(`Too many redirects: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(url, {
        redirect: "manual", // yönlendirmeyi elle doğrularız
        signal: controller.signal,
        headers: { accept, "user-agent": USER_AGENT, ...extraHeaders(url) },
      });
    } catch (error) {
      // Bağlantı düzeyindeki hata (sıfırlanan soket, DNS takılması) da geçicidir;
      // zaman aşımı değilse bir kez daha denenir.
      if (controller.signal.aborted || attempt >= Math.min(retries, 1)) throw error;
      clearTimeout(timer);
      await sleep(1000);
      return request(url, { accept, attempt: attempt + 1, hops, retries });
    }

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
    const pdfUrl = (pdfMatch?.[1] ?? `http://arxiv.org/pdf/${versioned || arxivId}`).replace(/^http:/, "https:");
    return {
      origin: "arxiv",
      arxivId,
      version: /v(\d+)$/.exec(versioned)?.[1],
      absUrl: `https://arxiv.org/abs/${versioned || arxivId}`,
      pdfUrl,
      pdfCandidates: [pdfUrl],
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

/** PDF'i belleğe indirir. İmza ve boyut doğrulanır; içerik asla çalıştırılmaz. */
export async function fetchPdfBuffer(url) {
  // Depolar geçici hatada HTML bir hata sayfası döndürebiliyor; tek deneme
  // yeterli, çünkü çağıran bir sonraki aday adrese geçebiliyor.
  const archive = isPmcArchiveUrl(url);
  const response = await request(url, { accept: archive ? "application/zip" : "application/pdf", retries: 1 });
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !(archive ? /zip|octet-stream/i : /pdf|octet-stream/i).test(contentType)) {
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
  const downloaded = Buffer.concat(chunks);
  const buffer = archive ? pdfFromArchive(downloaded) : downloaded;
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new SourceError("The downloaded file does not carry a valid PDF signature");
  }
  return buffer;
}

/**
 * Europe PMC'nin açık erişim PDF arşivi.
 *
 * PubMed Central'ın ve Europe PMC'nin web sayfaları PDF'i bir tarayıcı
 * doğrulamasının arkasında veriyor ve Trace bunu aşmaya ÇALIŞMAZ. Programla
 * erişim için ayrılmış yol EBI'nin dosya sunucusu: açık erişim alt kümesindeki
 * her makale, on binlik klasörlerde tek bir zip olarak duruyor.
 */
export function pmcArchiveUrl(pmcid) {
  const number = Number(String(pmcid).replace(/^PMC/i, ""));
  if (!Number.isInteger(number) || number <= 0) return undefined;
  return `https://ftp.ebi.ac.uk/pub/databases/pmc/pdf/OA/PMCxxxx${Math.ceil(number / 10_000)}/PMC${number}.zip`;
}

function isPmcArchiveUrl(url) {
  const parsed = new URL(url);
  return parsed.hostname === "ftp.ebi.ac.uk" && parsed.pathname.endsWith(".zip");
}

/**
 * Zip'in içindeki makale PDF'ini çıkarır.
 *
 * Bağımlılık yok: merkezi dizin okunur, girdi `zlib` ile açılır. Arşivde ek
 * dosyalar da bulunabiliyor; adı arşivle aynı olan PDF, yoksa en büyüğü
 * makalenin kendisidir. Açılmış boyut da sınıra tabi — bir zip bombası
 * indirme sınırını aşmanın yolu olmamalı.
 */
export function pdfFromArchive(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new SourceError("The downloaded archive is not a valid zip file");
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);

  const entries = [];
  for (let index = 0; index < count && cursor + 46 <= zip.length; index += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) break;
    const nameLength = zip.readUInt16LE(cursor + 28);
    entries.push({
      name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      method: zip.readUInt16LE(cursor + 10),
      compressedSize: zip.readUInt32LE(cursor + 20),
      size: zip.readUInt32LE(cursor + 24),
      headerOffset: zip.readUInt32LE(cursor + 42),
    });
    cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
  }

  const pdfs = entries.filter((entry) => /\.pdf$/i.test(entry.name)).sort((a, b) => b.size - a.size);
  const entry = pdfs.find((candidate) => /^PMC\d+\.pdf$/i.test(candidate.name.split("/").pop())) ?? pdfs[0];
  if (!entry) throw new SourceError("The open-access archive does not contain a PDF");
  if (entry.size > MAX_PDF_BYTES) throw new SourceError(`The PDF exceeds the ${MAX_PDF_BYTES / 1024 / 1024} MB limit`);
  if (entry.method !== 0 && entry.method !== 8) throw new SourceError("The archive uses an unsupported compression method");

  const start = entry.headerOffset + 30 + zip.readUInt16LE(entry.headerOffset + 26) + zip.readUInt16LE(entry.headerOffset + 28);
  const data = zip.subarray(start, start + entry.compressedSize);
  return entry.method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_PDF_BYTES });
}

/** PDF'i indirir. İmza ve boyut doğrulanır; dosya asla çalıştırılmaz. */
export async function downloadPdf(url, destination) {
  const buffer = await fetchPdfBuffer(url);
  writeFileSync(destination, buffer);
  return { path: destination, sizeBytes: buffer.length, url };
}

/**
 * Bir kaydın aday PDF adreslerini sırayla dener.
 *
 * arXiv dışında tek bir "doğru" adres yok: bioRxiv bot korumasıyla 403
 * dönebiliyor, OpenAlex'in verdiği bağlantı bir açılış sayfası çıkabiliyor.
 * İlk geçerli PDF kazanır; hiçbiri olmazsa hata, denenen her adresi ve izin
 * listesi dışında kalanları söyler ki kullanıcı dosyayı elle indirip
 * `--paper` ile verebilsin.
 */
export async function fetchFirstAvailablePdf(entry) {
  const candidates = entry.pdfCandidates?.length ? entry.pdfCandidates : entry.pdfUrl ? [entry.pdfUrl] : [];
  const attempts = [];
  for (const url of candidates) {
    try {
      const buffer = await fetchPdfBuffer(url);
      return { buffer, url, attempts };
    } catch (error) {
      attempts.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const tried = attempts.length
    ? ` Tried: ${attempts.map((attempt) => `${attempt.url} (${attempt.error})`).join("; ")}.`
    : "";
  const blocked = entry.blockedPdfUrls?.length
    ? ` An open-access copy may exist on a host Trace does not download from: ${entry.blockedPdfUrls.join(", ")}.`
    : "";
  throw new SourceError(
    `No open-access PDF could be downloaded for "${entry.title ?? entry.doi ?? "this paper"}".${tried}${blocked} Download the PDF yourself and pass it with --paper.`,
  );
}

export async function downloadFirstAvailable(entry, destination) {
  const { buffer, url, attempts } = await fetchFirstAvailablePdf(entry);
  writeFileSync(destination, buffer);
  return { path: destination, sizeBytes: buffer.length, url, attempts };
}

/**
 * Makale hakkında güncel/resmi bağlam. Başarısız olan kaynak sessizce atlanır:
 * bağlam bir bonustur, makalenin kendisi değil — ağ hatası tüm akışı düşürmemeli.
 */
export async function fetchSemanticScholar(arxivId, doi) {
  // arXiv kimliği yoksa yayıncı DOI'si de aynı uçnoktada geçerli bir anahtar.
  // DOI'deki "/" yolun parçası olarak kalmalı; bu yüzden encodeURIComponent değil encodeURI.
  const paperKey = arxivId ? `arXiv:${encodeURI(arxivId)}` : doi ? `DOI:${encodeURI(doi)}` : undefined;
  if (!paperKey) return { ok: false, skipped: "no arXiv id or DOI to look the paper up by" };
  const fields = [
    "title", "abstract", "venue", "publicationVenue", "year", "publicationDate",
    "citationCount", "influentialCitationCount", "referenceCount", "fieldsOfStudy",
    "externalIds", "openAccessPdf", "tldr", "authors.name", "authors.hIndex",
  ].join(",");
  const url = `https://api.semanticscholar.org/graph/v1/paper/${paperKey}?fields=${fields}`;
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

/** Bir OpenAlex kaydının bildirdiği açık erişimli PDF adresleri, en iyisi önce. */
export function openAlexPdfUrls(work) {
  const urls = [
    work.best_oa_location?.pdf_url,
    ...(work.locations ?? []).map((location) => location?.pdf_url),
    // `oa_url` çoğu zaman bir açılış sayfası; yalnızca PDF'e benziyorsa aday.
    /\.pdf(?:$|[?#])/i.test(work.open_access?.oa_url ?? "") ? work.open_access.oa_url : undefined,
  ]
    .filter((url) => typeof url === "string" && url)
    .map((url) => url.replace(/^http:/, "https:"));
  return [...new Set(urls)];
}

/** Kaydın bir arXiv kopyası varsa kimliği; o kopya her zaman indirilebilir. */
export function openAlexArxivId(work) {
  for (const location of work.locations ?? []) {
    const match = /arxiv\.org\/(?:abs|pdf)\/([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})/i.exec(
      `${location?.landing_page_url ?? ""} ${location?.pdf_url ?? ""}`,
    );
    if (match) return match[1];
  }
  return undefined;
}

/** OpenAlex özeti ters dizin olarak saklıyor ({kelime: [konumlar]}); düz metne çevrilir. */
export function openAlexAbstract(work) {
  const index = work.abstract_inverted_index;
  if (!index || typeof index !== "object") return undefined;
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.filter(Boolean).join(" ") || undefined;
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
      oaPdfUrls: openAlexPdfUrls(data),
      arxivId: openAlexArxivId(data),
      abstract: openAlexAbstract(data),
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
  const semanticScholar = await fetchSemanticScholar(entry.arxivId, entry.doi);
  // Atıf grafiği de bir bonus: makalenin dayandığı ve onu izleyen çalışmalar.
  const { fetchCitationGraph } = await import("./citation-graph.mjs");
  const citationGraph = await fetchCitationGraph({
    openAlexId: openAlex.ok ? openAlex.openAlexId : undefined,
    doi: entry.doi,
    title: entry.title,
    authors: entry.authors,
  });
  return {
    retrievedAt: new Date().toISOString(),
    // Makalenin nereden çözüldüğü. arXiv dışı kayıtlarda `arxiv` bloğu yoktur.
    source: {
      origin: entry.origin ?? "arxiv",
      url: entry.absUrl,
      title: entry.title,
      authors: entry.authors,
      summary: entry.summary,
      published: entry.published,
      doi: entry.doi,
      venue: entry.venue,
      version: entry.version,
      pmcid: entry.pmcid,
      aclId: entry.aclId,
      openReviewId: entry.openReviewId,
    },
    arxiv: entry.arxivId && (entry.origin ?? "arxiv") === "arxiv"
      ? {
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
        }
      : undefined,
    openAlex,
    semanticScholar,
    citationGraph,
  };
}

/* --- arXiv dışı kaynaklar ------------------------------------------ */

const ARXIV_ID = /^(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i;
const DOI = /^10\.\d{4,9}\/\S+$/;
const ACL_ID = /^(?:\d{4}\.[a-z0-9-]+\.\d+|[A-Z]\d{2}-\d{4})$/i;

/**
 * Kullanıcının verdiği şeyin NE olduğunu söyler: arXiv kimliği, DOI, bir
 * deponun bağlantısı ya da yalnızca bir başlık. Ağa gitmez; bu yüzden hem
 * köprü hem stüdyo aynı kuralı sınayarak kullanabiliyor.
 */
export function parseIdentifier(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { kind: "empty", id: "" };

  const bare = raw.replace(/^arxiv:/i, "");
  if (ARXIV_ID.test(bare)) return { kind: "arxiv", id: bare.replace(/v\d+$/i, "") };
  if (/^doi:/i.test(raw) && DOI.test(raw.slice(4).trim())) return doiIdentifier(raw.slice(4).trim());
  if (DOI.test(raw)) return doiIdentifier(raw);
  if (/^PMC\d+$/i.test(raw)) return { kind: "pmc", id: raw.toUpperCase() };
  if (/^openreview:/i.test(raw)) return { kind: "openreview", id: raw.slice("openreview:".length).trim() };
  if (ACL_ID.test(raw)) return { kind: "acl", id: raw };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "title", id: raw };
  }
  const host = url.hostname.replace(/^www\./, "");
  const path = decodeURIComponent(url.pathname);

  if (host === "arxiv.org" || host === "export.arxiv.org") {
    const match = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/.exec(path);
    if (match && ARXIV_ID.test(match[1])) return { kind: "arxiv", id: match[1].replace(/v\d+$/i, "") };
  }
  if (host === "doi.org" || host === "dx.doi.org") {
    const doi = path.replace(/^\//, "");
    if (DOI.test(doi)) return doiIdentifier(doi);
  }
  if (host === "biorxiv.org" || host === "medrxiv.org") {
    const match = /\/content\/(?:[^/]+\/)*?(10\.\d{4,9}\/[^/\s]+?)(?:v\d+)?(?:\.full(?:\.pdf)?(?:\+html)?|\.abstract)?$/.exec(path);
    if (match) return { kind: "doi", id: match[1] };
  }
  if (["ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov", "europepmc.org"].includes(host)) {
    const match = /(PMC\d+)/i.exec(path);
    if (match) return { kind: "pmc", id: match[1].toUpperCase() };
  }
  if (host === "aclanthology.org") {
    const id = path.replace(/^\/|\/$/g, "").replace(/\.pdf$/i, "");
    if (ACL_ID.test(id)) return { kind: "acl", id };
  }
  if (host === "openreview.net") {
    const id = url.searchParams.get("id");
    if (id) return { kind: "openreview", id };
  }
  throw new SourceError(
    `This link is not from a source Trace can resolve: ${url.hostname}. Supported: arXiv, a DOI, bioRxiv, medRxiv, PubMed Central, ACL Anthology and OpenReview.`,
  );
}

/** Kendi PDF'ini sunan bir deponun DOI'si mi — o zaman açık kopya kesin var. */
export function doiHasRepository(doi) {
  return /^10\.(?:1101|18653\/v1)\//i.test(String(doi ?? ""));
}

/** DOI'ler büyük/küçük harfe duyarsız ama ACL'nin eski kimlikleri ("D15-1166") değil. */
function aclIdFromDoi(doi) {
  const id = doi.replace(/^10\.18653\/v1\//i, "");
  return /^[a-z]\d{2}-\d{4}$/i.test(id) ? id.toUpperCase() : id;
}

function doiIdentifier(doi) {
  // arXiv'in kendi DOI'si bir arXiv kimliğidir; OpenAlex'te yanlış kayda gidiyor.
  const arxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
  if (arxiv) return { kind: "arxiv", id: arxiv[1].replace(/v\d+$/i, "") };
  return { kind: "doi", id: doi.replace(/[.,;)]+$/, "") };
}

/** Aday adresleri izin listesine göre ayırır; dışarıda kalanlar kullanıcıya raporlanır. */
function withPdfCandidates(entry, urls) {
  const unique = [...new Set(urls.filter(Boolean).map((url) => String(url).replace(/^http:/, "https:")))];
  const pdfCandidates = unique.filter(isAllowedUrl);
  return {
    ...entry,
    pdfCandidates,
    pdfUrl: pdfCandidates[0],
    blockedPdfUrls: unique.filter((url) => !isAllowedUrl(url)),
    pdfAvailable: pdfCandidates.length > 0,
  };
}

async function optional(task, onError) {
  try {
    return await task();
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
    return undefined;
  }
}

/** bioRxiv ve medRxiv aynı API'yi paylaşıyor; DOI hangisinde olduğunu söylemiyor. */
export async function fetchBiorxivByDoi(doi) {
  for (const server of ["biorxiv", "medrxiv"]) {
    const url = `https://api.biorxiv.org/details/${server}/${encodeURI(doi)}/na/json`;
    const data = await optional(async () => (await request(url)).json());
    const versions = data?.collection ?? [];
    if (!versions.length) continue;
    const latest = versions[versions.length - 1];
    const version = String(latest.version ?? "1");
    return {
      origin: server,
      doi,
      version,
      title: latest.title,
      summary: latest.abstract,
      // "Evans, R." biçiminde geliyor; diğer kaynaklarla aynı sıraya çevrilir.
      authors: String(latest.authors ?? "")
        .split(";")
        .map((author) => author.split(",").map((part) => part.trim()).reverse().join(" ").trim())
        .filter(Boolean),
      published: latest.date,
      venue: server === "biorxiv" ? "bioRxiv" : "medRxiv",
      publishedDoi: latest.published && latest.published !== "NA" ? latest.published : undefined,
      absUrl: `https://www.${server}.org/content/${doi}v${version}`,
      repositoryPdfUrl: `https://www.${server}.org/content/${doi}v${version}.full.pdf`,
    };
  }
  return undefined;
}

/** Europe PMC: PubMed Central kayıtlarının üstverisi ve açık erişim arşivinin anahtarı. */
export async function fetchEuropePmc(query) {
  const url =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({ query, format: "json", resultType: "core", pageSize: "5" });
  const data = await (await request(url)).json();
  return (data?.resultList?.result ?? []).map((record) => ({
    origin: "pmc",
    pmcid: record.pmcid,
    pmid: record.pmid,
    doi: record.doi,
    title: String(record.title ?? "").replace(/\.$/, ""),
    summary: record.abstractText,
    authors: String(record.authorString ?? "").replace(/\.$/, "").split(",").map((author) => author.trim()).filter(Boolean),
    published: record.firstPublicationDate ?? record.pubYear,
    venue: record.journalInfo?.journal?.title,
    citationCount: record.citedByCount,
    absUrl: record.pmcid
      ? `https://europepmc.org/article/PMC/${record.pmcid}`
      : `https://europepmc.org/article/${record.source}/${record.id}`,
    // Yalnızca açık erişim alt kümesi arşivde; diğerleri için aday üretilmez.
    repositoryPdfUrl: record.pmcid && record.isOpenAccess === "Y" ? pmcArchiveUrl(record.pmcid) : undefined,
  }));
}

function bibField(bib, field) {
  const match = new RegExp(`\\b${field}\\s*=\\s*(?:"([\\s\\S]*?)"|\\{([\\s\\S]*?)\\})\\s*,?\\s*\\n`, "i").exec(bib);
  const value = match?.[1] ?? match?.[2];
  // LaTeX süsleri ({\l}, \'e) düz metne indirgenir.
  return value ? value.replace(/\\[^a-zA-Z\s]?/g, "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim() : undefined;
}

/** ACL Anthology'nin API'si yok ama her kaydın bir BibTeX dosyası var. */
export async function fetchAclById(id) {
  const bib = await (await request(`https://aclanthology.org/${encodeURI(id)}.bib`, { accept: "text/plain" })).text();
  const title = bibField(bib, "title");
  if (!title) throw new SourceError(`No ACL Anthology record found: ${id}`);
  return {
    origin: "acl",
    aclId: id,
    doi: bibField(bib, "doi"),
    title,
    summary: bibField(bib, "abstract"),
    authors: (bibField(bib, "author") ?? "")
      .split(/\s+and\s+/)
      .map((author) => author.split(",").map((part) => part.trim()).reverse().join(" ").trim())
      .filter(Boolean),
    published: bibField(bib, "year"),
    venue: bibField(bib, "booktitle") ?? bibField(bib, "journal"),
    absUrl: `https://aclanthology.org/${id}/`,
    repositoryPdfUrl: `https://aclanthology.org/${id}.pdf`,
  };
}

/** OpenReview'ın iki API sürümü de yaşıyor; eski konferanslar v1'de kaldı. */
export async function fetchOpenReviewById(id) {
  const unwrap = (field) => (field && typeof field === "object" && "value" in field ? field.value : field);
  let challenged = false;
  for (const api of ["https://api2.openreview.net", "https://api.openreview.net"]) {
    const data = await optional(async () => (await request(`${api}/notes?id=${encodeURIComponent(id)}`, { retries: 1 })).json(), (error) => {
      if (/^403\b/.test(error.message)) challenged = true;
    });
    const note = data?.notes?.[0];
    if (!note?.content) continue;
    const title = unwrap(note.content.title);
    if (!title) continue;
    const timestamp = note.pdate ?? note.cdate;
    return {
      origin: "openreview",
      openReviewId: id,
      title,
      summary: unwrap(note.content.abstract),
      authors: [unwrap(note.content.authors)].flat().filter((author) => typeof author === "string"),
      published: timestamp ? new Date(timestamp).toISOString().slice(0, 10) : undefined,
      venue: unwrap(note.content.venue),
      absUrl: `https://openreview.net/forum?id=${encodeURIComponent(id)}`,
      repositoryPdfUrl: `https://openreview.net/pdf?id=${encodeURIComponent(id)}`,
    };
  }
  // OpenReview programla gelen isteklere bir tarayıcı doğrulaması sorabiliyor.
  // Bu bilinçli bir engel ve aşılmaz. Ama makalenin KİM olduğunu başka bir
  // dizinden öğrenmek engeli aşmak değil: OpenAlex bazı OpenReview sayfalarını
  // tanıyor ve makalenin arXiv kopyası oradan indirilebiliyor.
  if (challenged) {
    const known = await optional(() => findOpenAlexByLandingPage(`https://openreview.net/forum?id=${id}`));
    if (known) return { ...known, openReviewId: id, viaOpenAlex: true };
    throw new SourceError(
      `OpenReview asked for a browser check, which Trace does not bypass. Open https://openreview.net/pdf?id=${id} in your browser, save the PDF and pass it with --paper — or give the paper's title, since most OpenReview papers are also on arXiv.`,
    );
  }
  throw new SourceError(`No public OpenReview submission found: ${id}`);
}

/** Bir açılış sayfası adresinden OpenAlex kaydını bulur; yoksa `undefined`. */
export async function findOpenAlexByLandingPage(landingPageUrl) {
  const url =
    "https://api.openalex.org/works?" +
    new URLSearchParams({
      filter: `locations.landing_page_url:${landingPageUrl}`,
      "per-page": "1",
      select: "id,doi,title,publication_date,publication_year,authorships,primary_location,best_oa_location,locations,open_access,abstract_inverted_index",
    });
  const work = (await (await request(url)).json())?.results?.[0];
  if (!work?.title) return undefined;
  const doi = work.doi ? String(work.doi).replace(/^https?:\/\/doi\.org\//i, "") : undefined;
  return {
    origin: "openreview",
    openAlexId: work.id,
    doi: doi && !/^10\.48550\//i.test(doi) ? doi : undefined,
    arxivId: openAlexArxivId(work),
    title: work.title,
    summary: openAlexAbstract(work),
    authors: (work.authorships ?? []).map((authorship) => authorship.author?.display_name).filter(Boolean),
    published: work.publication_date ?? String(work.publication_year ?? ""),
    venue: work.primary_location?.source?.display_name,
    absUrl: landingPageUrl,
    oaPdfUrls: openAlexPdfUrls(work),
  };
}

/** Unpaywall bir e-posta ister; kullanıcı vermediyse hiç çağrılmaz. */
async function fetchUnpaywallPdfUrls(doi) {
  const email = process.env.UNPAYWALL_EMAIL;
  if (!email) return [];
  const url = `https://api.unpaywall.org/v2/${encodeURI(doi)}?email=${encodeURIComponent(email)}`;
  const data = await optional(async () => (await request(url, { retries: 1 })).json());
  return [data?.best_oa_location?.url_for_pdf, ...(data?.oa_locations ?? []).map((location) => location?.url_for_pdf)]
    .filter(Boolean);
}

/**
 * Bir DOI'yi indirilebilir bir kayda çevirir.
 *
 * Tek bir kaynak yetmiyor: depo (bioRxiv, ACL) kendi PDF'ini verir, Europe PMC
 * tıp makalelerinin açık kopyasını, OpenAlex geri kalan her şeyin açık erişim
 * konumlarını. Hepsi sorulur ve adaylar güvenilirlik sırasına dizilir.
 */
export async function resolveDoi(doi) {
  const clean = doiIdentifier(String(doi).trim().replace(/^doi:/i, ""));
  if (clean.kind === "arxiv") return fetchArxivById(clean.id);

  const repository = /^10\.1101\//.test(clean.id)
    ? await fetchBiorxivByDoi(clean.id)
    : /^10\.18653\/v1\//i.test(clean.id)
      ? await optional(() => fetchAclById(aclIdFromDoi(clean.id)))
      : undefined;
  const openAlex = await fetchOpenAlex(undefined, clean.id);
  const europePmc = (await optional(() => fetchEuropePmc(`DOI:"${clean.id}"`)))?.find(
    (record) => record.doi?.toLowerCase() === clean.id.toLowerCase(),
  );
  const unpaywall = await fetchUnpaywallPdfUrls(clean.id);

  const base = repository ?? europePmc ?? (openAlex.ok
    ? {
        origin: "openalex",
        title: openAlex.title,
        summary: openAlex.abstract,
        authors: openAlex.authors,
        published: openAlex.publicationDate,
        venue: openAlex.venue,
        absUrl: `https://doi.org/${clean.id}`,
      }
    : undefined);
  if (!base?.title) throw new SourceError(`No record found for DOI ${clean.id}.`);

  const arxivId = openAlex.ok ? openAlex.arxivId : undefined;
  return withPdfCandidates(
    { ...base, doi: clean.id, arxivId, pmcid: base.pmcid ?? europePmc?.pmcid, venue: base.venue ?? (openAlex.ok ? openAlex.venue : undefined) },
    [
      // arXiv kopyası varsa en güvenilir indirme odur.
      arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined,
      repository?.origin === "acl" ? repository.repositoryPdfUrl : undefined,
      europePmc?.repositoryPdfUrl,
      ...unpaywall,
      ...(openAlex.ok ? openAlex.oaPdfUrls : []),
      // bioRxiv bot korumasıyla 403 dönebiliyor; bu yüzden en sonda.
      repository?.origin !== "acl" ? repository?.repositoryPdfUrl : undefined,
    ],
  );
}

/** `parseIdentifier` sonucunu indirilebilir bir kayda çevirir. Başlıklar burada çözülmez. */
export async function resolveIdentifier(identifier) {
  const parsed = typeof identifier === "string" ? parseIdentifier(identifier) : identifier;
  switch (parsed.kind) {
    case "arxiv":
      return fetchArxivById(parsed.id);
    case "doi":
      return resolveDoi(parsed.id);
    case "pmc": {
      const record = (await fetchEuropePmc(`PMCID:${parsed.id}`)).find((item) => item.pmcid === parsed.id);
      if (!record) throw new SourceError(`No PubMed Central record found: ${parsed.id}`);
      return withPdfCandidates(record, [record.repositoryPdfUrl]);
    }
    case "acl": {
      const record = await fetchAclById(parsed.id);
      return withPdfCandidates(record, [record.repositoryPdfUrl]);
    }
    case "openreview": {
      const record = await fetchOpenReviewById(parsed.id);
      // Doğrulama istendiyse OpenReview'ın kendi PDF'i de kapalıdır; arXiv kopyası denenir.
      return withPdfCandidates(
        record,
        record.viaOpenAlex
          ? [record.arxivId ? `https://arxiv.org/pdf/${record.arxivId}` : undefined, ...(record.oaPdfUrls ?? []).filter((url) => !/openreview\.net/.test(url))]
          : [record.repositoryPdfUrl],
      );
    }
    default:
      throw new SourceError("A paper title is searched, not resolved; use searchPapers.");
  }
}

/** Başlıkla OpenAlex'te arar; her kayıt açık erişim adaylarıyla birlikte döner. */
export async function searchOpenAlex(title, limit = 5) {
  // Filtre sözdiziminde "," ayırıcı, "|" VEYA anlamına geliyor.
  const clean = String(title).replace(/[,|:"]/g, " ").replace(/\s+/g, " ").trim();
  const url =
    "https://api.openalex.org/works?" +
    new URLSearchParams({
      filter: `title.search:${clean}`,
      "per-page": String(limit),
      select: "id,doi,title,publication_year,publication_date,cited_by_count,authorships,primary_location,best_oa_location,locations,open_access,abstract_inverted_index",
    });
  const data = await (await request(url)).json();
  return (data?.results ?? []).map((work) => {
    const doi = work.doi ? String(work.doi).replace(/^https?:\/\/doi\.org\//i, "") : undefined;
    const arxivId = openAlexArxivId(work);
    return withPdfCandidates(
      {
        origin: "openalex",
        openAlexId: work.id,
        doi: doi && !/^10\.48550\//i.test(doi) ? doi : undefined,
        arxivId,
        title: work.title,
        summary: openAlexAbstract(work),
        authors: (work.authorships ?? []).map((authorship) => authorship.author?.display_name).filter(Boolean),
        published: work.publication_date ?? String(work.publication_year ?? ""),
        venue: work.primary_location?.source?.display_name,
        citationCount: work.cited_by_count,
        absUrl: work.doi ?? work.id,
      },
      [arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined, ...openAlexPdfUrls(work)],
    );
  });
}

/**
 * Başlıkla arar: önce arXiv, eşleşme kesin değilse OpenAlex de.
 *
 * arXiv'de olmayan makale arXiv aramasında da bir sonuç döndürür — yanlış
 * olanı. Bu yüzden ikinci kaynağa "arXiv boş döndüyse" değil "arXiv emin
 * değilse" gidiliyor. Aynı başlık iki kaynakta da varsa arXiv kaydı kalır:
 * onun PDF'i her zaman indirilebilir.
 */
export async function searchPapers(title, limit = 8) {
  const arxiv = rankByTitle(await optional(() => searchArxiv(title, limit)) ?? [], title);
  if (isConfidentMatch(arxiv)) return arxiv;

  const openAlex = await optional(() => searchOpenAlex(title, limit)) ?? [];
  const normalize = (value) => String(value ?? "").toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set(arxiv.map((entry) => normalize(entry.title)));
  const seenArxiv = new Set(arxiv.map((entry) => entry.arxivId));
  const extra = openAlex.filter((entry) => {
    const key = normalize(entry.title);
    if (!key || seen.has(key) || (entry.arxivId && seenArxiv.has(entry.arxivId))) return false;
    seen.add(key);
    return true;
  });
  // Eşit puanda indirilebilir olan öne geçer; sıralama kararlı olduğu için arXiv önceliği korunur.
  return rankByTitle([...arxiv, ...extra], title).sort(
    (a, b) => b.matchScore - a.matchScore || Number(b.pdfAvailable !== false) - Number(a.pdfAvailable !== false),
  );
}

/**
 * Güven, yakın eşleşmeyle YETİNMEZ. "denoising diffusion probabilistic models"
 * aramasında üç türev makale 0.889'da berabere kalıp orijinali hiç listeye
 * girmiyordu; 0.85 eşiği bunu "kesin" sayıyordu. Hem neredeyse birebir başlık
 * hem de ikinciye açık fark aranıyor.
 */
export function isConfidentMatch(ranked) {
  const [first, second] = ranked;
  if (!first) return false;
  return (first.matchScore ?? 0) >= 0.95 && (first.matchScore ?? 0) - (second?.matchScore ?? 0) >= 0.05;
}

export const SOURCE_LIMITS = { MAX_PDF_BYTES, REQUEST_TIMEOUT_MS, ALLOWED_HOSTS: [...ALLOWED_HOSTS] };
