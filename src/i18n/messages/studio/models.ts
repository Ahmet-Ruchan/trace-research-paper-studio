import { ENGLISH_MODEL_PROVIDER_WORDS, type ModelProviderWords } from "@/lib/model-providers";
import type { ProbeWords } from "@/lib/model-probe";

/**
 * Sağlayıcı ve model seçimi, modeli deneme. `providers` ve `probe` kütüphane
 * kodunun (`model-providers.ts`, `model-probe.ts`) sözcükleri; `model-probe`
 * ağır bağımlılıklar taşıdığı için İngilizcesi burada da yazılı (aynılığını
 * `model-probe.test.ts` denetliyor).
 */
const en = {
  providers: ENGLISH_MODEL_PROVIDER_WORDS as ModelProviderWords,
  probe: {
    seconds: (count: number) => `${count} s`,
    minutes: (count: number) => `${count} min`,
    hours: (count: number) => `${count} h`,
    answered: (seconds: number) => `Answered in ${seconds.toFixed(1)} s.`,
    aSection: "A section",
    fast: (subject: string, estimate: string) => `${subject} should take about ${estimate}.`,
    slow: (subject: string, estimate: string, limit: string) => `${subject} should take about ${estimate}, close to the ${limit} limit.`,
    tooSlow: (subject: string, estimate: string, limit: string) =>
      `${subject} would take about ${estimate}, longer than the ${limit} limit. Pick a faster model.`,
    stages: {
      evidence: "Reading the paper",
      technical: "The method and results pass",
      report: "The deep report",
      visual: "The visual story",
      teaching: "The learning material",
    },
  } as ProbeWords,
  /** Anahtarı boş bırakılan bulut sağlayıcısı: "Gemini API key is required." */
  keyRequired: (keyLabel: string) => `${keyLabel} is required.`,
  teamProbe: {
    intro: "A short request to each model estimates how long its longest step would take, before the PDF is sent.",
    testing: "Testing…",
    testAgain: "Test again",
    testModels: "Test models",
    invalidModel: "The model name is not valid for this provider.",
    couldNotTest: "The model could not be tested.",
    waiting: "Waiting…",
    running: "Testing with a short request…",
    tooSlow: "too slow",
    about: (duration: string) => `about ${duration}`,
  },
  keyFields: {
    provider: "Provider",
    model: "Model",
    localAddress: "Local server address (optional)",
  },
};

const tr: typeof en = {
  providers: {
    providerLabels: { local: "Yerel model" },
    keyLabels: {
      gemini: "Gemini API anahtarı",
      openai: "OpenAI API anahtarı",
      anthropic: "Claude API anahtarı",
      openrouter: "OpenRouter API anahtarı",
      local: "Yerel sunucu adresi",
    },
    hints: {
      local:
        "Bu makinedeki Ollama, LM Studio ya da llama.cpp. Hiçbir şey makineden çıkmaz ve anahtar gerekmez. Yerel model PDF'i açamaz; bu yüzden Kanıt ve Teknik aşamalarında PDF'ten çıkarılan metni okur (Poppler'ın pdftotext aracı gerekir): şekiller ve sayfa düzeni kaybolur, her alıntı sayfa metnine karşı denetlenir. Modele 32K belirteç ya da daha büyük bir bağlam penceresi ver.",
    },
    modelNotes: {
      Fast: "Hızlı",
      Deepest: "En derin",
      Compatible: "Uyumlu",
      Recommended: "Önerilen",
      "Highest quality": "En yüksek kalite",
      Economical: "Ekonomik",
      "Automatic selection": "Otomatik seçim",
      Ollama: "Ollama",
    },
    tasks: {
      evidence: {
        label: "Kanıt ve kaynak okuma",
        shortLabel: "Kanıt",
        description: "Makale özeti, kaynak haritası, sınırlılıklar ve doğrulanabilir iddialar.",
        recommendation: "Geniş bağlam ve güçlü PDF okuma",
      },
      technical: {
        label: "Teknik ve matematiksel analiz",
        shortLabel: "Teknik",
        description: "Yöntem, denklemler, mimari, deney düzeni, sonuçlar ve kodlama mantığı.",
        recommendation: "Derin akıl yürütme ve kodlama becerisi",
      },
      report: {
        label: "Rapor ve açıklayıcı yazı",
        shortLabel: "Rapor",
        description: "Ayrıntılı rapor, eleştiri, yeniden üretim notları ve açık anlatımlar.",
        recommendation: "Güçlü yazım ve sentez",
      },
      visual: {
        label: "Tuval ve görsel yönetim",
        shortLabel: "Görsel",
        description: "İnfografikler, mimari haritaları, tuval yerleşimleri ve kaydırmalı anlatım planı.",
        recommendation: "Tasarım sezgisi ve yapılandırılmış çıktı",
      },
      teaching: {
        label: "Öğretim ve öğrenme materyali",
        shortLabel: "Öğretim",
        description: "Ön bilgi, adım adım türetimler, deneme alanları, test ve uygulama rehberi.",
        recommendation: "Açık anlatım ve özenli formüller",
      },
    },
  },
  probe: {
    seconds: (count) => `${count} sn`,
    minutes: (count) => `${count} dk`,
    hours: (count) => `${count} sa`,
    answered: (seconds) => `${seconds.toFixed(1).replace(".", ",")} sn içinde yanıt verdi.`,
    aSection: "Bir bölüm",
    fast: (subject, estimate) => `${subject} yaklaşık ${estimate} sürmeli.`,
    slow: (subject, estimate, limit) => `${subject} yaklaşık ${estimate} sürmeli; bu, ${limit} sınırına yakın.`,
    tooSlow: (subject, estimate, limit) => `${subject} yaklaşık ${estimate} sürer; bu, ${limit} sınırından uzun. Daha hızlı bir model seç.`,
    stages: {
      evidence: "Makalenin okunması",
      technical: "Yöntem ve sonuçların incelenmesi",
      report: "Ayrıntılı rapor",
      visual: "Görsel hikâye",
      teaching: "Öğrenme materyali",
    },
  },
  keyRequired: (keyLabel) => `${keyLabel} gerekli.`,
  teamProbe: {
    intro: "PDF gönderilmeden önce her modele kısa bir istek gider; en uzun adımının ne kadar süreceği böyle tahmin edilir.",
    testing: "Deneniyor…",
    testAgain: "Yeniden dene",
    testModels: "Modelleri dene",
    invalidModel: "Model adı bu sağlayıcı için geçerli değil.",
    couldNotTest: "Model denenemedi.",
    waiting: "Bekliyor…",
    running: "Kısa bir istekle deneniyor…",
    tooSlow: "çok yavaş",
    about: (duration) => `yaklaşık ${duration}`,
  },
  keyFields: {
    provider: "Sağlayıcı",
    model: "Model",
    localAddress: "Yerel sunucu adresi (isteğe bağlı)",
  },
};

const models = { en, tr };

export default models;
