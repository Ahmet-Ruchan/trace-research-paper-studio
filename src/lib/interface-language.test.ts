import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { stringsFor } from "@/visuals";

/**
 * Arayüz iki dil konuşuyor: İngilizce ve Türkçe (`src/i18n`).
 *
 * Bu kurallar yorumda kalırsa tutmaz: biri bir düğme etiketini doğrudan
 * bileşene yazdığında öbür dilde o düğme çevrilmemiş kalır ve kimse fark
 * etmez. Testler kaynak dosyaları tarayarak kuralları zorunlu kılıyor:
 *
 * - Türkçe metin yalnızca sözlüklerde (`src/i18n/messages/**`,
 *   `src/visuals/i18n.ts`); bileşende, rotada ya da kütüphane kodunda değil.
 * - Bileşenlerde ekrana çıkan sabit İngilizce metin yok: JSX metni ve
 *   erişilebilirlik öznitelikleri sözlükten geliyor.
 * - Stüdyo, görsellere (`stringsFor`, `LanguageProvider`) arayüzün dilini
 *   veriyor; vermezse etiketler makalenin diline düşerdi.
 *
 * Makale içeriği kapsam dışı — o projenin kendi dilinde kalıyor.
 *
 * Dosya `src/lib` altında duruyor çünkü `src/visuals/**` tarayıcı paketine
 * giriyor ve orada `node:*` içe aktarımı eslint tarafından yasak.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const TURKISH = /[çğışöüÇĞİŞÖÜ]/;

/**
 * Aksanlı harf taraması yetmiyor: "Ana sayfa", "Kapat", "Yeni paper" —
 * hiçbirinde Türkçe'ye özgü harf yok. Kelime sınırı şart: sınırsız "proje"
 * İngilizce "project" içinde eşleşirdi. Bu bir ağ, kanıt değil.
 */
const TURKISH_WORDS = new RegExp(
  String.raw`\b(sayfa|kaynak|kapat|ekle|yeni|eski|rapor|opsiyonel|statik|maks|ekip|ekibi|dosya|proje|hata|tamam|makale|deney|liste|arama|baslik|tek model|yorumu|arka plan)\b`,
  "i",
);

