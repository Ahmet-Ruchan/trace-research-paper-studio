import { FormulaError, parseFormula, type FormulaNode } from "../formula";
import type { Interactive, ResearchProject } from "../schema";

/**
 * Makalenin denklemleri çalıştırılabilir bir Jupyter defteri olarak.
 *
 * Playground formülleri kısıtlı bir dilbilgisiyle AST'ye ayrıştırılıyor
 * (`formula.ts`). Defter o AST'den ÜRETİLİYOR — formül metni Python'a
 * yapıştırılmıyor. Böylece güvenilmeyen bir `.trace.json` deftere keyfi kod
 * sokamıyor: üretilen her ifade sayılar, bildirilmiş parametreler, dört işlem
 * ve sabit bir NumPy fonksiyon tablosundan oluşuyor.
 *
 * Çevrilemeyen bir formül tahmin edilmez; atlanır ve defter bunu söyler.
 */

type Playground = Extract<Interactive, { kind: "formula-playground" }>;

const NUMPY_CALLS: Record<string, (args: string[]) => string> = {
  abs: ([x]) => `np.abs(${x})`,
  sqrt: ([x]) => `np.sqrt(${x})`,
  exp: ([x]) => `np.exp(${x})`,
  ln: ([x]) => `np.log(${x})`,
  log2: ([x]) => `np.log2(${x})`,
  log10: ([x]) => `np.log10(${x})`,
  floor: ([x]) => `np.floor(${x})`,
  ceil: ([x]) => `np.ceil(${x})`,
  // JavaScript yarımları yukarı yuvarlar, NumPy çifte; stüdyodaki değerle aynı çıksın.
  round: ([x]) => `np.floor(${x} + 0.5)`,
  sign: ([x]) => `np.sign(${x})`,
  sin: ([x]) => `np.sin(${x})`,
  cos: ([x]) => `np.cos(${x})`,
  tan: ([x]) => `np.tan(${x})`,
  tanh: ([x]) => `np.tanh(${x})`,
  log: ([x, base]) => (base === undefined ? `np.log(${x})` : `(np.log(${x}) / np.log(${base}))`),
  pow: ([x, y]) => `np.power(${x}, ${y})`,
  // Tarama sırasında bir argüman dizi, diğerleri sayı olabiliyor; önce aynı biçime yayılırlar.
  min: (args) => (args.length === 1 ? args[0] : `np.minimum.reduce(np.broadcast_arrays(${args.join(", ")}))`),
  max: (args) => (args.length === 1 ? args[0] : `np.maximum.reduce(np.broadcast_arrays(${args.join(", ")}))`),
  clamp: ([x, lo, hi]) => `np.clip(${x}, ${lo}, ${hi})`,
  sigmoid: ([x]) => `(1 / (1 + np.exp(-(${x}))))`,
};

const PYTHON_KEYWORDS = new Set(["and", "as", "assert", "class", "def", "del", "for", "from", "global", "if", "import", "in", "is", "lambda", "not", "or", "pass", "print", "return", "try", "while", "with", "yield", "None", "True", "False", "np", "plt"]);

/** Parametre adı zaten `[A-Za-z_][A-Za-z0-9_]*`; yalnızca Python'da ayrılmış adlar değiştirilir. */
export const pythonName = (name: string) => (PYTHON_KEYWORDS.has(name) ? `${name}_` : name);

export function formulaToNumpy(node: FormulaNode): string {
  switch (node.kind) {
    case "number":
      if (!Number.isFinite(node.value)) throw new FormulaError("A non-finite constant cannot be written to the notebook");
      return node.value < 0 ? `(${String(node.value)})` : String(node.value);
    case "param":
      return pythonName(node.name);
    case "unary":
      return `(-${formulaToNumpy(node.operand)})`;
    case "binary": {
      const left = formulaToNumpy(node.left);
      const right = formulaToNumpy(node.right);
      if (node.op === "^") return `np.power(${left}, ${right})`;
      // JavaScript'te % işareti bölünenin işaretini korur; np.fmod da öyle, np.mod değil.
      if (node.op === "%") return `np.fmod(${left}, ${right})`;
      return `(${left} ${node.op} ${right})`;
    }
    case "call": {
      const translate = NUMPY_CALLS[node.name];
      if (!translate) throw new FormulaError(`The function "${node.name}" has no NumPy translation`);
      return translate(node.args.map(formulaToNumpy));
    }
  }
}

type Cell = { cell_type: "markdown" | "code"; source: string };

const pythonString = (value: string) => JSON.stringify(value.replace(/\s+/g, " ").trim());
const comment = (value: string) => value.replace(/\s+/g, " ").trim();

