import { evaluateNode, parseFormula, type FormulaNode } from "./formula";
import type { Derivation, Interactive } from "./schema";
import { seededRandom, seededShuffle } from "./seeded";

/**
 * Önce tahmin et, sonra gör.
 *
 * Grafiği görmeden önce eğrinin ne yapacağını tahmin eden okuyucu, grafiği
 * doğrudan görenden daha çok hatırlıyor: yanılmak dikkat çekiyor, doğru
 * çıkmak modeli pekiştiriyor. Sorular model yazmıyor; oyun alanının kendi
 * formülü x ekseni boyunca taranarak cevap HESAPLANIYOR. Bu yüzden doğru
 * cevap tanım gereği doğru ve her oyun alanı (ajan yazmış olsa da) alıyor.
 *
 * Türetimde de aynı fikir: bir sonraki adım gösterilmeden önce okuyucu
 * adaylar arasından seçiyor. Adaylar aynı türetimin sonraki adımları; hepsi
 * doğru cümleler, yalnızca sırası yanlış. Soru "hangisi doğru" değil,
 * "hangisi buradan çıkar".
 */

export const curveShapes = ["rises", "falls", "flat", "peak", "valley"] as const;
export type CurveShape = (typeof curveShapes)[number];

type Playground = Extract<Interactive, { kind: "formula-playground" }>;

/** Bir değer dizisinin şekli; beş seçenekten biri değilse (dalgalı, çok az nokta) `undefined`. */
export function curveShape(values: readonly (number | null)[]): CurveShape | undefined {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length < 3 || finite.length < values.length / 2) return undefined;
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const scale = Math.max(Math.abs(low), Math.abs(high), 1e-12);
  // Yüzde birden az oynayan bir eğri gözle düz görünüyor.
  if (high - low <= 0.01 * scale) return "flat";
  const tolerance = (high - low) * 1e-6;
  let first = 0;
  let direction = 0;
  let turns = 0;
  for (let index = 1; index < finite.length; index += 1) {
    const step = finite[index] - finite[index - 1];
    if (Math.abs(step) <= tolerance) continue;
    const sign = Math.sign(step);
    if (!first) first = sign;
    else if (sign !== direction) turns += 1;
    direction = sign;
  }
  if (turns === 0) return first > 0 ? "rises" : "falls";
  if (turns === 1) return first > 0 ? "peak" : "valley";
  return undefined;
}

export type CurvePrediction = {
  id: string;
  kind: "shape";
  outputId: string;
  label: string;
  answer: CurveShape;
  start: number;
  end: number;
};

export type CrossPrediction = {
  id: "cross";
  kind: "cross";
  labels: [string, string];
  answer: boolean;
  /** Kesişiyorsa x ekseninde yaklaşık yeri. */
  at?: number;
};

export type PlaygroundPrediction = CurvePrediction | CrossPrediction;

export type PlaygroundPredictions = {
  xParam: string;
  xLabel: string;
  min: number;
  max: number;
  questions: PlaygroundPrediction[];
};

function compile(formula: string): FormulaNode | null {
  try {
    return parseFormula(formula);
  } catch {
    return null;
  }
}

