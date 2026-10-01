import { libraryPaperFor } from "./concept-links";
import { MAX_READING_ITEMS, workKey, type ReadingItem } from "./reading-list";
import type { ResearchProject } from "./schema";

/**
 * Zotero ya da bir .bib dosyasından okuma listesine.
 *
 * Zotero'da bir koleksiyon "Export Collection…" ile BibTeX, RIS ya da CSL JSON
 * olarak dışa aktarılıyor; Mendeley, EndNote ve LaTeX projeleri de bu
 * biçimlerden birini yazıyor. Burada üçü de okunuyor ve her kayıt okuma
 * listesinin bir çalışması oluyor: başlık, yazarlar, yıl, dergi, arXiv
 * kimliği ya da DOI, bağlantı. Listede ya da kütüphanede zaten olan iki kez
 * eklenmiyor. Ağ yok, model yok; dosya tarayıcıdan çıkmıyor.
 */

export type ImportFormat = "bibtex" | "ris" | "csl-json";
export type ImportedWork = { title: string; authors: string[]; year?: number; venue?: string; arxiv?: string; doi?: string; url?: string };
export type ParsedReferences = { format: ImportFormat; works: ImportedWork[]; skipped: number };

export const MAX_REFERENCE_FILE = 5 * 1024 * 1024;
export const MAX_REFERENCE_ENTRIES = 5000;

const FORMAT_LABELS: Record<ImportFormat, string> = { bibtex: "BibTeX", ris: "RIS", "csl-json": "CSL JSON" };
export const formatLabel = (format: ImportFormat) => FORMAT_LABELS[format];

/* ------------------------------ LaTeX metni ------------------------------ */

const ACCENTS: Record<string, string> = { '"': "̈", "'": "́", "`": "̀", "^": "̂", "~": "̃", "=": "̄", ".": "̇", u: "̆", v: "̌", H: "̋", c: "̧", k: "̨", r: "̊", d: "̣", b: "̱" };
const SYMBOLS: Record<string, string> = { ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "ı", j: "ȷ" };

