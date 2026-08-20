import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringsFor } from "@/visuals";

/**
 * Arayüz tek dil konuşur: İngilizce.
 *
 * Bu kural yorumda kalırsa tutmaz — Türkçe yazan biri bir düğme etiketini
 * kendi dilinde eklediğinde kimse fark etmez ve ürün yavaşça iki dile
 * bölünür. Test kaynak dosyalarını tarayarak kuralı zorunlu kılıyor.
 *
 * Kapsam yalnızca ARAYÜZ katmanı. Makale içeriği kapsam dışı — o projenin
 * kendi dilinde kalır.
 *
 * Dosya `src/lib` altında duruyor çünkü `src/visuals/**` tarayıcı paketine
 * giriyor ve orada `node:*` içe aktarımı eslint tarafından yasak.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const TURKISH = /[çğışöüÇĞİŞÖÜ]/;

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(join(root, directory));
  return entries.flatMap((entry) => {
    const relative = `${directory}/${entry}`;
    if (statSync(join(root, relative)).isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") ? [relative] : [];
  });
}

/** Yorumları düşürür; geriye yalnızca çalışan kod ve metin kalır. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("arayüz dili", () => {
  it("bileşenlerde Türkçe metin bırakmaz", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("src/components"), ...sourceFiles("src/visuals"), ...sourceFiles("viewer")]) {
      stripComments(readFileSync(join(root, file), "utf8"))
        .split("\n")
        .forEach((line, index) => {
          if (TURKISH.test(line)) offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("projenin dili yalnızca locale'i değiştirir, metni değil", () => {
    const turkish = stringsFor("tr");
    const english = stringsFor("en");
    expect(turkish.locale).toBe("tr");
    expect(english.locale).toBe("en");
    // Harf dönüşümü içerik diline uyar; etiketler aynı kalır.
    expect(turkish.library).toBe(english.library);
    expect(turkish.navPractice).toBe(english.navPractice);
  });
});
