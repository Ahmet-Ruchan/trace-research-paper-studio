import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { readingItemSchema } from "./reading-list";
import { detectFormat, importPlan, latexToText, parseBibtex, parseCslJson, parseReferenceFile, parseRis, toReadingItem } from "./reference-import";

const at = "2026-10-01T10:00:00.000Z";

// Zotero'nun ve Better BibTeX'in yazdığı türden bir dosya.
const BIB = String.raw`
% Exported from Zotero
@string{acl = "Association for Computational Linguistics"}
@comment{jabref-meta: databaseType:bibtex;}

@article{vaswani_attention_2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and others},
  journal = {arXiv preprint arXiv:1706.03762},
  year = {2017},
  url = {http://arxiv.org/abs/1706.03762},
}

@inproceedings{ba2016,
  title = "Layer {N}ormalization",
  author = "Ba, Jimmy Lei and Kiros, Jamie Ryan and Hinton, Geoffrey E.",
  booktitle = acl # " Workshop",
  year = 2016,
  eprint = {1607.06450},
  archivePrefix = {arXiv},
}

@article{schrodinger,
  title = {{\"U}ber die {S}chr{\"o}dinger--Gleichung und {\c{C}}ay{\i}r {\&} Co.},
  author = {M{\"u}ller, J{\"o}rg and {Google Research}},
  journal = {Zeitschrift f\"ur Physik},
  year = {1926},
  month = mar,
  doi = {10.1007/BF01397280},
}

@misc{no_title, author = {Someone}, year = {2020}}

@book(knuth, title = {The {\TeX}book}, author = {Knuth, Donald E.}, publisher = {Addison-Wesley}, year = {1984})
`;

const RIS = `TY  - JOUR
TI  - Deep Residual Learning for Image Recognition
AU  - He, Kaiming
AU  - Zhang, Xiangyu
PY  - 2016/06/01
T2  - CVPR
DO  - 10.1109/CVPR.2016.90
UR  - https://doi.org/10.1109/CVPR.2016.90
ER  -

TY  - GEN
TI  - Language Models are Few-Shot Learners
AU  - Brown, Tom B.
DA  - 2020
UR  - https://arxiv.org/abs/2005.14165v4
ER  -
`;

const CSL = JSON.stringify([
  { id: "x1", type: "article", title: "BERT: Pre-training of Deep Bidirectional Transformers", author: [{ family: "Devlin", given: "Jacob" }, { literal: "Google AI Language" }], issued: { "date-parts": [["2018", 10, 11]] }, publisher: "arXiv", number: "arXiv:1810.04805", DOI: "10.48550/arXiv.1810.04805", URL: "http://arxiv.org/abs/1810.04805" },
  { id: "x2", type: "article-journal", title: "Dropout: A Simple Way to Prevent Neural Networks from Overfitting", author: [{ family: "Srivastava", given: "Nitish" }], issued: { "date-parts": [[2014]] }, "container-title": "Journal of Machine Learning Research" },
  { id: "x3", type: "webpage" },
]);

