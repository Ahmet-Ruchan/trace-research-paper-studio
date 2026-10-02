import type { TemplateIssueWords } from "@/lib/narrative-templates";

/**
 * Anlatı şablonları: kaydetme penceresi, düzenleyici, şablon sorunları ve
 * hazır şablonların ekrandaki adı. Şablonun kendisi (adı, amaçları) isteme
 * giriyor ve değişmiyor; hazır şablonlar yalnızca ekranda kendi dilinde
 * görünüyor. `narrative-templates.ts` ağır bağımlılıklar taşıdığı için
 * İngilizcesi burada da yazılı (aynılığını `narrative-templates.test.ts`
 * denetliyor).
 */
const en = {
  untitled: "Untitled template",
  dialogHeading: "Save this story's structure",
  dialogIntro: "The template keeps the order of sections, their visuals and the kinds of claims they lean on, never the text. Pick it when you analyse the next paper.",
  eyebrow: "Narrative template",
  /** Kayıttan sonra: "<ad> is saved. … with <code>prepare --template id</code>." */
  savedBefore: " is saved. It appears under Narrative template when you analyse a paper, and agents can use it with ",
  savedAfter: ".",
  savedEditNote: " Projects already analysed with it keep their own copy.",
  namePlaceholder: "Template name, e.g. Weekly reading group",
  nameLabel: "Template name",
  descriptionPlaceholder: "Who is it for? (optional)",
  descriptionLabel: "Template description",
  storySections: "Story sections, in order",
  purposeLabel: (section: number) => `Purpose of section ${section}`,
  purposePlaceholder: "What this section does for the reader",
  visualLabel: (section: number) => `Visual of section ${section}`,
  kindsLabel: (section: number) => `Claim kinds of section ${section}`,
  moveUp: (section: number) => `Move section ${section} up`,
  moveDown: (section: number) => `Move section ${section} down`,
  removeSection: (section: number) => `Remove section ${section}`,
  claimKinds: {
    "reported-result": "results",
    "author-interpretation": "interpretation",
    method: "method",
    background: "background",
    limitation: "limitation",
  },
  addSection: "Add a section",
  atMost: (count: number) => `(at most ${count})`,
  fixReportOrder: "Fix the order of the deep report sections",
  moveKindUp: (kind: string) => `Move ${kind} up`,
  moveKindDown: (kind: string) => `Move ${kind} down`,
  cannotSave: "This structure cannot be saved yet.",
  sectionIssue: (section: number, message: string) => `Section ${section}: ${message}`,
  givePurpose: "give it a purpose",
  templateLabel: "Template",
  nameRequired: "Give the template a name.",
  saveFailed: "The template could not be saved.",
  saveChanges: "Save changes",
  saveTemplate: "Save template",
  issues: {
    fewVisuals: "A template needs at least three different visual types",
    needsAdvanced: (visuals: string) => `A template needs at least one of: ${visuals}`,
    needsMethod: "One section must draw on method claims",
    needsLimitation: "One section must draw on limitation claims",
    reportMissing: (kinds: string) => `The report order must include every section kind; missing ${kinds}`,
    visualNames: {
      metric: "metric",
      flow: "flow",
      comparison: "comparison",
      concept: "concept",
      layers: "layers",
      quote: "quote",
      architecture: "architecture",
      equation: "equation",
      timeline: "timeline",
      matrix: "matrix",
      infographic: "infographic",
    },
    reportKindNames: {
      contribution: "contribution",
      mechanism: "mechanism",
      experiment: "experiment",
      critique: "critique",
      reproduction: "reproduction",
      implication: "implication",
    },
  } as TemplateIssueWords,
  /** Hazır şablonların ekranda görünen adı ve açıklaması, kimliklerine göre. */
  builtIn: {
    "method-walkthrough": {
      name: "Method walkthrough",
      description: "For readers who want to rebuild the idea: the problem, then the mechanism step by step, then what it achieved and where it stops.",
    },
    "results-briefing": {
      name: "Results briefing",
      description: "For a busy reader: what was found first, how much it matters, then just enough method to trust it, and the caveats.",
    },
  } as Record<string, { name: string; description: string } | undefined>,
};

