import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEXT_SIZE_ATTRIBUTE, TEXT_SIZE_KEY, parseTextSize, textSizeBootScript, textSizes } from "./text-size";

/**
 * Yazı ölçeği.
 *
 * Stüdyo 7–11 px yazıyla dolmuştu: tek tek kurallar kendi px değerini
 * taşıyordu ve biri küçük bir etiket eklediğinde kimse fark etmiyordu. Artık
 * yazı boyutları `tokens.css` basamaklarından ya da rem'den geliyor ve 12 px
 * taban bir yorum değil, bir test.
 *
 * Dosya `src/lib` altında: `src/visuals/**` tarayıcı paketine giriyor ve orada
 * `node:*` içe aktarımı eslint tarafından yasak.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const STYLESHEETS = ["src/visuals/tokens.css", "src/app/globals.css", "src/visuals/styles.css", "src/visuals/learning.css", "viewer/shell.css"];
const FLOOR_PX = 12;
const ROOT_PX = 16;

/**
 * px kalabilen kurallar. SVG metni viewBox ile birlikte ölçekleniyor; rem ile
 * büyütmek diyagram etiketlerini üst üste bindirir. Glifler çizildikleri
 * sabit kutuyla birlikte kalıyor.
 */
const PX_ALLOWED = new Set([
  ".citation-node text",
  ".citation-center-label",
  ".map-spark text",
  ".chart-tick",
  ".library-select input:checked + span::after",
  ".viewer-brand i:after",
]);

type Declaration = { file: string; line: number; selector: string; size: string };

function fontSizes(file: string): Declaration[] {
  const source = readFileSync(join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const found: Declaration[] = [];
  for (const rule of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().replace(/^@media[^{]*$/, "").trim();
    for (const declaration of rule[2].matchAll(/(?:^|[;\s])(font-size|font)\s*:\s*([^;}]+)/g)) {
      const value = declaration[2].trim();
      // Kısa yazımda boyut, ilk uzunluk ya da ilk yazı ölçeği değişkeni.
      const size = declaration[1] === "font-size"
        ? value
        : value.match(/var\(--text-[\w-]+\)|clamp\([^)]*\)|(?<![\w.-])\d*\.?\d+(?:px|rem|em|%)/)?.[0];
      if (!size) continue;
      const line = source.slice(0, (rule.index ?? 0) + rule[1].length + (declaration.index ?? 0)).split("\n").length;
      found.push({ file, line, selector, size });
    }
  }
  return found;
}

function tokenValues() {
  const tokens = new Map<string, number>();
  const source = readFileSync(join(root, "src/visuals/tokens.css"), "utf8");
  for (const match of source.matchAll(/(--text-[\w-]+)\s*:\s*([\d.]+)rem/g)) tokens.set(match[1], Number(match[2]) * ROOT_PX);
  return tokens;
}

describe("type scale", () => {
  const tokens = tokenValues();
  const declarations = STYLESHEETS.flatMap(fontSizes);

  it("defines every step in rem, none below the floor", () => {
    expect([...tokens.keys()]).toEqual(["--text-2xs", "--text-xs", "--text-sm", "--text-md", "--text-base", "--text-lg", "--text-xl"]);
    for (const [name, px] of tokens) expect(px, name).toBeGreaterThanOrEqual(FLOOR_PX);
  });

  it("finds the font sizes it is guarding", () => {
    // Ayrıştırıcı bozulursa test boş bir listeyi onaylayıp geçerdi.
    expect(declarations.length).toBeGreaterThan(400);
    expect(declarations.filter((item) => item.size.startsWith("var(--text-")).length).toBeGreaterThan(300);
  });

  it("keeps every text at 12 px or more, using the scale", () => {
    const offenders: string[] = [];
    for (const { file, line, selector, size } of declarations) {
      const where = `${file}:${line} ${selector.slice(-60)} → ${size}`;
      const token = size.match(/^var\((--text-[\w-]+)\)/)?.[1];
      if (token) {
        if (!tokens.has(token)) offenders.push(`${where} (unknown step)`);
        continue;
      }
      const px = size.match(/^(\d*\.?\d+)px/);
      if (px) {
        // 0: dar ekranda düğme metnini gizleyip yalnızca simgeyi bırakma kalıbı.
        if (Number(px[1]) !== 0 && !PX_ALLOWED.has(selector)) offenders.push(`${where} (use the scale, not px)`);
        continue;
      }
      const rem = size.match(/^(\d*\.?\d+)rem/);
      if (rem && Number(rem[1]) * ROOT_PX < FLOOR_PX) offenders.push(`${where} (below ${FLOOR_PX}px)`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("text size choice", () => {
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

  it("has a root rule for every size except the default, with the same percentage", () => {
    for (const size of textSizes) {
      const rule = css.match(new RegExp(`html\\[${TEXT_SIZE_ATTRIBUTE}="${size.id}"\\]\\s*\\{\\s*font-size:\\s*([\\d.]+)%`));
      if (size.id === "default") expect(rule).toBeNull();
      else expect(Number(rule?.[1]), size.id).toBe(size.percent);
    }
  });

  it("reads only the sizes it knows", () => {
    expect(parseTextSize("large")).toBe("large");
    expect(parseTextSize("huge")).toBe("default");
    expect(parseTextSize(null)).toBe("default");
  });

  it("applies a stored choice before the page is drawn, and ignores anything else", () => {
    const run = (stored: string | null, storageThrows = false) => {
      const attributes = new Map<string, string>();
      const localStorage = { getItem: (key: string) => { if (storageThrows) throw new Error("blocked"); return key === TEXT_SIZE_KEY ? stored : null; } };
      const document = { documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) } };
      new Function("localStorage", "document", textSizeBootScript)(localStorage, document);
      return attributes.get(TEXT_SIZE_ATTRIBUTE);
    };
    expect(run("larger")).toBe("larger");
    expect(run("default")).toBeUndefined();
    expect(run("<script>")).toBeUndefined();
    expect(run(null)).toBeUndefined();
    expect(run("large", true)).toBeUndefined();
  });
});

/**
 * Vurgu renkleri metin olarak: makalenin rengi sarı ya da açık pembe olabiliyor
 * ve metinde okunmuyor. Metin rengi `--*-accent-ink` türevlerinden geliyor
 * (`tokens.css`); rengin kendisi yalnızca simgelerde, grafik işaretlerinde ve
 * büyük marka başlığında kalıyor.
 */
describe("accent colour as text", () => {
  const ALLOWED = [/(svg|circle)$/, /\.citation-center$/, /\.architecture-edges i$/, /\.implementation-notes li::before$/, /\.landing-copy h1 em$/, /\.quote-mark$/, /\.drop-zone \.upload-icon, \.drop-zone \.file-icon$/, /\.chart-key\.series-0$/];

  it("colours text with the readable tone, not the raw paper colour", () => {
    const offenders: string[] = [];
    for (const file of STYLESHEETS) {
      const source = readFileSync(join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim();
        if (/(?:^|;)\s*color\s*:\s*var\(--(?:card-|story-)?accent\)/.test(rule[2]) && !ALLOWED.some((pattern) => pattern.test(selector))) {
          offenders.push(`${file}: ${selector.slice(-70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("derives the readable tone for every accent that can change", () => {
    const tokens = readFileSync(join(root, "src/visuals/tokens.css"), "utf8");
    for (const name of ["accent", "card-accent", "story-accent"]) {
      expect(tokens).toMatch(new RegExp(`--${name}-ink:\\s*oklch\\(from var\\(--${name}\\) min\\(l, \\.5\\) c h\\)`));
    }
  });
});