describe("importing references into the reading list", () => {
  it("turns LaTeX into plain text: accents, escapes, dashes and braces", () => {
    expect(latexToText(String.raw`{\"U}ber die {S}chr{\"o}dinger--Gleichung`)).toBe("Über die Schrödinger–Gleichung");
    expect(latexToText(String.raw`{\c{C}}ay{\i}r {\&} Co.~3---4 \'{e}t\'e \v{s} {\ss} \o`)).toBe("Çayır & Co. 3—4 été š ß ø");
    expect(latexToText(String.raw`The \emph{best} $O(n^2)$ result`)).toBe("The best O(n^2) result");
  });

  it("reads a Zotero BibTeX export: authors, venue, year, arXiv ids and DOIs, macros and both brackets", () => {
    const { works, skipped, format } = parseBibtex(BIB);
    expect(format).toBe("bibtex");
    expect(skipped).toBe(1);
    expect(works.map((work) => work.title)).toEqual([
      "Attention Is All You Need",
      "Layer Normalization",
      "Über die Schrödinger–Gleichung und Çayır & Co",
      "The book",
    ]);
    expect(works[0]).toMatchObject({ authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], year: 2017, arxiv: "1706.03762", url: "http://arxiv.org/abs/1706.03762" });
    expect(works[1]).toMatchObject({ authors: ["Jimmy Lei Ba", "Jamie Ryan Kiros", "Geoffrey E. Hinton"], venue: "Association for Computational Linguistics Workshop", year: 2016, arxiv: "1607.06450" });
    expect(works[2]).toMatchObject({ authors: ["Jörg Müller", "Google Research"], venue: "Zeitschrift für Physik", year: 1926, doi: "10.1007/BF01397280" });
    expect(works[2].arxiv).toBeUndefined();
    expect(works[3]).toMatchObject({ authors: ["Donald E. Knuth"], venue: "Addison-Wesley", year: 1984 });
  });

  it("reads RIS and Zotero's CSL JSON", () => {
    const ris = parseRis(RIS);
    expect(ris.works).toEqual([
      expect.objectContaining({ title: "Deep Residual Learning for Image Recognition", authors: ["Kaiming He", "Xiangyu Zhang"], year: 2016, venue: "CVPR", doi: "10.1109/CVPR.2016.90" }),
      expect.objectContaining({ title: "Language Models are Few-Shot Learners", year: 2020, arxiv: "2005.14165" }),
    ]);
    const csl = parseCslJson(CSL);
    expect(csl.skipped).toBe(1);
    expect(csl.works[0]).toMatchObject({ authors: ["Jacob Devlin", "Google AI Language"], year: 2018, arxiv: "1810.04805" });
    // arXiv'in kendi DOI'si arXiv kimliği sayılıyor, ayrıca DOI olarak değil.
    expect(csl.works[0].doi).toBeUndefined();
    expect(csl.works[1]).toMatchObject({ venue: "Journal of Machine Learning Research", year: 2014 });
  });

  it("knows the format from the name or the text, and says what it cannot read", () => {
    expect(detectFormat("my library.bib", "")).toBe("bibtex");
    expect(detectFormat("export.RIS", "")).toBe("ris");
    expect(detectFormat("zotero.json", "")).toBe("csl-json");
    expect(detectFormat("refs.txt", RIS)).toBe("ris");
    expect(detectFormat("refs.txt", BIB)).toBe("bibtex");
    expect(() => parseReferenceFile("notes.txt", "just some notes")).toThrow(/not a BibTeX, RIS or CSL JSON file/);
    expect(() => parseReferenceFile("broken.json", "[{")).toThrow("The CSL JSON file could not be read.");
  });

  it("plans the import: new works in order, none twice, none already on the list or in the library", () => {
    const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
    const { works } = parseBibtex(BIB);
    const onList = toReadingItem(works[1], at);
    const plan = importPlan([...works, works[3]], [onList], [example], at);
    expect(plan).toMatchObject({ onList: 1, inLibrary: 1, repeated: 1, overLimit: 0 });
    expect(plan.fresh.map((item) => item.id)).toEqual(["doi:10.1007/bf01397280", "title:the book"]);
    for (const item of plan.fresh) expect(readingItemSchema.safeParse(item).success).toBe(true);
    // arXiv kimliği ve bağlantısı; kaynak yok ("saved on its own").
    expect(toReadingItem(works[0], at)).toMatchObject({ id: "arxiv:1706.03762", identifier: "arxiv:1706.03762", from: [], addedAt: at });
    expect(toReadingItem(parseRis(RIS).works[0], at)).toMatchObject({ id: "doi:10.1109/cvpr.2016.90", url: "https://doi.org/10.1109/CVPR.2016.90" });
  });

  it("adds only what fits under the list's limit", () => {
    const works = Array.from({ length: 5 }, (_, index) => ({ title: `Work ${index}`, authors: [] }));
    const full = Array.from({ length: 497 }, (_, index) => toReadingItem({ title: `Saved ${index}`, authors: [] }, at));
    const plan = importPlan(works, full, [], at);
    expect(plan.fresh).toHaveLength(3);
    expect(plan.overLimit).toBe(2);
  });
});

describe("importing references from the agent bridge", () => {
  it("adds a .bib file's works to the studio's reading list, once, and says what it skipped", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const workspace = mkdtempSync(join(tmpdir(), "trace-reference-import-"));
    try {
      mkdirSync(join(workspace, "library"), { recursive: true });
      const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
      writeFileSync(join(workspace, "library", "attention.trace.json"), JSON.stringify(example));
      writeFileSync(join(workspace, "refs.bib"), BIB);
      writeFileSync(join(workspace, "notes.txt"), "not references");
      const bridge = (...args: string[]) => spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), ...args], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace, TRACE_LIBRARY_DIR: "" } });
      const first = bridge("reading", "--import", join(workspace, "refs.bib"));
      expect(first.status, first.stderr).toBe(0);
      const report = JSON.parse(first.stdout) as { imported: Record<string, unknown>; saved: number };
      // Attention kütüphanede; başlıksız kayıt atlanıyor.
      expect(report.imported).toMatchObject({ format: "BibTeX", found: 4, added: 3, inLibrary: 1, withoutTitle: 1 });
      expect(report.saved).toBe(3);
      const again = JSON.parse(bridge("reading", "--import", join(workspace, "refs.bib")).stdout) as { imported: Record<string, unknown>; saved: number };
      expect(again.imported).toMatchObject({ added: 0, alreadyOnList: 3 });
      expect(again.saved).toBe(3);
      const file = JSON.parse(readFileSync(join(workspace, "library", "reading-list.json"), "utf8")) as { items: Array<{ id: string }> };
      expect(file.items.map((item) => item.id)).toEqual(["arxiv:1607.06450", "doi:10.1007/bf01397280", "title:the book"]);
      const wrong = bridge("reading", "--import", join(workspace, "notes.txt"));
      expect(wrong.status).toBe(1);
      expect(wrong.stderr).toMatch(/not a BibTeX, RIS or CSL JSON file/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