const tr: typeof en = {
  untitled: "Adsız şablon",
  dialogHeading: "Bu hikâyenin yapısını kaydet",
  dialogIntro: "Şablon bölümlerin sırasını, görsellerini ve dayandıkları iddia türlerini saklar; metni asla. Bir sonraki makaleyi analiz ederken onu seç.",
  eyebrow: "Anlatı şablonu",
  savedBefore: " kaydedildi. Bir makaleyi analiz ederken Anlatı şablonu altında görünür; ajanlar da onu ",
  savedAfter: " ile kullanabilir.",
  savedEditNote: " Onunla daha önce analiz edilmiş projeler kendi kopyalarını korur.",
  namePlaceholder: "Şablon adı, ör. Haftalık okuma grubu",
  nameLabel: "Şablon adı",
  descriptionPlaceholder: "Kimin için? (isteğe bağlı)",
  descriptionLabel: "Şablon açıklaması",
  storySections: "Hikâye bölümleri, sırasıyla",
  purposeLabel: (section) => `${section}. bölümün amacı`,
  purposePlaceholder: "Bu bölüm okuyucu için ne yapıyor",
  visualLabel: (section) => `${section}. bölümün görseli`,
  kindsLabel: (section) => `${section}. bölümün iddia türleri`,
  moveUp: (section) => `${section}. bölümü yukarı taşı`,
  moveDown: (section) => `${section}. bölümü aşağı taşı`,
  removeSection: (section) => `${section}. bölümü kaldır`,
  claimKinds: {
    "reported-result": "sonuçlar",
    "author-interpretation": "yorum",
    method: "yöntem",
    background: "arka plan",
    limitation: "sınırlılık",
  },
  addSection: "Bölüm ekle",
  atMost: (count) => `(en çok ${count})`,
  fixReportOrder: "Ayrıntılı rapor bölümlerinin sırasını sabitle",
  moveKindUp: (kind) => `“${kind}” bölümünü yukarı taşı`,
  moveKindDown: (kind) => `“${kind}” bölümünü aşağı taşı`,
  cannotSave: "Bu yapı henüz kaydedilemez.",
  sectionIssue: (section, message) => `${section}. bölüm: ${message}`,
  givePurpose: "bir amaç yaz",
  templateLabel: "Şablon",
  nameRequired: "Şablona bir ad ver.",
  saveFailed: "Şablon kaydedilemedi.",
  saveChanges: "Değişiklikleri kaydet",
  saveTemplate: "Şablonu kaydet",
  issues: {
    fewVisuals: "Şablonda en az üç farklı görsel türü olmalı",
    needsAdvanced: (visuals) => `Şablonda şunlardan en az biri olmalı: ${visuals}`,
    needsMethod: "Bir bölüm yöntem iddialarına dayanmalı",
    needsLimitation: "Bir bölüm sınırlılık iddialarına dayanmalı",
    reportMissing: (kinds) => `Rapor sırası her bölüm türünü içermeli; eksik: ${kinds}`,
    visualNames: {
      metric: "metrik",
      flow: "akış",
      comparison: "karşılaştırma",
      concept: "kavram",
      layers: "katmanlar",
      quote: "alıntı",
      architecture: "mimari",
      equation: "denklem",
      timeline: "zaman çizelgesi",
      matrix: "matris",
      infographic: "infografik",
    },
    reportKindNames: {
      contribution: "katkı",
      mechanism: "mekanizma",
      experiment: "deney",
      critique: "eleştiri",
      reproduction: "yeniden üretim",
      implication: "çıkarım",
    },
  },
  builtIn: {
    "method-walkthrough": {
      name: "Yöntem turu",
      description: "Fikri yeniden kurmak isteyen okuyucu için: önce problem, sonra adım adım mekanizma, ardından neyi başardığı ve nerede durduğu.",
    },
    "results-briefing": {
      name: "Sonuç özeti",
      description: "Vakti dar okuyucu için: önce ne bulunduğu ve ne kadar önemli olduğu, sonra ona güvenmeye yetecek kadar yöntem ve çekinceler.",
    },
  },
};

const templates = { en, tr };

export default templates;
