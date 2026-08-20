import type { StoryVisual } from "@/lib/schema";

/**
 * Hikâye görselleri — TEK KAYNAK.
 *
 * Bu dosya hem Next uygulamasında (gerçek React) hem de plugin'in bağımsız
 * viewer paketinde (preact/compat) derlenir. Bu yüzden `src/visuals/**`
 * altında şunlar KULLANILAMAZ: `next/*`, `lucide-react`, `node:*`,
 * `react-dom/server`. Kural eslint ile zorlanır.
 */

type VisualRendererProps = {
  visual: StoryVisual;
  accent?: string;
  active?: boolean;
};

export function VisualRenderer({ visual, accent = "#e75b37", active = true }: VisualRendererProps) {
  return (
    <figure
      className={`visual-frame ${active ? "is-active" : ""}`}
      style={{ "--story-accent": accent } as React.CSSProperties}
    >
      <div className="visual-topline">
        <span>{visual.eyebrow}</span>
        <span className="visual-signal" aria-hidden="true" />
      </div>

      <div className="visual-canvas">
        {visual.type === "metric" && (
          <div className="metric-grid">
            {visual.items.map((item, index) => (
              <div className="metric-item" key={`${item.label}-${index}`}>
                <span className="metric-value">{item.value}</span>
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </div>
            ))}
          </div>
        )}

        {visual.type === "flow" && (
          <div className="flow-row">
            {visual.items.map((item, index) => (
              <div className="flow-step" key={`${item.label}-${index}`}>
                <span className="flow-index">{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
                {index < visual.items.length - 1 && <span className="flow-line" aria-hidden="true" />}
              </div>
            ))}
          </div>
        )}

        {visual.type === "comparison" && (
          <ComparisonVisual items={visual.items} active={active} />
        )}

        {visual.type === "concept" && (
          <div className="concept-map">
            <div className="concept-center">{visual.center}</div>
            {visual.items.map((item, index) => (
              <div className={`concept-node node-${index % 4}`} key={`${item.label}-${index}`}>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
            <svg viewBox="0 0 600 340" preserveAspectRatio="none" aria-hidden="true">
              <path d="M300 170 C210 130 160 80 80 70" />
              <path d="M300 170 C390 120 440 70 520 68" />
              <path d="M300 170 C210 220 160 275 80 282" />
              <path d="M300 170 C390 220 445 280 520 280" />
            </svg>
          </div>
        )}

        {visual.type === "layers" && (
          <div className="layer-stack">
            {visual.items.map((item, index) => (
              <div className={`layer-card tone-${item.tone}`} key={`${item.label}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        )}

        {visual.type === "quote" && (
          <div className="quote-visual">
            <span className="quote-mark" aria-hidden="true">∴</span>
            <blockquote>{visual.quote}</blockquote>
            <p>{visual.attribution}</p>
          </div>
        )}

        {visual.type === "architecture" && (
          <div className="architecture-visual">
            <div className="architecture-nodes">
              {visual.nodes.map((node) => (
                <div className={`architecture-node group-${node.group}`} key={node.id} tabIndex={0}>
                  <span>{node.group}</span><strong>{node.label}</strong><small>{node.detail}</small>
                </div>
              ))}
            </div>
            <div className="architecture-edges" aria-label="Mimari bağlantılar">
              {visual.edges.map((edge, index) => {
                const from = visual.nodes.find((node) => node.id === edge.from)?.label ?? edge.from;
                const to = visual.nodes.find((node) => node.id === edge.to)?.label ?? edge.to;
                return <span key={`${edge.from}-${edge.to}-${index}`}><b>{from}</b><i>→</i><em>{edge.label}</em><i>→</i><b>{to}</b></span>;
              })}
            </div>
          </div>
        )}

        {visual.type === "equation" && (
          <div className="equation-visual">
            <div className="equation-formula">{visual.formula}</div>
            <div className="equation-terms">{visual.terms.map((term) => <div key={term.symbol} tabIndex={0}><strong>{term.symbol}</strong><span>{term.label}</span><small>{term.detail}</small></div>)}</div>
            <ol>{visual.steps.map((step, index) => <li key={`${step}-${index}`}><span>{index + 1}</span>{step}</li>)}</ol>
          </div>
        )}

        {visual.type === "timeline" && (
          <div className="timeline-visual">
            {visual.items.map((item, index) => <div className={`tone-${item.tone}`} key={`${item.label}-${index}`} tabIndex={0}><i /><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.label}</strong><small>{item.detail}</small></div>)}
          </div>
        )}

        {visual.type === "matrix" && (
          <div className="matrix-visual" style={{ "--matrix-columns": visual.columns.length } as React.CSSProperties}>
            <div className="matrix-corner" />
            {visual.columns.map((column) => <strong className="matrix-column" key={column}>{column}</strong>)}
            {visual.rows.map((row) => <div className="matrix-row" key={row.label} style={{ gridColumn: `1 / span ${visual.columns.length + 1}` }}><strong>{row.label}</strong>{row.cells.map((cell, index) => <span className={`tone-${cell.tone}`} key={`${cell.label}-${index}`} tabIndex={0}>{cell.label}</span>)}</div>)}
          </div>
        )}

        {visual.type === "infographic" && (
          <div className="infographic-visual">
            {visual.items.map((item, index) => <article key={`${item.label}-${index}`} tabIndex={0}><span>{item.badge}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div></article>)}
          </div>
        )}
      </div>

      <figcaption>{visual.caption}</figcaption>
    </figure>
  );
}

type ComparisonItem = { label: string; value: number; displayValue: string; highlight: boolean };

/** Ölçek bir kez hesaplanır; eskiden her satırda yeniden türetiliyordu. */
function ComparisonVisual({ items, active }: { items: ComparisonItem[]; active: boolean }) {
  const max = Math.max(...items.map((entry) => entry.value), 1);
  return (
    <div className="comparison-list">
      {items.map((item, index) => (
        <div className="comparison-row" key={`${item.label}-${index}`}>
          <div className="comparison-label">
            <span>{item.label}</span>
            <strong>{item.displayValue}</strong>
          </div>
          <div className="comparison-track">
            <span
              className={item.highlight ? "highlight" : ""}
              style={{ width: active ? `${Math.max((item.value / max) * 100, 8)}%` : "0%" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