function playgroundCells(project: ResearchProject, playground: Playground): { cells: Cell[]; skipped: string[] } {
  const skipped: string[] = [];
  const quotes = playground.claimIds
    .map((id) => project.evidence.claims.find((claim) => claim.id === id))
    .filter((claim) => claim !== undefined)
    .map((claim) => `> “${claim.sourceRefs[0].excerpt.replace(/\s+/g, " ")}” — ${claim.sourceRefs[0].page ? `p. ${claim.sourceRefs[0].page}` : claim.sourceRefs[0].sourceId}`);

  const parameters = playground.parameters.map((parameter) => pythonName(parameter.name));
  const signature = parameters.join(", ");
  const functions: string[] = [];
  const outputs: Array<{ id: string; fn: string; label: string; unit?: string }> = [];
  playground.outputs.forEach((output, index) => {
    const fn = `output_${index + 1}`;
    try {
      const expression = formulaToNumpy(parseFormula(output.formula));
      functions.push(`def ${fn}(${signature}):\n    # ${comment(output.label)}${output.unit ? ` [${comment(output.unit)}]` : ""}\n    return ${expression}`);
      outputs.push({ id: output.id, fn, label: output.label, unit: output.unit });
    } catch (error) {
      skipped.push(`${playground.title} · ${output.label}: ${error instanceof Error ? error.message : "could not be translated"}`);
    }
  });
  if (!outputs.length) return { cells: [], skipped };

  const paper = `paper = {${playground.parameters.map((parameter) => `${pythonString(pythonName(parameter.name))}: ${parameter.paperValue}`).join(", ")}}`;
  const cells: Cell[] = [
    {
      cell_type: "markdown",
      source: [`## ${playground.title}`, "", playground.description, "", `*In the paper: ${playground.paperAnchor}*`, "", ...quotes].join("\n"),
    },
    {
      cell_type: "code",
      source: [
        "# The paper's own configuration",
        paper,
        "",
        ...functions.flatMap((fn) => [fn, ""]),
        ...outputs.map((output) => `print(${pythonString(output.label)}, "=", ${output.fn}(**paper)${output.unit ? `, ${pythonString(output.unit)}` : ""})`),
      ].join("\n"),
    },
  ];

  const chart = playground.chart;
  const axis = chart && playground.parameters.find((parameter) => parameter.name === chart.xParam);
  if (chart && axis) {
    const series = chart.series.map((item) => ({ item, output: outputs.find((output) => output.id === item.outputId) })).filter((entry) => entry.output);
    if (series.length) {
      const x = pythonName(axis.name);
      cells.push({
        cell_type: "code",
        source: [
          `# Sweep ${comment(axis.label)} over the range the playground uses; everything else stays at the paper's value.`,
          `${x}_values = np.linspace(${axis.min}, ${axis.max}, ${chart.samples})`,
          `sweep = {**paper, ${pythonString(x)}: ${x}_values}`,
          "fig, ax = plt.subplots(figsize=(7, 4))",
          ...series.map(({ item, output }) => `ax.plot(${x}_values, np.broadcast_to(${output!.fn}(**sweep), ${x}_values.shape), label=${pythonString(item.label)})`),
          `ax.axvline(paper[${pythonString(x)}], linestyle="--", linewidth=1, color="gray", label="paper's value")`,
          ...(chart.yScale === "log" ? ['ax.set_yscale("log")'] : []),
          `ax.set_xlabel(${pythonString(axis.label + (axis.unit ? ` [${axis.unit}]` : ""))})`,
          "ax.legend()",
          "plt.show()",
        ].join("\n"),
      });
    }
  }
  return { cells, skipped };
}

export function notebookPlaygrounds(project: ResearchProject): Playground[] {
  return (project.interactives ?? []).filter((item): item is Playground => item.kind === "formula-playground");
}

export function buildNotebook(project: ResearchProject): string {
  const playgrounds = notebookPlaygrounds(project);
  const built = playgrounds.map((playground) => playgroundCells(project, playground));
  const skipped = built.flatMap((item) => item.skipped);
  const { paper } = project.evidence;

  const cells: Cell[] = [
    {
      cell_type: "markdown",
      source: [
        `# ${paper.title}`,
        "",
        `${paper.authors.join(", ")} · ${paper.venue} · ${paper.year}`,
        "",
        "The equations below were generated by Trace from the paper's interactive playgrounds. Each one is translated from a parsed formula, not pasted as text, and starts at the value the paper itself uses. Moving away from that value leaves the region the paper verified.",
        ...(skipped.length ? ["", "**Left out because they could not be translated exactly:**", ...skipped.map((item) => `- ${item}`)] : []),
      ].join("\n"),
    },
    { cell_type: "code", source: "import numpy as np\nimport matplotlib.pyplot as plt" },
    ...built.flatMap((item) => item.cells),
  ];

  return `${JSON.stringify(
    {
      cells: cells.map((cell, position) => ({
        // nbformat 4.5 her hücre için bir kimlik istiyor; sıra numarası yeterli ve dosyayı tekrarlanabilir kılıyor.
        id: `trace-${position + 1}`,
        cell_type: cell.cell_type,
        metadata: {},
        // Jupyter satırları sonlarındaki "\n" ile bekler; son satır hariç.
        source: cell.source.split("\n").map((line, index, all) => (index < all.length - 1 ? `${line}\n` : line)),
        ...(cell.cell_type === "code" ? { execution_count: null, outputs: [] } : {}),
      })),
      metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python" } },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  )}\n`;
}
