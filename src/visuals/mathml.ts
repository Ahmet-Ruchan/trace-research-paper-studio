import temml from "temml";

/**
 * LaTeX → MathML.
 *
 * MathML seçildi çünkü modern tarayıcılarda yerel olarak desteklenir ve font
 * ya da stil dosyası gerektirmez — plugin'in tek dosyalık bağımsız çıktısına
 * 1 MB'lık KaTeX fontu gömmek gerekmez.
 *
 * LaTeX güvenilmeyen `.trace.json`'dan gelir. temml düşman girdiyi her yolda
 * (hata yolu dahil) kaçırıyor; yine de çıktıyı bir izin listesinden geçiriyoruz
 * — ucuz sigorta.
 */

const MATHML_TAGS = new Set([
  "math", "annotation", "semantics", "merror", "mfrac", "mi", "mmultiscripts",
  "mn", "mo", "mover", "mpadded", "mphantom", "mprescripts", "mroot", "mrow",
  "ms", "mspace", "msqrt", "mstyle", "msub", "msubsup", "msup", "mtable",
  "mtd", "mtext", "mtr", "munder", "munderover",
]);

const MATHML_ATTRS = new Set([
  "accent", "accentunder", "columnalign", "columnspacing", "columnspan",
  "depth", "display", "displaystyle", "fence", "form", "height", "linethickness",
  "lspace", "mathbackground", "mathcolor", "mathsize", "mathvariant", "maxsize",
  "minsize", "movablelimits", "notation", "rowalign", "rowspacing", "rowspan",
  "rspace", "scriptlevel", "separator", "stretchy", "symmetric", "voffset",
  "width", "xmlns", "class", "style",
]);

/**
 * İzin listesinde olmayan her etiketi ve `on*` / `href` gibi her tehlikeli
 * özniteliği düşürür. DOM yoksa (sunucu tarafı render) kaba bir metin
 * denetimi yapıp şüpheli çıktıyı tamamen reddeder.
 */
export function sanitizeMathML(markup: string): string | null {
  if (typeof DOMParser === "undefined") {
    return /<\s*(script|iframe|object|embed|img|svg)\b/i.test(markup) || /\son\w+\s*=/i.test(markup)
      ? null
      : markup;
  }
  const parsed = new DOMParser().parseFromString(
    `<div xmlns="http://www.w3.org/1999/xhtml">${markup}</div>`,
    "text/html",
  );
  const root = parsed.body.firstElementChild;
  if (!root) return null;

  const walk = (element: Element): boolean => {
    const name = element.tagName.toLowerCase();
    if (!MATHML_TAGS.has(name)) return false;
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase();
      if (!MATHML_ATTRS.has(attributeName) || attributeName.startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
    }
    for (const child of [...element.children]) {
      if (!walk(child)) child.remove();
    }
    return true;
  };

  for (const child of [...root.children]) {
    if (!walk(child)) child.remove();
  }
  return root.innerHTML || null;
}

export function renderToMathML(latex: string, display: boolean): string | null {
  try {
    const markup = temml.renderToString(latex, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      annotate: false,
      strict: false,
    });
    if (markup.includes("temml-error")) return null;
    return sanitizeMathML(markup);
  } catch {
    return null;
  }
}