/** BibTeX'in LaTeX'ini düz metne: aksanlar, kaçışlar, tireler, süslü parantezler. */
export function latexToText(value: string) {
  let text = value
    // {\"o}, \"{o}, \"o ve \c{c} gibi harf komutları.
    .replace(/\{?\\(["'`^~=.])\s*\{?\s*(\\?[A-Za-z])(?:\s*\})?\}?/g, (_match, accent: string, letter: string) => `${letter.replace("\\", "")}${ACCENTS[accent]}`)
    .replace(/\{?\\([uvHckrdb])\s*\{\s*(\\?[A-Za-z])\s*\}\}?/g, (_match, accent: string, letter: string) => `${letter.replace("\\", "")}${ACCENTS[accent]}`)
    .replace(/\{?\\([uvHckrdb])\s+([A-Za-z])\}?/g, (_match, accent: string, letter: string) => `${letter}${ACCENTS[accent]}`)
    .replace(/\{?\\(ss|ae|AE|oe|OE|aa|AA|[oOlLij])(?![A-Za-z])\s*(?:\{\})?\}?/g, (_match, name: string) => SYMBOLS[name] ?? name)
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\(?:textit|textbf|emph|textrm|textsc|textsf|texttt|mathrm|mathit|mathbf|mbox|text)\s*\{/g, "{")
    .replace(/\\[A-Za-z]+\s*/g, "")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/[{}]/g, "");
  text = text.normalize("NFC").replace(/\s+/g, " ").trim();
  return text;
}

/* ------------------------------ Kimlikler ------------------------------ */

const ARXIV_ID = /(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i;

/** arXiv kimliği: açık alan, arXiv DOI'si (10.48550/arXiv.…), bağlantı ya da "arXiv:…" yazısı. */
function arxivFrom(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const doi = value.match(/10\.48550\/arxiv\.(\S+)/i)?.[1];
    if (doi) return doi.replace(/v\d+$/i, "");
    const url = value.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:[?#]|$)/i)?.[1];
    if (url && ARXIV_ID.test(url)) return url.replace(/v\d+$/i, "");
    const named = value.match(new RegExp(`arxiv\\s*:?\\s*${ARXIV_ID.source}`, "i"))?.[1];
    if (named) return named;
  }
  return undefined;
}

function doiFrom(value: string | undefined) {
  const doi = value?.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").match(/^10\.\d{4,9}\/\S+$/)?.[0];
  return doi && !/^10\.48550\/arxiv/i.test(doi) ? doi : undefined;
}

function yearFrom(value: string | number | undefined) {
  const year = Number(String(value ?? "").match(/\b(1[5-9]\d\d|2\d\d\d)\b/)?.[1]);
  return Number.isFinite(year) && year >= 1000 && year <= 3000 ? year : undefined;
}

const webUrl = (value: string | undefined) => (value && /^https?:\/\/\S+$/i.test(value.trim()) ? value.trim() : undefined);

/** "Vaswani, Ashish" → "Ashish Vaswani"; "{Google Research}" olduğu gibi. */
function personName(raw: string) {
  const name = raw.trim();
  if (/^\{.*\}$/.test(name)) return latexToText(name);
  const parts = name.split(",").map((part) => part.trim()).filter(Boolean);
  const ordered = parts.length >= 2 ? `${parts.slice(1).join(" ")} ${parts[0]}` : name;
  return latexToText(ordered);
}

function work(fields: { title?: string; authors: string[]; year?: number; venue?: string; arxiv?: string; doi?: string; url?: string }): ImportedWork | undefined {
  const title = fields.title?.replace(/\s+/g, " ").replace(/\.$/, "").trim();
  if (!title) return undefined;
  const authors = fields.authors.map((author) => author.trim()).filter((author) => author && !/^others$/i.test(author));
  return {
    title: title.slice(0, 500),
    authors: authors.slice(0, 12).map((author) => author.slice(0, 200)),
    ...(fields.year ? { year: fields.year } : {}),
    ...(fields.venue?.trim() ? { venue: fields.venue.trim().slice(0, 300) } : {}),
    ...(fields.arxiv ? { arxiv: fields.arxiv } : {}),
    ...(fields.doi ? { doi: fields.doi } : {}),
    ...(fields.url ? { url: fields.url.slice(0, 2000) } : {}),
  };
}

/* ------------------------------ BibTeX ------------------------------ */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** `{…}` ya da `"…"` ile biten değerin sonu; iç içe süslü parantezler sayılıyor, `\{` kaçış. */
function readDelimited(text: string, start: number) {
  const quoted = text[start] === '"';
  let depth = quoted ? 0 : 1;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (!quoted && depth === 0) return { value: text.slice(start + 1, index), end: index + 1 };
    } else if (quoted && character === '"' && depth === 0) {
      return { value: text.slice(start + 1, index), end: index + 1 };
    }
  }
  return undefined;
}

function parseFields(body: string, strings: Map<string, string>) {
  const fields = new Map<string, string>();
  let index = 0;
  const skipSpace = () => {
    while (index < body.length && /[\s,]/.test(body[index])) index += 1;
  };
  while (index < body.length) {
    skipSpace();
    const name = body.slice(index).match(/^([A-Za-z][\w:.+-]*)\s*=\s*/);
    if (!name) {
      // Tanınmayan parça: bir sonraki virgüle atla.
      const next = body.indexOf(",", index);
      if (next === -1) break;
      index = next + 1;
      continue;
    }
    index += name[0].length;
    const parts: string[] = [];
    for (;;) {
      while (index < body.length && /\s/.test(body[index])) index += 1;
      const character = body[index];
      if (character === "{" || character === '"') {
        const value = readDelimited(body, index);
        if (!value) return fields;
        parts.push(value.value);
        index = value.end;
      } else {
        const bare = body.slice(index).match(/^[\w.:+-]+/)?.[0] ?? "";
        index += bare.length;
        const key = bare.toLowerCase();
        parts.push(strings.get(key) ?? (MONTHS.includes(key) ? String(MONTHS.indexOf(key) + 1) : bare));
      }
      while (index < body.length && /\s/.test(body[index])) index += 1;
      if (body[index] === "#") {
        index += 1;
        continue;
      }
      break;
    }
    fields.set(name[1].toLowerCase(), parts.join(""));
  }
  return fields;
}

export function parseBibtex(text: string): ParsedReferences {
  const strings = new Map<string, string>();
  const works: ImportedWork[] = [];
  let skipped = 0;
  let index = 0;
  while (works.length + skipped < MAX_REFERENCE_ENTRIES) {
    const at = text.indexOf("@", index);
    if (at === -1) break;
    const head = text.slice(at).match(/^@\s*([A-Za-z]+)\s*([{(])/);
    if (!head) {
      index = at + 1;
      continue;
    }
    const type = head[1].toLowerCase();
    const open = at + head[0].length - 1;
    // Girdi `(…)` ile de yazılabiliyor; kapanışı bulmak için süslü parantezle aynı sayım.
    const closeChar = head[2] === "{" ? "}" : ")";
    let depth = 0;
    let end = -1;
    for (let cursor = open + 1; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if (character === "\\") {
        cursor += 1;
        continue;
      }
      if (character === "{") depth += 1;
      else if (character === "}" && depth > 0) depth -= 1;
      else if (character === closeChar && depth === 0) {
        end = cursor;
        break;
      }
    }
    if (end === -1) break;
    const body = text.slice(open + 1, end);
    index = end + 1;
    if (type === "comment" || type === "preamble") continue;
    if (type === "string") {
      for (const [name, value] of parseFields(body, strings)) strings.set(name, value);
      continue;
    }
    const comma = body.indexOf(",");
    const fields = parseFields(comma === -1 ? "" : body.slice(comma + 1), strings);
    const plain = (name: string) => (fields.has(name) ? latexToText(fields.get(name)!) : undefined);
    const archive = `${fields.get("archiveprefix") ?? ""} ${fields.get("eprinttype") ?? ""}`;
    const entry = work({
      title: plain("title"),
      authors: (fields.get("author") ?? fields.get("editor") ?? "").split(/\s+and\s+/i).filter((name) => name.trim()).map(personName),
      year: yearFrom(fields.get("year") ?? fields.get("date")),
      venue: plain("journal") ?? plain("journaltitle") ?? plain("booktitle") ?? plain("publisher") ?? plain("school") ?? plain("institution"),
      arxiv: /arxiv/i.test(archive) && fields.get("eprint") ? arxivFrom(`arXiv:${fields.get("eprint")}`) : arxivFrom(fields.get("doi"), fields.get("url"), fields.get("journal"), fields.get("note"), fields.get("eprint") && /^\d{4}\.\d{4,5}/.test(fields.get("eprint")!) ? `arXiv:${fields.get("eprint")}` : undefined),
      doi: doiFrom(fields.get("doi")),
      url: webUrl(fields.get("url")),
    });
    if (entry) works.push(entry);
    else skipped += 1;
  }
  return { format: "bibtex", works, skipped };
}

/* ------------------------------ RIS ------------------------------ */

export function parseRis(text: string): ParsedReferences {
  const works: ImportedWork[] = [];
  let skipped = 0;
  let record = new Map<string, string[]>();
  const finish = () => {
    if (!record.size) return;
    const first = (...tags: string[]) => tags.map((tag) => record.get(tag)?.[0]).find((value) => value?.trim());
    const urls = [...(record.get("UR") ?? []), ...(record.get("L1") ?? []), ...(record.get("L2") ?? [])];
    const entry = work({
      title: first("TI", "T1", "CT"),
      authors: [...(record.get("AU") ?? []), ...(record.get("A1") ?? [])].map(personName),
      year: yearFrom(first("PY", "Y1", "DA")),
      venue: first("JO", "JF", "T2", "BT", "JA", "PB"),
      arxiv: arxivFrom(first("DO"), ...urls, first("JO", "JF", "T2"), first("M3"), first("AN")),
      doi: doiFrom(first("DO")),
      url: webUrl(urls[0]),
    });
    if (entry) works.push(entry);
    else skipped += 1;
    record = new Map();
  };
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9])  -\s?(.*)$/);
    if (!match) continue;
    const [, tag, value] = match;
    if (tag === "TY") {
      finish();
      record.set("TY", [value]);
    } else if (tag === "ER") finish();
    else record.set(tag, [...(record.get(tag) ?? []), value.trim()]);
    if (works.length + skipped >= MAX_REFERENCE_ENTRIES) break;
  }
  finish();
  return { format: "ris", works, skipped };
}

