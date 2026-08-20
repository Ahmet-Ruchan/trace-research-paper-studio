import { useMemo, useState } from "react";
import type { Interactive } from "@/lib/schema";
import { evaluateNode, parseFormula, type FormulaNode } from "@/lib/formula";
import { extent, formatNumber, makeScale, toPath, ticks, type Point } from "../chart";

type Playground = Extract<Interactive, { kind: "formula-playground" }>;

/** Formüller bileşen ömrü boyunca bir kez ayrıştırılır; her karede değil. */
function useCompiled(playground: Playground) {
  return useMemo(() => {
    const compiled = new Map<string, FormulaNode | null>();
    for (const output of playground.outputs) {
      try {
        compiled.set(output.id, parseFormula(output.formula));
      } catch {
        compiled.set(output.id, null);
      }
    }
    return compiled;
  }, [playground]);
}

function evaluate(node: FormulaNode | null | undefined, params: Record<string, number>): number | null {
  if (!node) return null;
  try {
    const value = evaluateNode(node, params);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function PlaygroundView({ playground }: { playground: Playground }) {
  const compiled = useCompiled(playground);

  const paperPoint = useMemo(() => {
    const point: Record<string, number> = {};
    for (const parameter of playground.parameters) point[parameter.name] = parameter.paperValue;
    return point;
  }, [playground]);

  const [params, setParams] = useState<Record<string, number>>(paperPoint);

  const atPaperValues = playground.parameters.every(
    (parameter) => params[parameter.name] === parameter.paperValue,
  );

  const outputs = playground.outputs.map((output) => ({
    ...output,
    value: evaluate(compiled.get(output.id), params),
  }));

  return (
    <section className="interactive playground" aria-label={playground.title}>
      <header className="interactive-head">
        <div>
          <span className="interactive-kind">Oyun alanı</span>
          <h4>{playground.title}</h4>
          <p>{playground.description}</p>
        </div>
        <button
          type="button"
          className="interactive-reset"
          onClick={() => setParams(paperPoint)}
          disabled={atPaperValues}
        >
          Makale değerlerine dön
        </button>
      </header>

      <div className="playground-controls">
        {playground.parameters.map((parameter) => {
          const value = params[parameter.name];
          const offPaper = value !== parameter.paperValue;
          const paperOffset =
            ((parameter.paperValue - parameter.min) / (parameter.max - parameter.min)) * 100;
          return (
            <label className="playground-param" key={parameter.name}>
              <span className="param-head">
                <span className="param-label">{parameter.label}</span>
                <output className={offPaper ? "param-value is-off-paper" : "param-value"}>
                  {formatNumber(value)}
                  {parameter.unit ? ` ${parameter.unit}` : ""}
                </output>
              </span>
              <span className="param-track">
                <input
                  type="range"
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  value={value}
                  onChange={(event) =>
                    setParams((previous) => ({
                      ...previous,
                      [parameter.name]: Number(event.target.value),
                    }))
                  }
                />
                <span
                  className="param-paper-tick"
                  style={{ left: `${Math.min(Math.max(paperOffset, 0), 100)}%` }}
                  aria-hidden="true"
                />
              </span>
              <span className="param-scale">
                <small>{formatNumber(parameter.min)}</small>
                <small className="param-paper-note">
                  makale: {formatNumber(parameter.paperValue)}
                </small>
                <small>{formatNumber(parameter.max)}</small>
              </span>
            </label>
          );
        })}
      </div>

      <div className="playground-outputs">
        {outputs.map((output) => (
          <div className="playground-output" key={output.id}>
            <strong>{output.value === null ? "—" : formatNumber(output.value, output.precision)}</strong>
            <span>{output.label}</span>
            {output.unit ? <small>{output.unit}</small> : null}
            {output.value === null ? <em className="output-undefined">hesaplanamadı</em> : null}
          </div>
        ))}
      </div>

      {playground.chart ? (
        <PlaygroundChart playground={playground} compiled={compiled} params={params} />
      ) : null}

      <footer className="interactive-foot">
        <p className={atPaperValues ? "anchor-note is-anchored" : "anchor-note"}>
          {atPaperValues
            ? playground.paperAnchor
            : `Makale dışı bölgedesin — bu değerler makalede doğrulanmadı. ${playground.paperAnchor}`}
        </p>
      </footer>
    </section>
  );
}

function PlaygroundChart({
  playground,
  compiled,
  params,
}: {
  playground: Playground;
  compiled: Map<string, FormulaNode | null>;
  params: Record<string, number>;
}) {
  const chart = playground.chart!;
  const axis = playground.parameters.find((parameter) => parameter.name === chart.xParam);
  if (!axis) return null;

  const width = 520;
  const height = 220;
  const pad = { top: 14, right: 16, bottom: 30, left: 52 };

  const series = chart.series.map((entry) => {
    const node = compiled.get(entry.outputId);
    const points: Point[] = [];
    for (let index = 0; index <= chart.samples; index += 1) {
      const x = axis.min + ((axis.max - axis.min) * index) / chart.samples;
      const y = evaluate(node, { ...params, [chart.xParam]: x });
      points.push({ x, y: y ?? Number.NaN });
    }
    return { ...entry, points };
  });

  const xDomain: [number, number] = [axis.min, axis.max];
  const yDomain = extent(series.flatMap((entry) => entry.points.map((point) => point.y)));

  const sx = makeScale(xDomain, [pad.left, width - pad.right]);
  const sy = makeScale(yDomain, [height - pad.bottom, pad.top], chart.yScale);

  const paperX = sx(axis.paperValue);
  const currentX = sx(params[chart.xParam] ?? axis.paperValue);

  return (
    <figure className="playground-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${chart.xParam} eksenli grafik`}>
        {ticks(yDomain).map((tick) => (
          <g key={`y-${tick}`}>
            <line className="chart-grid" x1={pad.left} x2={width - pad.right} y1={sy(tick)} y2={sy(tick)} />
            <text className="chart-tick" x={pad.left - 7} y={sy(tick) + 3} textAnchor="end">
              {formatNumber(tick)}
            </text>
          </g>
        ))}
        {ticks(xDomain).map((tick) => (
          <text key={`x-${tick}`} className="chart-tick" x={sx(tick)} y={height - 10} textAnchor="middle">
            {formatNumber(tick)}
          </text>
        ))}

        {/* Makalenin doğruladığı nokta ile kullanıcının bulunduğu nokta ayrı işaretlenir. */}
        <line className="chart-paper-line" x1={paperX} x2={paperX} y1={pad.top} y2={height - pad.bottom} />
        <line className="chart-cursor" x1={currentX} x2={currentX} y1={pad.top} y2={height - pad.bottom} />

        {series.map((entry, index) => (
          <path key={entry.outputId} className={`chart-series series-${index}`} d={toPath(entry.points, sx, sy)} />
        ))}
      </svg>
      <figcaption>
        {series.map((entry, index) => (
          <span key={entry.outputId} className={`chart-key series-${index}`}>
            {entry.label}
          </span>
        ))}
        <span className="chart-key is-paper">makale değeri</span>
      </figcaption>
    </figure>
  );
}
