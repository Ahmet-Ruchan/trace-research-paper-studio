import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFirstAvailablePdf,
  isAllowedUrl,
  isConfidentMatch,
  openAlexAbstract,
  openAlexArxivId,
  parseIdentifier,
  pdfFromArchive,
  pmcArchiveUrl,
  resolveDoi,
  resolveIdentifier,
  searchPapers,
} from "../../plugins/trace-paper-studio/skills/trace-paper-studio/scripts/lib/paper-source.mjs";
import {
  fetchCitationGraph,
  toGraphNode,
} from "../../plugins/trace-paper-studio/skills/trace-paper-studio/scripts/lib/citation-graph.mjs";

/**
 * Çözümleyici ağa gidiyor; testler gitmiyor. `fetch` adres önekine göre
 * cevap veren bir sahteyle değiştiriliyor ve beklenmeyen her adres testi
 * düşürüyor — izin listesinin dışına sessizce bir istek çıkamasın.
 */
type Route = { match: string; status?: number; type?: string; body: string | Buffer | object };

function mockFetch(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find((candidate) => url.startsWith(candidate.match));
    if (!route) throw new Error(`Unexpected request: ${url}`);
    const raw = typeof route.body === "string" || Buffer.isBuffer(route.body) ? route.body : JSON.stringify(route.body);
    return new Response(new Uint8Array(Buffer.from(raw)), {
      status: route.status ?? 200,
      headers: { "content-type": route.type ?? "application/json" },
    });
  });
  return calls;
}

const PDF = Buffer.from("%PDF-1.7 fake body");

/** Tek girdili, geçerli bir zip: yerel başlık + merkezi dizin + bitiş kaydı. */
function zipOf(name: string, content: Buffer) {
  const data = deflateRawSync(content);
  const fileName = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + fileName.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, fileName, data, central, fileName, end]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("parseIdentifier", () => {
  it.each([
    ["1706.03762", "arxiv", "1706.03762"],
    ["arXiv:1706.03762v5", "arxiv", "1706.03762"],
    ["https://arxiv.org/pdf/2006.11239v2.pdf", "arxiv", "2006.11239"],
    ["hep-th/9901001", "arxiv", "hep-th/9901001"],
    ["10.48550/arXiv.2106.09685", "arxiv", "2106.09685"],
    ["10.1038/s41586-021-03819-2", "doi", "10.1038/s41586-021-03819-2"],
    ["doi:10.1038/s41586-021-03819-2", "doi", "10.1038/s41586-021-03819-2"],
    ["https://doi.org/10.18653/v1/2020.acl-main.1", "doi", "10.18653/v1/2020.acl-main.1"],
    ["https://www.biorxiv.org/content/10.1101/2021.10.04.463034v2.full.pdf", "doi", "10.1101/2021.10.04.463034"],
    ["https://www.medrxiv.org/content/10.1101/2020.03.22.20040758v1", "doi", "10.1101/2020.03.22.20040758"],
    ["PMC7029158", "pmc", "PMC7029158"],
    ["https://pmc.ncbi.nlm.nih.gov/articles/PMC7029158/", "pmc", "PMC7029158"],
    ["2020.acl-main.1", "acl", "2020.acl-main.1"],
    ["https://aclanthology.org/P19-1001.pdf", "acl", "P19-1001"],
    ["https://openreview.net/forum?id=YicbFdNTTy", "openreview", "YicbFdNTTy"],
    ["Attention Is All You Need", "title", "Attention Is All You Need"],
  ])("%s → %s", (input, kind, id) => {
    expect(parseIdentifier(input)).toEqual({ kind, id });
  });

  it("tanımadığı bir sitenin bağlantısını başlık sanmaz, reddeder", () => {
    expect(() => parseIdentifier("https://www.nature.com/articles/s41586-021-03819-2")).toThrow(/not from a source/);
  });
});

describe("allowlist", () => {
  it("yayıncı sitelerine ve HTTP'ye izin vermez", () => {
    expect(isAllowedUrl("https://aclanthology.org/2020.acl-main.1.pdf")).toBe(true);
    expect(isAllowedUrl("https://www.nature.com/articles/x.pdf")).toBe(false);
    expect(isAllowedUrl("http://arxiv.org/pdf/1706.03762")).toBe(false);
    // Tarayıcı doğrulaması isteyen sayfa aday bile olmamalı.
    expect(isAllowedUrl("https://europepmc.org/articles/PMC7029158?pdf=render")).toBe(false);
  });
});