/* ------------------------------ CSL JSON ------------------------------ */

type CslName = { family?: string; given?: string; literal?: string };
type CslItem = { title?: unknown; author?: unknown; editor?: unknown; issued?: { "date-parts"?: unknown[][]; raw?: string; literal?: string }; "container-title"?: unknown; publisher?: unknown; DOI?: unknown; URL?: unknown; number?: unknown; archive?: unknown; "archive_location"?: unknown };

const str = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined);

export function parseCslJson(text: string): ParsedReferences {
  const raw = JSON.parse(text) as unknown;
  const items = (Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : []) as CslItem[];
  const works: ImportedWork[] = [];
  let skipped = 0;
  for (const item of items.slice(0, MAX_REFERENCE_ENTRIES)) {
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const names = (Array.isArray(item.author) ? item.author : Array.isArray(item.editor) ? item.editor : []) as CslName[];
    const issued = item.issued?.["date-parts"]?.[0]?.[0] ?? item.issued?.raw ?? item.issued?.literal;
    const entry = work({
      title: str(item.title),
      authors: names.map((name) => (name.literal ?? [name.given, name.family].filter(Boolean).join(" ")).trim()),
      year: yearFrom(issued as string | number | undefined),
      venue: str(item["container-title"]) ?? str(item.publisher),
      arxiv: arxivFrom(str(item.DOI), str(item.URL), str(item.number), str(item.archive_location), /arxiv/i.test(`${str(item.publisher) ?? ""} ${str(item.archive) ?? ""}`) ? `arXiv:${str(item.number) ?? ""}` : undefined),
      doi: doiFrom(str(item.DOI)),
      url: webUrl(str(item.URL)),
    });
    if (entry) works.push(entry);
    else skipped += 1;
  }
  return { format: "csl-json", works, skipped };
}

