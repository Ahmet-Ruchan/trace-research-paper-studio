import { describe, expect, it } from "vitest";
import { exampleProject } from "./example-fixture";
import { validateLearningIntegrity } from "./generation-validation";
import type { Interactive, ResearchProject } from "./schema";

/**
 * Öğrenme bloğu taşımayan taban proje. Amiral gemisi örnek artık bütün
 * blokları taşıdığı için "öğrenme katmanından önce üretilmiş proje"yi temsil
 * edemez; testin ölçtüğü şey tam olarak o geriye dönük uyumluluk.
 */
const base: ResearchProject = (() => {
  const legacy = structuredClone(exampleProject) as Partial<ResearchProject>;
  delete legacy.primer;
  delete legacy.derivations;
  delete legacy.quiz;
  delete legacy.interactives;
  delete legacy.applicationGuide;
  return legacy as ResearchProject;
})();

function withBlocks(patch: Partial<ResearchProject>): ResearchProject {
  return { ...structuredClone(base), ...patch } as ResearchProject;
}

const claimId = base.evidence.claims[0].id;

const playground: Interactive = {
  kind: "formula-playground",
  id: "play-scaling",
  title: "Ölçekleme etkisi",
  description: "d_k büyüdükçe iç çarpımın varyansı büyür.",
  parameters: [
    { name: "d_k", label: "Anahtar boyutu", min: 1, max: 512, step: 1, paperValue: 64 },
  ],
  outputs: [
    { id: "scale", label: "Ölçekleme katsayısı", formula: "1 / sqrt(d_k)", precision: 4 },
    { id: "variance", label: "Ölçeklenmemiş varyans", formula: "d_k" },
  ],
  chart: {
    xParam: "d_k",
    series: [{ outputId: "scale", label: "1/√d_k" }],
    samples: 64,
    yScale: "linear",
  },
  paperAnchor: "Makale d_k = 64 kullanır (h = 8, d_model = 512).",
  claimIds: [claimId],
};

describe("öğrenme katmanı bütünlüğü", () => {
  it("öğrenme bloğu olmayan eski projeyi kabul eder", () => {
    expect(() => validateLearningIntegrity(base)).not.toThrow();
  });

  it("derinlik zorunluluğunu yalnızca üretim modunda uygular", () => {
    expect(() => validateLearningIntegrity(base)).not.toThrow();
    expect(() => validateLearningIntegrity(base, { requireDepthBlocks: true })).toThrow(/zorunlu/);
  });

  it("geçerli bir formül oyun alanını kabul eder", () => {
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [playground] }))).not.toThrow();
  });
});

describe("interaktif çalışırlık garantisi", () => {
  it("bildirilmemiş parametre kullanan formülü reddeder", () => {
    const broken = structuredClone(playground);
    broken.outputs[0].formula = "1 / sqrt(d_model)";
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [broken] }))).toThrow(
      /bildirilmemiş parametre/,
    );
  });

  it("ayrıştırılamayan formülü reddeder", () => {
    const broken = structuredClone(playground);
    broken.outputs[0].formula = "1 / sqrt(";
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [broken] }))).toThrow(
      /formül geçersiz/,
    );
  });

  it("kod çalıştırmaya çalışan formülü reddeder", () => {
    const broken = structuredClone(playground);
    broken.outputs[0].formula = "constructor.constructor('return 1')()";
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [broken] }))).toThrow(
      /formül geçersiz/,
    );
  });

  it("makale değerinde tanımsız kalan formülü reddeder", () => {
    const broken = structuredClone(playground);
    broken.outputs[0].formula = "1 / (d_k - 64)"; // paperValue 64 → sıfıra bölme
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [broken] }))).toThrow(
      /sonlu sonuç üretmiyor/,
    );
  });

  it("makale değeri aralık dışındaysa reddeder", () => {
    const broken = structuredClone(playground);
    broken.parameters[0].paperValue = 9999;
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [broken] }))).toThrow(
      /aralık dışında/,
    );
  });

  it("grafiğin bilinmeyen çıktıya veya eksene bağlanmasını reddeder", () => {
    const badSeries = structuredClone(playground);
    badSeries.chart!.series[0].outputId = "yok";
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [badSeries] }))).toThrow(
      /bilinmeyen çıktı/,
    );

    const badAxis = structuredClone(playground);
    badAxis.chart!.xParam = "yok";
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [badAxis] }))).toThrow(
      /xParam bildirilmemiş/,
    );
  });

  it("dikdörtgen olmayan simülasyon ızgarasını reddeder", () => {
    const simulation: Interactive = {
      kind: "mechanism-simulation",
      id: "sim-attention",
      title: "Dikkat ağırlıkları",
      description: "Adım adım hesap.",
      stageNodes: [
        { id: "q", label: "Q", detail: "Sorgu" },
        { id: "k", label: "K", detail: "Anahtar" },
      ],
      frames: [
        {
          label: "Adım 1",
          caption: "İç çarpım",
          activeNodeIds: ["q", "k"],
          grid: { rowLabels: ["t1", "t2"], columnLabels: ["t1", "t2"], values: [[1, 2], [3]] },
        },
        { label: "Adım 2", caption: "Softmax", activeNodeIds: ["q"] },
      ],
      claimIds: [claimId],
    };
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [simulation] }))).toThrow(
      /sütun sayısıyla eşleşmiyor/,
    );
  });

  it("sayısal sütunda metin taşıyan veri kümesini reddeder", () => {
    const explorer: Interactive = {
      kind: "dataset-explorer",
      id: "data-bleu",
      title: "Tablo 2",
      description: "BLEU sonuçları.",
      columns: [
        { id: "model", label: "Model", type: "text" },
        { id: "bleu", label: "BLEU", type: "number" },
      ],
      rows: [
        { cells: ["Transformer (big)", 28.4] },
        { cells: ["ConvS2S", "yok"] },
      ],
      sourceRef: { sourceId: "paper", page: 8, excerpt: "Transformer (big) 28.4" },
      claimIds: [claimId],
    };
    expect(() => validateLearningIntegrity(withBlocks({ interactives: [explorer] }))).toThrow(
      /sayı olmayan değer/,
    );
  });
});

