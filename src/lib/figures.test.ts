import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { validateLearningIntegrity } from "./generation-validation";
import { figureSchema, researchProjectSchema, type ResearchProject } from "./schema";

/**
 * Makalenin kendi şekilleri.
 *
 * Bu blok ürünün geri kalanından farklı bir yön izliyor: her yerde makaleyi
 * YENİDEN çiziyoruz (architecture, matrix, equation dilbilgileri), burada ise
 * yazarların çizdiğini olduğu gibi gösteriyoruz. Bu yüzden kuralları da farklı
 * ve yazılı olmadan korunamaz.
 */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const figure = (overrides: Record<string, unknown> = {}) => ({
  id: "figure-p3-1",
  label: "Figure 1",
  caption: "Figure 1: The Transformer - model architecture.",
  whyItMatters: "The encoder and decoder stacks contain no recurrence at all.",
  page: 3,
  image: PNG,
  claimIds: [],
  ...overrides,
});

describe("figure şeması", () => {
  it("gömülü PNG kabul eder", () => {
    expect(figureSchema.safeParse(figure()).success).toBe(true);
  });

  /**
   * Uzak adres reddedilmeli. Bağımsız görüntüleyicinin CSP'si
   * `default-src 'none'` — uzaktaki bir görsel zaten yüklenmez, yani şema
   * kabul etseydi sayfa sessizce kırık bir görselle açılırdı. Ayrıca
   * paylaşılan bir dosya barındırıldığı sunucuya bağımlı kalmamalı.
   */
  it("uzak görsel adresini reddeder", () => {
    for (const image of [
      "https://example.com/figure.png",
      "http://localhost:3000/figure.png",
      "/examples/figure.png",
      "data:text/html;base64,PHNjcmlwdD4=",
    ]) {
      expect(figureSchema.safeParse(figure({ image })).success, image).toBe(false);
    }
  });

  it("sayfayı makalenin içinde ister", () => {
    expect(figureSchema.safeParse(figure({ page: 0 })).success).toBe(false);
    expect(figureSchema.safeParse(figure({ page: -3 })).success).toBe(false);
  });
});

describe("figure bütünlüğü", () => {
  const withFigures = (figures: unknown[]): ResearchProject =>
    ({ ...loadExampleProject(), figures } as ResearchProject);

  it("gerçek örneğin şekilleri sorunsuz geçer", () => {
    // Gerçek veri, uydurma fikstür değil: kural gerçek çıktıda da tutmalı.
    expect(loadExampleProject().figures?.length).toBeGreaterThan(0);
    expect(() => validateLearningIntegrity(loadExampleProject())).not.toThrow();
  });

  it("bilinmeyen claim'e bağlanmayı yakalar", () => {
    expect(() =>
      validateLearningIntegrity(withFigures([figure({ claimIds: ["claim-does-not-exist"] })])),
    ).toThrow(/claim-does-not-exist/);
  });

  /**
   * `whyItMatters` başlığı tekrar etmemeli. Başlık makalenin cümlesi; bu alan
   * şeklin NEDEN burada olduğunu söylemeli. Kopyalanırsa okuyucu aynı cümleyi
   * iki kez okur ve blok hiçbir şey eklememiş olur.
   */
  it("başlığın kopyalanmasını yakalar", () => {
    const caption = "Figure 1: The Transformer - model architecture.";
    expect(() =>
      validateLearningIntegrity(withFigures([figure({ caption, whyItMatters: caption })])),
    ).toThrow(/whyItMatters/);
  });

  /**
   * Bütçe gerçek bir kısıt: her şekil `.trace.json`'a base64 olarak giriyor.
   * Sınırsız bırakılırsa proje sessizce onlarca megabayta çıkar ve hem indirme
   * hem paylaşım bozulur.
   */
  it("gömülü görsellerin toplam ağırlığını sınırlar", () => {
    const heavy = `data:image/png;base64,${"A".repeat(2_400_000)}`;
    expect(() => validateLearningIntegrity(withFigures([figure({ image: heavy })]))).toThrow(/budget/i);
  });

  it("altı şekilden fazlasını kabul etmez", () => {
    const many = Array.from({ length: 7 }, (_, index) => figure({ id: `figure-${index}` }));
    const parsed = researchProjectSchema.safeParse({ ...loadExampleProject(), figures: many });
    expect(parsed.success).toBe(false);
  });
});

describe("amiral gemisi örnek", () => {
  /**
   * Örnek hem demo hem indirilebilir çıktı hem test fikstürü. Şekiller orada
   * gerçek veriyle duruyor; kaybolurlarsa özellik sessizce ölür.
   */
  it("makalenin kendi şekillerini taşır", () => {
    for (const file of [
      "attention-is-all-you-need.trace.json",
      "attention-is-all-you-need.en.trace.json",
    ]) {
      const project = loadExampleProject(file);
      expect(project.figures?.length, file).toBeGreaterThan(0);
      for (const item of project.figures ?? []) {
        expect(item.image.startsWith("data:image/"), `${file} ${item.id}`).toBe(true);
        expect(item.page).toBeGreaterThan(0);
        expect(item.whyItMatters).not.toBe(item.caption);
      }
    }
  });

  it("şekil başlıkları makalenin kendi metni olarak kalır", () => {
    // Başlık bir alıntıdır: iki dilde de aynı, çünkü kaynak İngilizce.
    const tr = loadExampleProject("attention-is-all-you-need.trace.json");
    const en = loadExampleProject("attention-is-all-you-need.en.trace.json");
    expect(tr.figures?.map((item) => item.caption)).toEqual(en.figures?.map((item) => item.caption));
    // Açıklama ise projenin dilini izler.
    expect(tr.figures?.[0]?.whyItMatters).not.toBe(en.figures?.[0]?.whyItMatters);
  });
});