/* ------------------------------ Dosya ------------------------------ */

export function detectFormat(name: string, text: string): ImportFormat | undefined {
  const extension = name.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (extension === "bib" || extension === "bibtex") return "bibtex";
  if (extension === "ris") return "ris";
  if (extension === "json") return "csl-json";
  const start = text.trimStart();
  if (start.startsWith("[") || start.startsWith("{")) return "csl-json";
  if (/^TY {2}-/m.test(text)) return "ris";
  if (/@\s*[A-Za-z]+\s*[{(]/.test(text)) return "bibtex";
  return undefined;
}

export function parseReferenceFile(name: string, text: string): ParsedReferences {
  if (text.length > MAX_REFERENCE_FILE) throw new Error("The file is larger than 5 MB.");
  const format = detectFormat(name, text);
  if (!format) throw new Error("This is not a BibTeX, RIS or CSL JSON file. In Zotero, use Export Collection… and choose one of those formats.");
  try {
    if (format === "bibtex") return parseBibtex(text);
    if (format === "ris") return parseRis(text);
    return parseCslJson(text);
  } catch {
    throw new Error(`The ${FORMAT_LABELS[format]} file could not be read.`);
  }
}

/** Okuma listesinin kaydı: kimlik arXiv varsa arXiv, yoksa DOI; ikisi de yoksa başlıktan. */
export function toReadingItem(imported: ImportedWork, addedAt: string): ReadingItem {
  const identifier = imported.arxiv ? `arxiv:${imported.arxiv}` : imported.doi;
  const url = imported.url ?? (imported.arxiv ? `https://arxiv.org/abs/${imported.arxiv}` : imported.doi ? `https://doi.org/${imported.doi}` : undefined);
  return {
    id: workKey({ title: imported.title, identifier, doi: imported.doi }),
    title: imported.title,
    authors: imported.authors,
    ...(imported.year ? { year: imported.year } : {}),
    ...(imported.venue ? { venue: imported.venue } : {}),
    ...(identifier ? { identifier } : {}),
    ...(url ? { url } : {}),
    from: [],
    addedAt,
  };
}

export type ImportPlan = {
  /** Eklenecekler, dosyadaki sırayla. */
  fresh: ReadingItem[];
  /** Zaten listede olanlar. */
  onList: number;
  /** Kütüphanede analiz edilmiş olanlar. */
  inLibrary: number;
  /** Dosyada iki kez geçenler. */
  repeated: number;
  /** Listede yer kalmadığı için eklenemeyenler. */
  overLimit: number;
};

export function importPlan(works: readonly ImportedWork[], list: readonly ReadingItem[], library: readonly ResearchProject[], addedAt: string): ImportPlan {
  const listed = new Set(list.map((item) => item.id));
  const seen = new Set<string>();
  const fresh: ReadingItem[] = [];
  let onList = 0;
  let inLibrary = 0;
  let repeated = 0;
  let overLimit = 0;
  const room = Math.max(0, MAX_READING_ITEMS - list.length);
  for (const imported of works) {
    const item = toReadingItem(imported, addedAt);
    if (seen.has(item.id)) {
      repeated += 1;
      continue;
    }
    seen.add(item.id);
    if (listed.has(item.id)) onList += 1;
    else if (libraryPaperFor({ title: item.title, identifier: imported.doi }, library)) inLibrary += 1;
    else if (fresh.length >= room) overLimit += 1;
    else fresh.push(item);
  }
  return { fresh, onList, inLibrary, repeated, overLimit };
}
