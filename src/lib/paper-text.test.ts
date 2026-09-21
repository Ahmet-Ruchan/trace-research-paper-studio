import { describe, expect, it } from "vitest";
import {
  downgradeUnlocatedClaims,
  excerptIsOnPage,
  paperTextBudget,
  renderPaperText,
  selectPagesForPass,
  splitPages,
} from "./paper-text";
import type { Claim } from "./schema";

const filler = (label: string, length: number) => `${label} `.repeat(Math.ceil(length / (label.length + 1))).slice(0, length);

function claim(id: string, page: number, excerpt: string, confidence: Claim["confidence"] = "verified"): Claim {
  return { id, statement: "s", kind: "method", confidence, sourceRefs: [{ sourceId: "paper", page, excerpt }] };
}

describe("splitPages", () => {
  it("form-feed ile böler ve sondaki boş sayfayı atar", () => {
    expect(splitPages("first page   \n\fsecond\f\n  \f")).toEqual(["first page", "second"]);
  });
});

describe("paperTextBudget", () => {
  it("geçersiz ya da çok küçük değeri yok sayar", () => {
    expect(paperTextBudget("120000")).toBe(120_000);
    expect(paperTextBudget("12")).toBe(60_000);
    expect(paperTextBudget("abc")).toBe(60_000);
    expect(paperTextBudget(undefined)).toBe(60_000);
  });
});

describe("selectPagesForPass", () => {
  it("bütçeye sığan makalede her sayfayı verir", () => {
    expect(selectPagesForPass(["a", "b", "c"], "methods", 10_000)).toEqual({ included: [1, 2, 3], omitted: [] });
  });

  it("sığmayan makalede aşamaya uygun sayfaları seçer, kaynakçayı bırakır", () => {
    const references = Array.from({ length: 40 }, (_, index) => `[${index + 1}] A. Author. Some title. In Proceedings of X, 2019.`).join("\n");
    const pages = [
      `Title\nAbstract. We propose a model.\n${filler("intro", 2_600)}`,
      `3 Method\nThe architecture and training procedure. The model uses an optimizer.\n${filler("method", 2_600)}`,
      `4 Experiments\nResults in Table 2: accuracy improves over the baseline.\n${filler("result", 2_600)}`,
      `6 Limitations\nHowever, the approach fails on long inputs; future work.\n${filler("limit", 2_600)}`,
      `${references}\n${filler("[99] ref 2019.", 1_500)}`,
    ];
    const methods = selectPagesForPass(pages, "methods", 6_500);
    expect(methods.included).toEqual([1, 2]);
    expect(methods.omitted).toContain(5);

    const limitations = selectPagesForPass(pages, "limitations", 6_500);
    expect(limitations.included).toEqual([1, 4]);
  });

  it("modele hangi sayfaları görmediğini söyler", () => {
    const pages = [filler("one", 5_000), filler("two", 5_000), filler("three", 5_000)];
    const rendered = renderPaperText(pages, "overview", 10_500);
    expect(rendered.text).toContain("--- PAGE 1 ---");
    expect(rendered.omitted).toHaveLength(1);
    expect(rendered.text).toMatch(new RegExp(`Pages ${rendered.omitted[0]} were left out`));
    expect(rendered.text).not.toContain(`--- PAGE ${rendered.omitted[0]} ---`);
    expect(renderPaperText(pages, "overview", 100_000).text).not.toContain("were left out");
  });
});

describe("excerptIsOnPage", () => {
  const pages = [
    "Attention Is All You Need\nWe propose a new simple network archi-\ntecture, the Transformer.",
    "The model achieves 28.4 BLEU on the WMT 2014\nEnglish-to-German translation task, “improving” over the best results.",
  ];

  it("tirelemeyi, satır sonlarını ve tırnak biçimini tolere eder", () => {
    expect(excerptIsOnPage(pages, 1, "a new simple network architecture, the Transformer")).toBe(true);
    expect(excerptIsOnPage(pages, 2, 'achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, "improving"')).toBe(true);
  });

  it("kısaltılmış alıntının her parçasını arar", () => {
    expect(excerptIsOnPage(pages, 2, "The model achieves 28.4 BLEU … over the best results")).toBe(true);
    expect(excerptIsOnPage(pages, 2, "The model achieves 28.4 BLEU … on the ImageNet benchmark")).toBe(false);
  });

  it("komşu sayfayı kabul eder, uzak sayfayı ve uydurma alıntıyı etmez", () => {
    expect(excerptIsOnPage(pages, 2, "a new simple network architecture")).toBe(true);
    expect(excerptIsOnPage(pages, 1, "the model reaches 41.8 BLEU on French")).toBe(false);
    expect(excerptIsOnPage(pages, 9, "a new simple network architecture")).toBe(false);
    expect(excerptIsOnPage(pages, 1, "the")).toBe(false);
  });
});

describe("downgradeUnlocatedClaims", () => {
  it("alıntısı bulunamayan iddiayı silmez, güvenini düşürür", () => {
    const pages = ["We train the model for 100,000 steps on eight GPUs."];
    const output = {
      methods: ["m"],
      claims: [
        claim("method-real", 1, "train the model for 100,000 steps"),
        claim("method-invented", 1, "trained for three weeks on a TPU pod"),
        claim("method-unsure", 1, "nothing like this appears", "needs-review"),
        { ...claim("method-web", 1, "x"), sourceRefs: [{ sourceId: "web-1", excerpt: "from a web source" }] },
      ],
    };
    const checked = downgradeUnlocatedClaims(output, pages);
    expect(checked.downgraded).toBe(1);
    expect(checked.output.claims.map((item) => item.confidence)).toEqual(["verified", "needs-review", "needs-review", "verified"]);
    expect(checked.output.methods).toEqual(["m"]);
    // Girdi değişmez; kontrol noktası aynı nesneyi paylaşıyor olabilir.
    expect(output.claims[1].confidence).toBe("verified");
  });
});