describe("OpenAlex helpers", () => {
  it("ters dizinden özeti kurar", () => {
    expect(openAlexAbstract({ abstract_inverted_index: { models: [1], Large: [0], work: [2, 4], hard: [3] } })).toBe(
      "Large models work hard work",
    );
    expect(openAlexAbstract({})).toBeUndefined();
  });

  it("arXiv kopyasının kimliğini bulur", () => {
    expect(openAlexArxivId({ locations: [{ landing_page_url: "https://arxiv.org/abs/2010.11929" }] })).toBe("2010.11929");
    expect(openAlexArxivId({ locations: [{ pdf_url: "https://example.org/a.pdf" }] })).toBeUndefined();
  });
});

describe("PubMed Central archive", () => {
  it("on binlik klasörü kimlikten hesaplar", () => {
    expect(pmcArchiveUrl("PMC7029158")).toBe("https://ftp.ebi.ac.uk/pub/databases/pmc/pdf/OA/PMCxxxx703/PMC7029158.zip");
    expect(pmcArchiveUrl("PMC7010000")).toContain("/PMCxxxx701/");
    expect(pmcArchiveUrl("nonsense")).toBeUndefined();
  });

  it("zip'in içinden PDF'i çıkarır, PDF yoksa reddeder", () => {
    expect(pdfFromArchive(zipOf("PMC1.pdf", PDF)).toString()).toBe(PDF.toString());
    expect(() => pdfFromArchive(zipOf("notes.txt", PDF))).toThrow(/does not contain a PDF/);
    expect(() => pdfFromArchive(Buffer.from("not a zip"))).toThrow(/not a valid zip/);
  });

  it("PMC kimliğini arşivden indirir", async () => {
    mockFetch([
      {
        match: "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
        body: { resultList: { result: [{ pmcid: "PMC7029158", title: "A study.", authorString: "Tang B, Wu J.", isOpenAccess: "Y", pubYear: "2020" }] } },
      },
      { match: "https://ftp.ebi.ac.uk/", type: "application/zip", body: zipOf("PMC7029158.pdf", PDF) },
    ]);
    const entry = await resolveIdentifier("PMC7029158");
    expect(entry).toMatchObject({ origin: "pmc", title: "A study", authors: ["Tang B", "Wu J"], pdfAvailable: true });
    const download = await fetchFirstAvailablePdf(entry);
    expect(download.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("resolveDoi", () => {
  it("bioRxiv DOI'sini son sürümün PDF'ine çevirir", async () => {
    mockFetch([
      {
        match: "https://api.biorxiv.org/details/biorxiv/",
        body: { collection: [{ version: "1", title: "Old" }, { version: "2", title: "Multimer", authors: "Evans, R.; O'Neill, M.", date: "2022-03-10", published: "NA" }] },
      },
      { match: "https://api.openalex.org/works/doi:", status: 404, body: {} },
      { match: "https://www.ebi.ac.uk/", body: { resultList: { result: [] } } },
    ]);
    const entry = await resolveDoi("10.1101/2021.10.04.463034");
    expect(entry).toMatchObject({ origin: "biorxiv", title: "Multimer", version: "2", authors: ["R. Evans", "M. O'Neill"] });
    expect(entry.pdfCandidates).toEqual(["https://www.biorxiv.org/content/10.1101/2021.10.04.463034v2.full.pdf"]);
  });

  it("yalnızca yayıncıda duran kopyayı indirmez ama kullanıcıya söyler", async () => {
    mockFetch([
      {
        match: "https://api.openalex.org/works/doi:",
        body: { id: "https://openalex.org/W1", title: "AlphaFold", best_oa_location: { pdf_url: "https://www.nature.com/articles/x.pdf" } },
      },
      { match: "https://www.ebi.ac.uk/", body: { resultList: { result: [] } } },
    ]);
    const entry = await resolveDoi("10.1038/s41586-021-03819-2");
    expect(entry.pdfAvailable).toBe(false);
    expect(entry.blockedPdfUrls).toEqual(["https://www.nature.com/articles/x.pdf"]);
    await expect(fetchFirstAvailablePdf(entry)).rejects.toThrow(/nature\.com[\s\S]*--paper/);
  });

  it("Unpaywall'a yalnızca e-posta tanımlıysa gider", async () => {
    const routes: Route[] = [
      { match: "https://api.openalex.org/works/doi:", body: { id: "https://openalex.org/W1", title: "Paper" } },
      { match: "https://www.ebi.ac.uk/", body: { resultList: { result: [] } } },
      { match: "https://api.unpaywall.org/", body: { best_oa_location: { url_for_pdf: "https://aclanthology.org/x.pdf" } } },
    ];
    let calls = mockFetch(routes);
    await resolveDoi("10.1000/example");
    expect(calls.some((url) => url.includes("unpaywall"))).toBe(false);

    vi.stubEnv("UNPAYWALL_EMAIL", "reader@example.org");
    calls = mockFetch(routes);
    const entry = await resolveDoi("10.1000/example");
    expect(calls.some((url) => url.includes("unpaywall") && url.includes("reader%40example.org"))).toBe(true);
    expect(entry.pdfCandidates).toEqual(["https://aclanthology.org/x.pdf"]);
  });
});

describe("fetchFirstAvailablePdf", () => {
  it("ilk aday başarısız olunca sıradakine geçer ve denemeyi bildirir", async () => {
    mockFetch([
      { match: "https://www.biorxiv.org/", status: 403, type: "text/html", body: "<html>Just a moment</html>" },
      { match: "https://arxiv.org/pdf/", type: "application/pdf", body: PDF },
    ]);
    const result = await fetchFirstAvailablePdf({
      title: "Paper",
      pdfCandidates: ["https://www.biorxiv.org/content/x.full.pdf", "https://arxiv.org/pdf/2101.00001"],
    });
    expect(result.url).toBe("https://arxiv.org/pdf/2101.00001");
    expect(result.attempts).toHaveLength(1);
  });

  it("PDF imzası taşımayan dosyayı kabul etmez", async () => {
    mockFetch([{ match: "https://arxiv.org/pdf/", type: "application/pdf", body: "<html>not a pdf</html>" }]);
    await expect(fetchFirstAvailablePdf({ title: "Paper", pdfCandidates: ["https://arxiv.org/pdf/1"] })).rejects.toThrow(
      /valid PDF signature/,
    );
  });
});

describe("OpenReview", () => {
  it("doğrulama istenince makaleyi OpenAlex'ten tanır ve arXiv kopyasına yönelir", async () => {
    mockFetch([
      { match: "https://api2.openreview.net", status: 403, body: { name: "ChallengeRequiredError" } },
      { match: "https://api.openreview.net", status: 403, body: { name: "ChallengeRequiredError" } },
      {
        match: "https://api.openalex.org/works?filter=locations.landing_page_url",
        body: { results: [{ id: "https://openalex.org/W7", title: "An Image is Worth 16x16 Words", locations: [{ landing_page_url: "https://arxiv.org/abs/2010.11929" }, { pdf_url: "https://openreview.net/pdf?id=YicbFdNTTy" }] }] },
      },
    ]);
    const entry = await resolveIdentifier("https://openreview.net/forum?id=YicbFdNTTy");
    expect(entry).toMatchObject({ origin: "openreview", title: "An Image is Worth 16x16 Words", arxivId: "2010.11929" });
    // OpenReview'ın kendi PDF'i doğrulamanın arkasında; aday olmaz.
    expect(entry.pdfCandidates).toEqual(["https://arxiv.org/pdf/2010.11929"]);
  });

  it("tarayıcı doğrulamasını aşmaya çalışmaz, ne yapılacağını söyler", async () => {
    mockFetch([
      { match: "https://api.openalex.org/", body: { results: [] } },
      { match: "https://api", status: 403, body: { name: "ChallengeRequiredError" } },
    ]);
    await expect(resolveIdentifier("openreview:YicbFdNTTy")).rejects.toThrow(/does not bypass[\s\S]*--paper/);
  });
});

describe("searchPapers", () => {
  const atom = (entries: Array<{ id: string; title: string }>) =>
    `<feed>${entries.map((entry) => `<entry><id>http://arxiv.org/abs/${entry.id}v1</id><title>${entry.title}</title></entry>`).join("")}</feed>`;

  it("arXiv eminse OpenAlex'e hiç gitmez", async () => {
    const calls = mockFetch([
      { match: "https://export.arxiv.org/", type: "application/atom+xml", body: atom([{ id: "1706.03762", title: "Attention Is All You Need" }, { id: "2501.00001", title: "Tensor Product Attention Is All You Need" }]) },
    ]);
    const results = await searchPapers("Attention Is All You Need");
    expect(results[0]).toMatchObject({ origin: "arxiv", arxivId: "1706.03762", matchScore: 1 });
    expect(calls.some((url) => url.includes("openalex"))).toBe(false);
  });

  it("arXiv emin değilse OpenAlex adaylarını ekler ve doğru olanı öne alır", async () => {
    mockFetch([
      { match: "https://export.arxiv.org/", type: "application/atom+xml", body: atom([{ id: "2201.00001", title: "A Survey of Protein Structure Prediction" }]) },
      {
        match: "https://api.openalex.org/works?",
        body: { results: [{ id: "https://openalex.org/W9", doi: "https://doi.org/10.1038/s41586-021-03819-2", title: "Highly accurate protein structure prediction with AlphaFold", cited_by_count: 30000 }] },
      },
    ]);
    const results = await searchPapers("Highly accurate protein structure prediction with AlphaFold");
    expect(results[0]).toMatchObject({ origin: "openalex", doi: "10.1038/s41586-021-03819-2", matchScore: 1, pdfAvailable: false });
    expect(isConfidentMatch(results)).toBe(true);
  });
});

describe("citation graph", () => {
  it("düğüme yeniden çözülebilir bir kimlik verir", () => {
    expect(toGraphNode({ id: "https://openalex.org/W1", title: "ViT", locations: [{ landing_page_url: "https://arxiv.org/abs/2010.11929" }] }))
      .toMatchObject({ openAlexId: "W1", identifier: "arxiv:2010.11929", pdfAvailable: true });
    expect(toGraphNode({ id: "https://openalex.org/W2", title: "ResNet", doi: "https://doi.org/10.1109/cvpr.2016.90" }))
      .toMatchObject({ identifier: "10.1109/cvpr.2016.90", pdfAvailable: false });
    expect(toGraphNode({ id: "https://openalex.org/W3", title: "Luong", doi: "https://doi.org/10.18653/v1/d15-1166" }).pdfAvailable).toBe(true);
  });

  it("başlıkla yalnızca birebir eşleşen kaydı kabul eder", async () => {
    mockFetch([
      { match: "https://api.openalex.org/works?filter=title.search", body: { results: [{ id: "https://openalex.org/W5", title: "LoRA Fine-Tuning of a 3B Code LLM", cited_by_count: 2516 }] } },
    ]);
    const graph = await fetchCitationGraph({ title: "LoRA: Low-Rank Adaptation of Large Language Models" });
    expect(graph).toMatchObject({ ok: false });
    expect(graph.skipped).toMatch(/could not be matched/);
  });

  it("iki yönü de en çok atıf alanlarla doldurur", async () => {
    mockFetch([
      { match: "https://api.openalex.org/works/doi:", body: { id: "https://openalex.org/W1", title: "Paper", cited_by_count: 40, referenced_works: ["https://openalex.org/W2", "https://openalex.org/W3"] } },
      { match: "https://api.openalex.org/works?filter=openalex", body: { results: [{ id: "https://openalex.org/W2", title: "Minor", cited_by_count: 3 }, { id: "https://openalex.org/W3", title: "Major", cited_by_count: 900 }] } },
      { match: "https://api.openalex.org/works?filter=cites", body: { results: [{ id: "https://openalex.org/W4", title: "Follow-up", cited_by_count: 12 }] } },
    ]);
    const graph = await fetchCitationGraph({ doi: "10.1000/example" });
    expect(graph.ok).toBe(true);
    expect(graph.references?.map((node: { title: string }) => node.title)).toEqual(["Major", "Minor"]);
    expect(graph.citedBy).toHaveLength(1);
    expect(graph.referenceCount).toBe(2);
  });

  it("ağ hatasında akışı düşürmez", async () => {
    mockFetch([{ match: "https://api.openalex.org/", status: 404, body: {} }]);
    expect(await fetchCitationGraph({ doi: "10.1000/missing" })).toMatchObject({ ok: false });
  });
});
