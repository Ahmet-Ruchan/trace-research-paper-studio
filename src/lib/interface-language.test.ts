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

/**
 * Aksanlı harf taraması yetmiyor: "Ana sayfa", "Statik export", "Kapat",
 * "Yeni paper", "Tek model", "Model ekibi" — hiçbirinde Türkçe'ye özgü harf
 * yok, bu yüzden aylarca arayüzde fark edilmeden durdular. Bu liste onları da
 * yakalıyor.
 *
 * İki uyarı:
 * - Kelime sınırı şart: sınırsız "proje" İngilizce "project" içinde eşleşirdi.
 * - Türkçe eklemeli bir dil, yani sondaki sınır çekimli biçimleri kaçırıyor
 *   ("ekip" ✓, "ekibi" ✗). Görülen çekimler listeye ayrıca yazılıyor.
 *
 * Bu bir ağ, kanıt değil: yeni bir Türkçe etiket listede yoksa geçer. Tam
 * tarama için `scan-ui-text.mjs` benzeri bir döküm gerekir.
 */
const TURKISH_WORDS = new RegExp(
  String.raw`\b(sayfa|kaynak|kapat|ekle|yeni|eski|rapor|opsiyonel|statik|maks|ekip|ekibi|dosya|proje|hata|tamam|makale|deney|liste|arama|baslik|tek model|yorumu|arka plan)\b`,
  "i",
);

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(join(root, directory));
  return entries.flatMap((entry) => {
    const relative = `${directory}/${entry}`;
    if (statSync(join(root, relative)).isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") ? [relative] : [];
  });
}

/**
 * Yorumları düşürür; geriye yalnızca çalışan kod ve metin kalır.
 *
 * Blok yorumlar satır sayısı korunarak siliniyor: düz silme, çok satırlı bir
 * yorumdan sonraki her satırın numarasını kaydırıyor ve hata mesajı yanlış
 * satırı gösteriyordu.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => "\n".repeat((comment.match(/\n/g) ?? []).length))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("arayüz dili", () => {
  it("bileşenlerde Türkçe metin bırakmaz", () => {
    const offenders: string[] = [];
    // `src/app` da kapsamda: rota katmanı ilerleme ve hata metinlerini
    // doğrudan ekrana yazıyor, yani orası da arayüz.
    const scanned = [
      ...sourceFiles("src/components"),
      ...sourceFiles("src/visuals"),
      ...sourceFiles("src/app"),
      ...sourceFiles("viewer"),
    ];
    for (const file of scanned) {
      stripComments(readFileSync(join(root, file), "utf8"))
        .split("\n")
        .forEach((line, index) => {
          if (TURKISH.test(line) || TURKISH_WORDS.test(line)) {
            offenders.push(`${file}:${index + 1} ${line.trim().slice(0, 80)}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Köprü de arayüzdür. Yardım metnini ve hatalarını doğrudan kullanıcının
   * ajanına yazıyor; plugin'i kuran herkes İngilizce konuşmuyor olabilir ama
   * hepsi İngilizce'yi okuyabiliyor. Türkçe bir hata mesajı, okuyamadığı bir
   * duvarla karşılaşan kullanıcı demek.
   */
  it("plugin köprüsü kullanıcıya Türkçe konuşmaz", () => {
    const bridge = "plugins/trace-paper-studio/skills/trace-paper-studio/scripts";
    const offenders: string[] = [];
    for (const file of [`${bridge}/trace-agent.mjs`, `${bridge}/lib/paper-source.mjs`]) {
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
