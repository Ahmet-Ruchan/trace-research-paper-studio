import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { languageName, preferredLanguage } from "./preferred-language";
import { researchProjectSchema } from "./schema";
import { foldForSearch } from "./search-text";

/**
 * Analiz çıktısının dili kullanıcının yazdığı dildir.
 *
 * Bu testler gerçek bir şikâyetten doğdu: İngilizce yazan bir kullanıcı
 * Türkçe analiz aldı. Sebep tek bir yerde değildi — köprü `--language`
 * verilmediğinde sessizce "tr" seçiyordu VE beceri dosyası ajana açıkça
 * "kullanıcı bir şey demezse Türkçe kullan" diyordu. İkisi de yeniden
 * sızabilecek türden hatalar: hiçbir derleme, tip ya da lint kuralı
 * yanlış dilde üretilmiş bir metni fark edemez, çünkü teknik olarak her şey
 * geçerlidir. Tek bekçi bu dosya.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const SKILL_DIR = "plugins/trace-paper-studio/skills/trace-paper-studio";
const BRIDGE = join(root, SKILL_DIR, "scripts/trace-agent.mjs");

const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("çıktı dili", () => {
  it("köprü --language olmadan hiçbir dil varsaymaz", () => {
    const source = read(`${SKILL_DIR}/scripts/trace-agent.mjs`);
    // `args.language ?? "tr"` ve türevleri: sessiz varsayılanın kendisi.
    expect(source).not.toMatch(/args\.language\s*\?\?/);
  });

  it("köprü --language eksikken yüksek sesle durur", () => {
    const result = spawnSync(
      process.execPath,
      [BRIDGE, "prepare", "--arxiv", "1706.03762", "--depth", "concise"],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/--language is required/);
  });

  it("beceri ajana sabit bir dil seçtirmez", () => {
    const skill = read(`${SKILL_DIR}/SKILL.md`);
    // Eski metin: "Use Turkish, student, and deep when the user gives no options."
    expect(skill).not.toMatch(/Use Turkish[^.\n]*when the user gives no options/i);
    expect(skill).toMatch(/the language the user is writing to you in/i);
  });

  it("becerideki her prepare örneği --language taşır", () => {
    const examples = read(`${SKILL_DIR}/SKILL.md`)
      .split("\n")
      .filter((line) => line.includes("trace-agent.mjs prepare"));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) expect(example).toMatch(/--language [A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*\b/);
  });

  it("sözleşme metnin dilini bağlayıcı kılar ve alıntıları dışarıda tutar", () => {
    const contract = read(`${SKILL_DIR}/references/project-contract.md`);
    expect(contract).toMatch(/### Language/);
    expect(contract).toMatch(/Never translate one/i);
  });
});

describe("preferredLanguage", () => {
  it("kullanıcının dilini izler, sabit bir dil dayatmaz", () => {
    expect(preferredLanguage("tr")).toBe("tr");
    expect(preferredLanguage("de")).toBe("de");
    expect(preferredLanguage("ja")).toBe("ja");
  });

  it("bölge varyantını korur", () => {
    // "pt-BR" ile "pt-PT" aynı dil değil; etiketi kırpmak bu ayrımı yok eder.
    expect(preferredLanguage("pt-BR")).toBe("pt-BR");
    expect(preferredLanguage("en-GB")).toBe("en-GB");
  });

  it("ipucu yokken tarayıcıya sorar, yoksa İngilizce'ye düşer", () => {
    // İpucu boşsa geriye arayüzün dili kalır.
    expect(preferredLanguage("")).toBe("en");
    // Argümansız çağrı `navigator.language` okur (test ortamında tanımlı).
    // Değeri sabitlemiyoruz — makineye göre değişir; sözleşme, sonucun her
    // zaman `Intl`e verilebilir geçerli bir etiket olması.
    expect(preferredLanguage()).toMatch(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
    expect(() => new Intl.NumberFormat(preferredLanguage())).not.toThrow();
  });

  it("bozuk etiketi geçirmez", () => {
    // Değer `Intl`e gidiyor; geçersiz bir etiket orada RangeError fırlatır.
    expect(preferredLanguage("not a language")).toBe("en");
    expect(preferredLanguage("../../etc")).toBe("en");
  });
});

describe("dil tavanı", () => {
  /**
   * Şema uzun süre `z.enum(["tr", "en"])` idi ve ürünün gerçek sınırı buydu:
   * Trace kullanıcının dilinde yazabiliyor ama şema yalnızca iki dile izin
   * veriyordu. Enum geri gelirse bu sessizce kapanır — Almanca bir proje
   * "geçersiz" diye içe aktarılmaz ve kimse sebebini şemada aramaz.
   */
  it("şema iki dile geri kilitlenmez", () => {
    const parse = (language: unknown) =>
      researchProjectSchema.shape.language.safeParse(language).success;

    expect(parse("en")).toBe(true);
    expect(parse("tr")).toBe(true);
    expect(parse("de")).toBe(true);
    expect(parse("pt-BR")).toBe(true);
    expect(parse("zh-Hans")).toBe(true);
  });

  it("şema yine de geçerli bir etiket ister", () => {
    const parse = (language: unknown) =>
      researchProjectSchema.shape.language.safeParse(language).success;

    expect(parse("english please")).toBe(false);
    expect(parse("")).toBe(false);
    expect(parse(42)).toBe(false);
  });

  it("köprü dil listesi dayatmaz, yalnızca biçim denetler", () => {
    const run = (language: string) =>
      spawnSync(process.execPath, [BRIDGE, "prepare", "--arxiv", "1706.03762", "--language", language], {
        encoding: "utf8",
        timeout: 30_000,
      });

    // Biçimi bozuk: indirmeye gitmeden reddedilir.
    const invalid = run("not-a-tag!");
    expect(invalid.status).not.toBe(0);
    expect(`${invalid.stderr}${invalid.stdout}`).toMatch(/BCP-47/);
  });

  it("dilin adı prompt'a sabit tablodan değil Intl'den gelir", () => {
    // Sabit tablo { tr, en } idi; her yeni dil elle eklenmek zorundaydı.
    expect(languageName("de")).toBe("German");
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("pt-BR")).toMatch(/Portuguese/);
  });
});

describe("foldForSearch", () => {
  /**
   * `toLocaleLowerCase("tr")` ile "IMAGE" → "ımage" oluyor ve metindeki
   * "image" ile eşleşmiyordu: İngilizce yazan kullanıcı için arama sessizce
   * boş dönüyordu.
   */
  it("İngilizce büyük I aramasını bozmaz", () => {
    expect(foldForSearch("IMAGE")).toBe(foldForSearch("image"));
    expect(foldForSearch("Attention Is All You Need")).toContain("is all you need");
  });

  it("Türkçe noktalı/noktasız I'yı da eşitler", () => {
    expect(foldForSearch("İMGE")).toBe(foldForSearch("imge"));
    expect(foldForSearch("Işık")).toBe(foldForSearch("ışık"));
  });
});