/** Türkçenin bilerek durduğu yerler: sözlükler ve harf eşlemeleri. */
const TURKISH_ALLOWED = [/^src\/i18n\/messages\//, /^src\/visuals\/i18n\.ts$/, /^src\/i18n\/glossary\.md$/];
const TURKISH_LINES_ALLOWED = [
  // Arama için İ/ı katlaması (`search-text.ts`) ve BibTeX harf eşlemesi (`reference-import.ts`).
  /\[İIıi\]/,
  /ss: "ß", o: "ø"/,
];

function sourceFiles(directory: string, extensions = /\.tsx?$/): string[] {
  const entries = readdirSync(join(root, directory));
  return entries.flatMap((entry) => {
    const relative = `${directory}/${entry}`;
    if (statSync(join(root, relative)).isDirectory()) return sourceFiles(relative, extensions);
    return extensions.test(entry) && !/\.test\.tsx?$/.test(entry) ? [relative] : [];
  });
}

/**
 * Yorumları düşürür; geriye yalnızca çalışan kod ve metin kalır. Blok
 * yorumlar satır sayısı korunarak siliniyor, hata mesajı doğru satırı
 * gösteriyor.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => "\n".repeat((comment.match(/\n/g) ?? []).length))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const UI_LAYER = ["src/components", "src/visuals", "src/app", "viewer"];

describe("arayüz dili", () => {
  it("Türkçe metin yalnızca sözlüklerde", () => {
    const offenders: string[] = [];
    const scanned = [...UI_LAYER, "src/lib", "src/i18n"].flatMap((directory) => sourceFiles(directory));
    for (const file of scanned) {
      if (TURKISH_ALLOWED.some((pattern) => pattern.test(file))) continue;
      stripComments(readFileSync(join(root, file), "utf8"))
        .split("\n")
        .forEach((line, index) => {
          if (TURKISH_LINES_ALLOWED.some((pattern) => pattern.test(line))) return;
          if (TURKISH.test(line) || (!file.startsWith("src/lib/") && TURKISH_WORDS.test(line))) {
            offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 80)}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * "s. 3" Türkçe "sayfa"nın kısaltması; İngilizcede "p.". İkisi de
   * sözlükten geliyor (`common.page`, `stringsFor(...).page`), bileşende
   * elle yazılmıyor.
   */
  it("sayfa numarasını elle kısaltmıyor", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("src/components"), ...sourceFiles("src/visuals"), ...sourceFiles("viewer")]) {
      if (TURKISH_ALLOWED.some((pattern) => pattern.test(file))) continue;
      stripComments(readFileSync(join(root, file), "utf8"))
        .split("\n")
        .forEach((line, index) => {
          if (/[`"'>](s|p)\. ?\$?\{/.test(line)) offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Bileşenlerde ekrana çıkan sabit İngilizce kalmasın: JSX metni, metin
   * taşıyan öznitelikler ve JSX içindeki dize sabitleri. Sözdizimi ağacından
   * okunuyor (TypeScript), düzenli ifade `a > b && c < d` gibi kodu metin
   * sanardı.
   *
   * Çevrilmeyen adlar (marka, biçim, tuş) ve yalnızca simge/sayı olan metin
   * serbest.
   */
  it("bileşenlerde sözlüğe uğramayan metin bırakmıyor", () => {
    const UNTRANSLATED = /\b(Trace|trace|arXiv|DOI|PDF|BibTeX|RIS|Zotero|Obsidian|Anki|MCP|API|JSON|Markdown|LaTeX|ICS|CSV|HTML|URL|OpenAI|Anthropic|Gemini|OpenRouter|Ollama|Claude|Codex|Antigravity|bib|Ctrl|Cmd|Shift|Alt|Enter|Esc|Tab|Space|EN|TR|OK|ID|AI|px|ms|vs)\b/g;
    const TEXT_ATTRIBUTES = new Set(["aria-label", "aria-description", "aria-valuetext", "aria-roledescription", "title", "placeholder", "alt", "label", "heading", "description", "hint", "caption", "summary"]);
    const words = (text: string) => /[A-Za-z]{2,}/.test(text.replace(UNTRANSLATED, ""));
    const offenders: string[] = [];
    const files = UI_LAYER.flatMap((directory) => sourceFiles(directory, /\.tsx$/));
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const report = (node: ts.Node, text: string) => {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        offenders.push(`${file}:${line + 1} ${text.trim().replace(/\s+/g, " ").slice(0, 80)}`);
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && words(node.text)) report(node, node.text);
        if (ts.isJsxAttribute(node) && node.initializer && TEXT_ATTRIBUTES.has(node.name.getText(source))) {
          const value = node.initializer;
          if (ts.isStringLiteral(value) && words(value.text)) report(node, `${node.name.getText(source)}="${value.text}"`);
        }
        // `{busy ? "Saving…" : "Save"}` gibi JSX içindeki dize sabitleri.
        if (ts.isJsxExpression(node) && node.expression) {
          const literals: ts.Node[] = [];
          const collect = (inner: ts.Node) => {
            if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) literals.push(inner);
            else if (ts.isConditionalExpression(inner) || ts.isBinaryExpression(inner) || ts.isParenthesizedExpression(inner)) ts.forEachChild(inner, collect);
          };
          collect(node.expression);
          const parent = node.parent;
          const insideTextAttribute = ts.isJsxAttribute(parent) && TEXT_ATTRIBUTES.has(parent.name.getText(source));
          const asChild = ts.isJsxElement(parent) || ts.isJsxFragment(parent);
          if (insideTextAttribute || asChild) {
            for (const literal of literals) {
              const text = (literal as ts.StringLiteral).text;
              if (/\s/.test(text.trim()) && words(text)) report(literal, text);
              else if (asChild && /^[A-Z][a-z]+$/.test(text) && words(text)) report(literal, text);
              else if (insideTextAttribute && words(text)) report(literal, text);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });

  it("stüdyo görsellere arayüzün dilini veriyor", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src/components")) {
      stripComments(readFileSync(join(root, file), "utf8"))
        .split("\n")
        .forEach((line, index) => {
          if (/\bstringsFor\([^,()]*(\([^()]*\))?[^,()]*\)/.test(line)) offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 80)}`);
          if (/<LanguageProvider\b/.test(line) && !/\bui=/.test(line)) offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Köprü de arayüzdür, ama ajanın: yardım metnini ve hatalarını doğrudan
   * kullanıcının ajanına yazıyor ve ajan okuyucuya kendi dilinde aktarıyor.
   * Orada tek dil İngilizce.
   */
  it("plugin köprüsü kullanıcıya Türkçe konuşmaz", () => {
    const bridge = "plugins/trace-paper-studio/skills/trace-paper-studio/scripts";
    const offenders: string[] = [];
    for (const file of [`${bridge}/trace-agent.mjs`, `${bridge}/trace-mcp.mjs`, `${bridge}/lib/paper-source.mjs`]) {
      stripComments(readFileSync(join(root, file), "utf8"))
        .split("\n")
        .forEach((line, index) => {
          if (TURKISH.test(line)) offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("içeriğin dili locale'i, arayüzün dili etiketleri belirliyor", () => {
    // Stüdyo: etiketler okuyucunun seçtiği dilde, locale makalenin dilinde.
    expect(stringsFor("tr", "en").locale).toBe("tr");
    expect(stringsFor("tr", "en").library).toBe(stringsFor("en", "en").library);
    expect(stringsFor("en", "tr").locale).toBe("en");
    expect(stringsFor("en", "tr").library).toBe(stringsFor("tr", "tr").library);
    expect(stringsFor("en", "tr").library).not.toBe(stringsFor("en", "en").library);
    // Stüdyonun dışında (görüntüleyici, yayın, dışa aktarım): etiketler içeriğin dilinde.
    expect(stringsFor("tr").library).toBe(stringsFor("tr", "tr").library);
    expect(stringsFor("tr-TR").library).toBe(stringsFor("tr", "tr").library);
    expect(stringsFor("de").library).toBe(stringsFor("en", "en").library);
    expect(stringsFor("de").locale).toBe("de");
    // Bozuk etiket Intl'e gitmiyor.
    expect(stringsFor("not a tag!").locale).toBe("en");
  });
});