function valueAt(node: FormulaNode | null, params: Record<string, number>) {
  if (!node) return null;
  try {
    const value = evaluateNode(node, params);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Grafikli bir oyun alanı için tahmin soruları: her serinin (en fazla iki)
 * şekli ve iki seri varsa kesişip kesişmedikleri. Diğer parametreler makale
 * değerlerinde; grafik açıldığında okuyucunun göreceği eğri tam olarak bu.
 */
export function playgroundPredictions(playground: Playground): PlaygroundPredictions | undefined {
  const chart = playground.chart;
  if (!chart) return undefined;
  const axis = playground.parameters.find((parameter) => parameter.name === chart.xParam);
  if (!axis || !(axis.max > axis.min)) return undefined;
  const paper = Object.fromEntries(playground.parameters.map((parameter) => [parameter.name, parameter.paperValue]));
  const samples = Math.max(8, Math.min(200, chart.samples));
  const xs = Array.from({ length: samples + 1 }, (_, index) => axis.min + ((axis.max - axis.min) * index) / samples);

  const series = chart.series.slice(0, 2).flatMap((entry) => {
    const output = playground.outputs.find((item) => item.id === entry.outputId);
    if (!output) return [];
    const node = compile(output.formula);
    const values = xs.map((x) => valueAt(node, { ...paper, [chart.xParam]: x }));
    return [{ entry, node, values }];
  });

  const questions: PlaygroundPrediction[] = [];
  for (const { entry, values } of series) {
    const answer = curveShape(values);
    const finite = values.filter((value): value is number => value !== null);
    if (!answer || !finite.length) continue;
    questions.push({ id: `shape:${entry.outputId}`, kind: "shape", outputId: entry.outputId, label: entry.label, answer, start: finite[0], end: finite[finite.length - 1] });
  }

  if (series.length === 2) {
    const [left, right] = series;
    const differences = xs.map((x, index) => {
      const a = left.values[index];
      const b = right.values[index];
      return a === null || b === null ? null : { x, difference: a - b, scale: Math.max(Math.abs(a), Math.abs(b), 1e-12) };
    });
    const known = differences.filter((item): item is NonNullable<typeof item> => item !== null);
    // Uçlarda birbirine değen eğriler için "kesişiyor mu" sorusu belirsiz; sorulmuyor.
    const touchesAtEnd = [known[0], known[known.length - 1]].some((item) => !item || Math.abs(item.difference) <= 1e-9 * item.scale);
    if (known.length >= 3 && !touchesAtEnd) {
      let at: number | undefined;
      for (let index = 1; index < known.length && at === undefined; index += 1) {
        const before = known[index - 1];
        const after = known[index];
        if (Math.sign(before.difference) !== Math.sign(after.difference)) {
          // Örnekler arasında ikiye bölerek inceltiliyor: "yaklaşık 511.6" değil "512".
          const gap = (x: number) => {
            const a = valueAt(left.node, { ...paper, [chart.xParam]: x });
            const b = valueAt(right.node, { ...paper, [chart.xParam]: x });
            return a === null || b === null ? null : a - b;
          };
          let low = before.x;
          let high = after.x;
          for (let round = 0; round < 60; round += 1) {
            const middle = (low + high) / 2;
            const value = gap(middle);
            if (value === null) break;
            if (Math.sign(value) === Math.sign(before.difference)) low = middle;
            else high = middle;
          }
          // Kaydırıcının kendi adımına yuvarlanıyor: okuyucu o değeri kaydırıcıda bulabilmeli.
          const step = axis.step > 0 ? axis.step : 1;
          at = Number((Math.round((low + high) / 2 / step) * step).toPrecision(12));
        }
      }
      questions.push({ id: "cross", kind: "cross", labels: [left.entry.label, right.entry.label], answer: at !== undefined, ...(at !== undefined ? { at } : {}) });
    }
  }

  if (!questions.length) return undefined;
  return { xParam: chart.xParam, xLabel: axis.label, min: axis.min, max: axis.max, questions };
}

export type StepChoice = { id: string; text: string; position: number };

/**
 * `shown` adım görünürken bir sonraki adımın adayları: gerçek sonraki adım ve
 * türetimin daha sonraki adımlarından en fazla ikisi, tohumlu bir sırayla.
 * Son adımda seçilecek bir şey kalmıyor; `undefined`.
 */
export function nextStepChoices(derivation: Derivation, shown: number): { correctId: string; options: StepChoice[] } | undefined {
  const next = derivation.steps[shown];
  if (!next) return undefined;
  const position = new Map(derivation.steps.map((step, index) => [step.id, index + 1]));
  const later = derivation.steps.slice(shown + 1).filter((step) => step.plain.trim() && step.plain.trim() !== next.plain.trim());
  if (!later.length) return undefined;
  const random = seededRandom(`${derivation.id}:${next.id}`);
  const distractors = seededShuffle(later, random).slice(0, 2);
  const options = seededShuffle([next, ...distractors], random).map((step) => ({ id: step.id, text: step.plain, position: position.get(step.id)! }));
  return { correctId: next.id, options };
}
