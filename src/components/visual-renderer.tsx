import type { StoryVisual } from "@/lib/schema";

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
          <div className="comparison-list">
            {visual.items.map((item, index) => {
              const max = Math.max(...visual.items.map((entry) => entry.value), 1);
              return (
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
              );
            })}
          </div>
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
      </div>

      <figcaption>{visual.caption}</figcaption>
    </figure>
  );
}

