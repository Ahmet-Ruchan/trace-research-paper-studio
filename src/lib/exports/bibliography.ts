import type { ResearchProject } from "../schema";

/**
 * Kaynakça — Zotero, Mendeley ve LaTeX için BibTeX ve RIS.
 *
 * İlk kayıt makalenin kendisi. Atıf grafiği verilirse (stüdyo onu OpenAlex'ten
 * çekmiş olabilir) oradaki çalışmalar da eklenir; bunlar projenin parçası
 * değil, o yüzden isteğe bağlı bir parametre olarak geliyor.
 */
export type BibliographyWork = {
  title: string;
  authors: string[];
  year?: string | number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
};

function paperEntry(project: ResearchProject): BibliographyWork {
  const { paper, sources } = project.evidence;
  const paperSource = sources.find((source) => source.type === "paper");
  return { title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, doi: paper.doi, url: paperSource?.url };
}

export function bibliographyWorks(project: ResearchProject, related: BibliographyWork[] = []): BibliographyWork[] {
  const seen = new Set<string>();
  return [paperEntry(project), ...related].filter((work) => {
    const key = (work.doi ?? work.arxivId ?? work.title).toLowerCase();
    if (!work.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const yearOf = (work: BibliographyWork) => /\b(1[89]\d{2}|20\d{2})\b/.exec(String(work.year ?? ""))?.[1];

/** BibTeX anahtarı: soyad + yıl + başlığın ilk anlamlı kelimesi; çakışırsa harf eklenir. */
function citeKeys(works: BibliographyWork[]) {
  const used = new Map<string, number>();
  const ascii = (value: string) => value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "").replace(/[^A-Za-z0-9]/g, "");
  return works.map((work) => {
    const surname = ascii((work.authors[0] ?? "anon").trim().split(/\s+/).pop() ?? "anon").toLowerCase() || "anon";
    const word = ascii(work.title.split(/\s+/).find((item) => item.length > 3) ?? "work").toLowerCase();
    const base = `${surname}${yearOf(work) ?? ""}${word}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count ? `${base}${String.fromCharCode(97 + count)}` : base;
  });
}

// BibTeX'te bu karakterler komut başlatır; başlığı bozmadan kaçırılır.
const tex = (value: string) => value.replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");

export function buildBibtex(project: ResearchProject, related: BibliographyWork[] = []): string {
  const works = bibliographyWorks(project, related);
  const keys = citeKeys(works);
  return `${works
    .map((work, index) => {
      const preprint = Boolean(work.arxivId) && !work.doi;
      const fields: Array<[string, string | undefined]> = [
        // Çift süslü parantez BibTeX stillerinin başlıktaki büyük harfleri küçültmesini engeller.
        ["title", `{${tex(work.title)}}`],
        ["author", work.authors.map(tex).join(" and ") || undefined],
        ["year", yearOf(work)],
        [preprint ? "howpublished" : "journal", preprint ? "arXiv preprint" : work.venue ? tex(work.venue) : undefined],
        ["doi", work.doi],
        ["eprint", work.arxivId],
        ["archiveprefix", work.arxivId ? "arXiv" : undefined],
        ["url", work.url ?? (work.doi ? `https://doi.org/${work.doi}` : work.arxivId ? `https://arxiv.org/abs/${work.arxivId}` : undefined)],
      ];
      const body = fields.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([name, value]) => `  ${name} = {${value}}`).join(",\n");
      return `@${preprint ? "misc" : "article"}{${keys[index]},\n${body}\n}`;
    })
    .join("\n\n")}\n`;
}

export function buildRis(project: ResearchProject, related: BibliographyWork[] = []): string {
  const line = (tag: string, value?: string) => (value ? `${tag}  - ${value.replace(/\r?\n/g, " ")}` : undefined);
  return `${bibliographyWorks(project, related)
    .map((work) =>
      [
        line("TY", work.arxivId && !work.doi ? "UNPB" : "JOUR"),
        line("TI", work.title),
        ...work.authors.map((author) => line("AU", author)),
        line("PY", yearOf(work)),
        line("JO", work.venue),
        line("DO", work.doi),
        line("UR", work.url ?? (work.doi ? `https://doi.org/${work.doi}` : work.arxivId ? `https://arxiv.org/abs/${work.arxivId}` : undefined)),
        "ER  - ",
      ]
        .filter(Boolean)
        .join("\r\n"),
    )
    .join("\r\n\r\n")}\r\n`;
}
