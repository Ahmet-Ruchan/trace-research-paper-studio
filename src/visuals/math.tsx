import { renderToMathML } from "./mathml";

export { renderToMathML, sanitizeMathML } from "./mathml";

type MathTextProps = {
  /** LaTeX kaynağı. Yoksa `plain` düz metin olarak gösterilir. */
  latex?: string;
  /** Düz metin karşılığı — hem yedek hem ekran okuyucu etiketi. */
  plain?: string;
  display?: boolean;
};

/**
 * Görüntüleme sırası: LaTeX → MathML; başarısızsa düz metin. Öğrenme
 * katmanından önce üretilmiş projelerde `latex` alanı yoktur, dolayısıyla
 * her zaman düz metin yoluna düşer — hiçbir şey gerilemez.
 */
export function MathText({ latex, plain, display = false }: MathTextProps) {
  const fallback = plain ?? latex ?? "";
  const markup = latex ? renderToMathML(latex, display) : null;

  if (!markup) {
    return (
      <code className={display ? "math-plain is-display" : "math-plain"} aria-label={fallback}>
        {fallback}
      </code>
    );
  }

  return (
    <span
      className={display ? "math is-display" : "math"}
      role="math"
      aria-label={fallback || undefined}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
