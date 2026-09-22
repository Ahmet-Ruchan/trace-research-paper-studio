import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { loadExampleProject } from "../example-fixture";
import { evaluateFormula, parseFormula } from "../formula";
import { buildBibtex, buildRis } from "./bibliography";
import { exportDefinitions, findExport } from "./index";
import { buildMarkdownReport } from "./markdown";
import { buildNotebook, formulaToNumpy, notebookPlaygrounds } from "./notebook";
import { buildPrintableReport } from "./print-html";
import { buildSlides, slideCount, slideLead } from "./slides";

const project = () => loadExampleProject("attention-is-all-you-need.en.trace.json");

/** Güvenilmeyen bir projenin metni hiçbir dışa aktarımda işaretlemeye dönüşmemeli. */
function hostile() {
  const value = project();
  value.evidence.paper.title = `Attack <script>alert(1)</script> | **bold** & "quotes"`;
  value.evidence.claims[0].statement = "# not a heading <img src=x onerror=alert(1)>";
  value.evidence.claims[0].sourceRefs[0].excerpt = "line one\nline two ``` fence";
  return value;
}

describe("report exports", () => {
  it("Markdown raporu her iddiayı alıntısı ve sayfasıyla taşır", () => {
    const value = project();
    const markdown = buildMarkdownReport(value);
    expect(markdown.startsWith("# Attention Is All You Need\n")).toBe(true);
    for (const claim of value.evidence.claims) expect(markdown).toContain(`\\[${claim.id}\\]`);
    expect(markdown).toMatch(/> “.+” — p\\?\. \d+/);
    expect(markdown).toContain("67 of 67 quotes were found");
    expect(markdown).toContain("| Measurement | Value | Context | Source |");
  });

  it("insan kararını ve bulunamayan alıntıyı rapora yazar", () => {
    const value = project();
    const claim = value.evidence.claims[0];
    value.claimReviews = { [claim.id]: { status: "rejected", by: "Ada", at: "2026-09-22T10:00:00.000Z", note: "Table 2 says otherwise." } };
    value.excerptCheck = { ...value.excerptCheck!, unlocated: [{ owner: "claim", id: claim.id, page: 2 }] };
    const markdown = buildMarkdownReport(value);
    expect(markdown).toContain("rejected by Ada");
    expect(markdown).toContain("quote not found on its page");
    expect(markdown).toContain("Reviewer's note: Table 2 says otherwise.");
  });

  it("proje metni Markdown'da ve HTML'de işaretlemeye dönüşmez", () => {
    const markdown = buildMarkdownReport(hostile());
    expect(markdown).toContain("\\<script\\>");
    expect(markdown).not.toMatch(/^# not a heading/m);
    expect(markdown).toContain("line one line two");

    for (const html of [buildPrintableReport(hostile()), buildSlides(hostile())]) {
      expect(html).not.toContain("<script>alert(1)");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
  });

  it("yazdırılabilir rapor betiksizdir ve denklemleri MathML olarak çizer", () => {
    const html = buildPrintableReport(project());
    expect(html).not.toContain("<script");
    expect(html).toContain("<math");
    expect(html).toContain("@page");
  });

  it("slayt destesi her hikâye bölümü için bir slayt üretir", () => {
    const value = project();
    const html = buildSlides(value);
    expect(html.match(/<section class="slide/g)).toHaveLength(slideCount(value));
    expect(html).toContain(value.story.sections[0].title);
    // Slaytta ilk iki cümle, tamamı notta: hiçbir şey atılmaz.
    const body = value.story.sections[0].body;
    expect(slideLead(body).lead.length).toBeLessThan(body.length);
    expect(html).toContain(`<aside class="notes">${body.slice(0, 40)}`);
    expect(slideLead("One sentence only.")).toEqual({ lead: "One sentence only.", hasMore: false });
    expect(slideLead("Accuracy is 28.4 BLEU. Second. Third.").lead).toBe("Accuracy is 28.4 BLEU. Second.");
    // Tek betik gezinme betiği; proje verisi içermez.
    expect(html.match(/<script>/g)).toHaveLength(1);
  });
});

describe("bibliography", () => {
  it("BibTeX ve RIS makaleyi, isteğe bağlı olarak ilgili çalışmaları yazar", () => {
    const related = [
      { title: "An Image is Worth 16x16 Words", authors: ["Alexey Dosovitskiy"], year: 2020, arxivId: "2010.11929" },
      { title: "Attention Is All You Need", authors: [], year: 2017 },
    ];
    const bibtex = buildBibtex(project(), related);
    expect(bibtex).toMatch(/^@article\{vaswani2017attention,/);
    expect(bibtex).toContain("title = {{Attention Is All You Need}}");
    expect(bibtex).toContain("@misc{dosovitskiy2020image,");
    expect(bibtex).toContain("eprint = {2010.11929}");
    // Aynı makale iki kez yazılmaz.
    expect(bibtex.match(/^@/gm)).toHaveLength(2);

    const ris = buildRis(project(), related);
    expect(ris).toContain("TY  - JOUR\r\nTI  - Attention Is All You Need\r\nAU  - Ashish Vaswani");
    expect(ris.match(/^ER {2}- $/gm)).toHaveLength(2);
  });

  it("BibTeX'in özel karakterlerini kaçırır", () => {
    const value = project();
    value.evidence.paper.title = "50% of {models} & their_cost";
    expect(buildBibtex(value)).toContain("title = {{50\\% of \\{models\\} \\& their\\_cost}}");
  });
});

describe("notebook", () => {
  it("formülü metinden değil ayrıştırılmış ağaçtan çevirir", () => {
    expect(formulaToNumpy(parseFormula("1 / sqrt(d_k)"))).toBe("(1 / np.sqrt(d_k))");
    expect(formulaToNumpy(parseFormula("2 ^ n % 3"))).toContain("np.fmod(");
    expect(formulaToNumpy(parseFormula("max(a, 0) + round(b)"))).toBe("(np.maximum.reduce(np.broadcast_arrays(a, 0)) + np.floor(b + 0.5))");
    // Python'da ayrılmış bir ad parametre olamaz.
    expect(formulaToNumpy(parseFormula("lambda * 2"))).toBe("(lambda_ * 2)");
    // Dilbilgisinin dışındaki hiçbir şey deftere ulaşamaz.
    expect(() => parseFormula("__import__('os').system('x')")).toThrow();
  });

  it("geçerli bir nbformat 4 defteri üretir", () => {
    const notebook = JSON.parse(buildNotebook(project())) as { nbformat: number; cells: Array<{ cell_type: string; source: string[] }> };
    expect(notebook.nbformat).toBe(4);
    expect(notebook.cells[1].source.join("")).toContain("import numpy as np");
    expect(notebook.cells.filter((cell) => cell.cell_type === "code").length).toBeGreaterThan(notebookPlaygrounds(project()).length);
  });

  const python = spawnSync("python3", ["-c", "import numpy"]);
  it.skipIf(python.status !== 0)("üretilen NumPy, stüdyonun hesapladığı değerin aynısını verir", () => {
    const value = project();
    const lines = ["import numpy as np, json", "out = {}"];
    const expected: Record<string, number> = {};
    for (const playground of notebookPlaygrounds(value)) {
      const params = Object.fromEntries(playground.parameters.map((parameter) => [parameter.name, parameter.paperValue]));
      for (const output of playground.outputs) {
        const key = `${playground.id}:${output.id}`;
        const result = evaluateFormula(output.formula, params);
        // Makalenin kendi değerlerinde her formül sonlu olmak zorunda; doğrulayıcı bunu zaten şart koşuyor.
        expect(result).not.toBeNull();
        expected[key] = result!;
        lines.push(`${playground.parameters.map((parameter) => `${parameter.name} = ${parameter.paperValue}`).join("; ")}`);
        lines.push(`out[${JSON.stringify(key)}] = float(${formulaToNumpy(parseFormula(output.formula))})`);
      }
    }
    lines.push("print(json.dumps(out))");
    const run = spawnSync("python3", ["-c", lines.join("\n")], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    const actual = JSON.parse(run.stdout) as Record<string, number>;
    expect(Object.keys(actual).length).toBeGreaterThan(0);
    for (const [key, number] of Object.entries(expected)) expect(actual[key]).toBeCloseTo(number, 9);
  });
});

describe("export table", () => {
  it("her biçim örnek projeden boş olmayan bir dosya üretir", () => {
    for (const definition of exportDefinitions) {
      expect(definition.unavailable?.(project())).toBeUndefined();
      expect(definition.build(project()).length).toBeGreaterThan(200);
    }
    expect(findExport("md")?.extension).toBe("md");
    expect(findExport("docx")).toBeUndefined();
  });

  it("üretilecek bir şey yoksa nedenini söyler", () => {
    const bare = project();
    bare.interactives = undefined;
    expect(findExport("ipynb")?.unavailable?.(bare)).toMatch(/no formula playground/);
  });
});