describe("quiz ve ön bilgi tutarlılığı", () => {
  const quizBase = {
    title: "Anlama kontrolü",
    intro: "Kanıta bağlı sorular.",
    questions: [
      {
        id: "q1",
        prompt: "Transformer hangi yapıyı tamamen kaldırır?",
        kind: "single" as const,
        options: [
          { label: "Tekrarlama ve evrişim", correct: true, explanation: "Özet, s. 1." },
          { label: "Softmax", correct: false, explanation: "Dikkatin çekirdeğinde kalır." },
        ],
        claimIds: [claimId],
      },
      {
        id: "q2",
        prompt: "Kendine dikkatin katman maliyeti nedir?",
        kind: "single" as const,
        options: [
          { label: "O(n² · d)", correct: true, explanation: "Tablo 1, s. 6." },
          { label: "O(n · d²)", correct: false, explanation: "Bu tekrarlayan katman." },
        ],
        claimIds: [claimId],
      },
      {
        id: "q3",
        prompt: "Sinüzoidal kodlama ölçülen doğrulukta üstündür.",
        kind: "true-false" as const,
        options: [
          { label: "Yanlış", correct: true, explanation: "Tablo 3 satır (E): neredeyse özdeş." },
          { label: "Doğru", correct: false, explanation: "Makale bunu göstermiyor." },
        ],
        claimIds: [claimId],
      },
    ],
  };

  it("geçerli quizi kabul eder", () => {
    expect(() => validateLearningIntegrity(withBlocks({ quiz: quizBase }))).not.toThrow();
  });

  it("doğru şıkkı olmayan soruyu reddeder", () => {
    const broken = structuredClone(quizBase);
    broken.questions[0].options.forEach((option) => {
      option.correct = false;
    });
    expect(() => validateLearningIntegrity(withBlocks({ quiz: broken }))).toThrow(/doğru şık yok/);
  });

  it("tek yanıtlı soruda birden çok doğru şıkkı reddeder", () => {
    const broken = structuredClone(quizBase);
    broken.questions[0].options[1].correct = true;
    expect(() => validateLearningIntegrity(withBlocks({ quiz: broken }))).toThrow(
      /tam olarak bir doğru şık/,
    );
  });

  it("döngüsel ön koşulu ve bilinmeyen kavramı reddeder", () => {
    const primer = {
      title: "Ön bilgi",
      overview: "Makalenin varsaydıkları.",
      concepts: [
        {
          id: "softmax",
          term: "Softmax",
          level: "temel" as const,
          intuition: "Skorları olasılığa çevirir.",
          whyItMatters: "Dikkat ağırlıkları böyle üretilir.",
          prerequisiteIds: ["softmax"],
          claimIds: [],
        },
        {
          id: "dot-product",
          term: "İç çarpım",
          level: "temel" as const,
          intuition: "İki vektörün hizasını ölçer.",
          whyItMatters: "Sorgu-anahtar uyumu buradan gelir.",
          prerequisiteIds: ["yok-boyle-bir-kavram"],
          claimIds: [],
        },
        {
          id: "variance",
          term: "Varyans",
          level: "orta" as const,
          intuition: "Yayılımın ölçüsü.",
          whyItMatters: "√d_k ölçeklemesinin gerekçesi.",
          prerequisiteIds: [],
          claimIds: [],
        },
      ],
    };
    expect(() => validateLearningIntegrity(withBlocks({ primer }))).toThrow(
      /kendini ön koşul gösteremez/,
    );
    expect(() => validateLearningIntegrity(withBlocks({ primer }))).toThrow(/bilinmeyen ön koşul/);
  });
});
