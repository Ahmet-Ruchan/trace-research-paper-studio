import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEXT_SIZE_ATTRIBUTE, TEXT_SIZE_KEY, parseTextSize, textSizeBootScript, textSizes } from "./text-size";
import { THEME_ATTRIBUTE, THEME_KEY, parseTheme, themeBootScript } from "./theme";

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
  const ALLOWED = [/(svg|circle)$/, /\.citation-center$/, /\.architecture-edges i$/, /\.implementation-notes li::before$/, /\.landing-copy h1 em$/, /\.quote-mark$/, /\.drop-zone \.upload-icon, \.drop-zone \.file-icon$/];

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

/**
 * Karanlık tema. Değerler `tokens.css` içinde iki kez yazılı ("Dark" ve
 * karanlık cihazda "System"); biri değişip öteki unutulursa iki seçim farklı
 * görünürdü. Metin / zemin çiftleri de burada ölçülüyor: bir jetonu
 * değiştiren, okunmaz bir çift bıraktığını testten öğreniyor.
 */
describe("colour themes", () => {
  const css = readFileSync(join(root, "src/visuals/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const body = (selector: string) => {
    const escaped = selector.replace(/[[\]"*:]/g, (character) => `\\${character}`).replace(/\s+/g, "\\s*");
    const found = css.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`));
    if (!found) throw new Error(`${selector} is missing from tokens.css`);
    return Object.fromEntries([...found[1].matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  };
  const light = body(":root");
  const dark = body(`html[data-theme="dark"]`);
  const system = body(`html[data-theme="system"]`);

  it("looks the same whether dark is chosen or comes from the device", () => {
    expect(Object.keys(dark).length).toBeGreaterThan(30);
    expect(system).toEqual(dark);
    const accentInk = (theme: string) => body(`html[data-theme="${theme}"] *, html[data-theme="${theme}"] ::before, html[data-theme="${theme}"] ::after`);
    expect(accentInk("system")).toEqual(accentInk("dark"));
    expect(Object.values(accentInk("dark")).every((value) => value.includes("max(l, .72)"))).toBe(true);
    expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*html\[data-theme="system"\]/);
  });

  it("gives every colour of the light theme a dark value, except the paper's own colour", () => {
    const colours = Object.entries(light).filter(([name, value]) => name !== "--accent" && /^(#|rgba?\()/.test(value)).map(([name]) => name);
    expect(colours.length).toBeGreaterThan(30);
    expect(colours.filter((name) => !(name in dark))).toEqual([]);
  });

  it("keeps every text and background pair readable in both themes", () => {
    const luminance = (hex: string) => [1, 3, 5]
      .map((start) => Number.parseInt((hex.length === 4 ? hex.replace(/\w/g, "$&$&") : hex).slice(start, start + 2), 16) / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (one: string, other: string) => {
      const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);
      return (high + 0.05) / (low + 0.05);
    };
    const pairs: Array<[string[], string[]]> = [
      [["--ink", "--ink-soft", "--muted", "--green", "--amber", "--danger", "--good-text", "--warn-text", "--notice-text", "--del-text", "--ins-text", "--done-text"], ["--paper", "--surface", "--surface-2", "--field"]],
      [["--on-ink", "--on-ink-accent"], ["--ink"]],
      [["--good-text"], ["--good-bg", "--good-bg-strong"]],
      [["--warn-text"], ["--warn-bg", "--warn-bg-strong"]],
      [["--notice-text"], ["--notice-bg"]],
      [["--danger", "--danger-strong"], ["--danger-bg", "--danger-bg-soft"]],
      [["--del-text"], ["--del-bg"]],
      [["--ins-text"], ["--ins-bg"]],
    ];
    const unreadable: string[] = [];
    for (const [name, theme] of [["light", light], ["dark", { ...light, ...dark }]] as const) {
      for (const [texts, grounds] of pairs) {
        for (const text of texts) {
          for (const ground of grounds) {
            const ratio = contrast(theme[text], theme[ground]);
            if (!(ratio >= 4.5)) unreadable.push(`${name}: ${text} on ${ground} is ${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
    expect(unreadable).toEqual([]);
  });

  it("reads only the themes it knows", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("sepia")).toBe("light");
    expect(parseTheme(null)).toBe("light");
  });

  it("applies a stored theme before the page is drawn, and ignores anything else", () => {
    const run = (stored: string | null, storageThrows = false) => {
      const attributes = new Map<string, string>();
      const localStorage = { getItem: (key: string) => { if (storageThrows) throw new Error("blocked"); return key === THEME_KEY ? stored : null; } };
      const document = { documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) } };
      new Function("localStorage", "document", themeBootScript)(localStorage, document);
      return attributes.get(THEME_ATTRIBUTE);
    };
    expect(run("dark")).toBe("dark");
    expect(run("system")).toBe("system");
    expect(run("light")).toBeUndefined();
    expect(run("\"><script>")).toBeUndefined();
    expect(run(null)).toBeUndefined();
    expect(run("dark", true)).toBeUndefined();
  });
});
