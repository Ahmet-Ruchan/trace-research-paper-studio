/**
 * Arayüz metinleri.
 *
 * Şema `language: "tr" | "en"` taşıyor ama arayüz sabit Türkçeydi: İngilizce
 * bir proje de Türkçe düğmelerle render oluyordu. Buradaki tablo projenin
 * kendi diline göre seçiliyor.
 *
 * Yalnızca ARAYÜZ metinleri burada. Makale içeriği projenin kendisinden gelir
 * ve çevrilmez — kanıta bağlı metni çevirmek alıntıyı bozar.
 */

export type Language = "tr" | "en";

export type Strings = {
  /** Sıralama ve büyük/küçük harf dönüşümü için BCP-47 etiketi. */
  locale: string;
  // Ortak
  sourceLabel: string;
  page: (page: number) => string;
  evidenceLabel: string;
  // İnteraktif
  playgroundKind: string;
  simulationKind: string;
  explorerKind: string;
  resetToPaper: string;
  paperValueShort: string;
  offPaperWarning: (anchor: string) => string;
  notComputable: string;
  chartPaperKey: string;
  // Simülasyon
  back: string;
  forward: string;
  play: string;
  pause: string;
  replay: string;
  // Veri keşfi
  filterPlaceholder: string;
  filterAria: string;
  emptyRows: string;
  // Ön bilgi
  levels: Record<"temel" | "orta" | "ileri", string>;
  whyItMatters: string;
  readFirst: string;
  // Türetim
  goal: string;
  nextStep: (shown: number, total: number) => string;
  numericExample: string;
  result: string;
  // Quiz
  checkAnswer: string;
  correct: string;
  wrong: string;
  score: (right: number, total: number) => string;
  // Uygulama rehberi
  hyperparameters: string;
  pitfalls: string;
  pitfallCause: string;
  pitfallFix: string;
  whenNotToUse: string;
  guideParameter: string;
  guidePaperValue: string;
  guideRange: string;
  guideHowToChoose: string;
  // Kabuk
  navPrimer: string;
  navPractice: string;
  tabLab: string;
  tabStory: string;
  tabPractice: string;
  tabTechnical: string;
  practiceHeading: string;
  derivationsHeading: string;
  interactivesHeading: string;
  tryItHeading: string;
  localStudio: string;
  thesis: string;
  plainSummary: string;
  researchQuestion: string;
  methodsFindingsLimits: string;
  methods: string;
  findings: string;
  limitations: string;
  metrics: string;
  claims: string;
  glossary: string;
  openQuestions: string;
  equations: string;
  algorithmSteps: string;
  codeSketches: string;
  complexity: string;
  implementationNotes: string;
  operation: string;
  cost: string;
  context: string;
  sourceFallback: string;
  home: string;
  library: string;
  paperMap: string;
  linkedSources: string;
  pickAClaim: string;
  pickAClaimHint: string;
  labSectionsAria: string;
};

const tr: Strings = {
  locale: "tr",
  sourceLabel: "Kaynağı gör",
  page: (page) => `s. ${page}`,
  evidenceLabel: "Kanıtı gör",
  playgroundKind: "Oyun alanı",
  simulationKind: "Simülasyon",
  explorerKind: "Veri keşfi",
  resetToPaper: "Makale değerlerine dön",
  paperValueShort: "makale",
  offPaperWarning: (anchor) =>
    `Makale dışı bölgedesin — bu değerler makalede doğrulanmadı. ${anchor}`,
  notComputable: "hesaplanamadı",
  chartPaperKey: "makale değeri",
  back: "‹ Geri",
  forward: "İleri ›",
  play: "Oynat",
  pause: "Duraklat",
  replay: "Baştan oynat",
  filterPlaceholder: "Filtrele…",
  filterAria: "Tabloyu filtrele",
  emptyRows: "Filtreye uyan satır yok.",
  levels: { temel: "Temel", orta: "Orta", ileri: "İleri" },
  whyItMatters: "Bu makalede neden gerekli:",
  readFirst: "Önce şunları oku:",
  goal: "Hedef:",
  nextStep: (shown, total) => `Sonraki adımı göster (${shown}/${total})`,
  numericExample: "Sayısal örnek",
  result: "Sonuç:",
  checkAnswer: "Yanıtı kontrol et",
  correct: "Doğru",
  wrong: "Yanlış",
  score: (right, total) => `${right} / ${total} doğru`,
  hyperparameters: "Hiperparametre seçimi",
  pitfalls: "Sık yapılan hatalar",
  pitfallCause: "Neden:",
  pitfallFix: "Çözüm:",
  whenNotToUse: "Ne zaman kullanılmaz",
  guideParameter: "Parametre",
  guidePaperValue: "Makale değeri",
  guideRange: "Aralık",
  guideHowToChoose: "Nasıl seçilir",
  navPrimer: "Ön bilgi",
  navPractice: "Öğren & Dene",
  tabLab: "Lab",
  tabStory: "Hikâye",
  tabPractice: "Öğren & Dene",
  tabTechnical: "Teknik",
  practiceHeading: "Öğren & Dene",
  derivationsHeading: "Adım adım türetimler",
  interactivesHeading: "İnteraktif deneme",
  tryItHeading: "Şimdi kendin dene",
  localStudio: "Yerel makale stüdyosu",
  thesis: "Tez",
  plainSummary: "Sade özet",
  researchQuestion: "Araştırma sorusu",
  methodsFindingsLimits: "Yöntem, bulgular, sınırlılıklar",
  methods: "Yöntem",
  findings: "Bulgular",
  limitations: "Sınırlılıklar",
  metrics: "Metrikler",
  claims: "İddialar",
  glossary: "Sözlük",
  openQuestions: "Açık sorular",
  equations: "Denklemler",
  algorithmSteps: "Algoritma adımları",
  codeSketches: "Kod taslakları",
  complexity: "Karmaşıklık",
  implementationNotes: "Uygulama notları",
  operation: "İşlem",
  cost: "Maliyet",
  context: "Bağlam",
  sourceFallback: "kaynak",
  home: "Ana sayfa",
  library: "Kütüphane",
  paperMap: "Paper map",
  linkedSources: "bağlı kaynak",
  pickAClaim: "Bir claim seç",
  pickAClaimHint: "Kaynağını görmek için bir bulgu veya story içindeki kaynak etiketine tıkla.",
  labSectionsAria: "Paper inceleme bölümleri",
};

const en: Strings = {
  locale: "en",
  sourceLabel: "View source",
  page: (page) => `p. ${page}`,
  evidenceLabel: "View evidence",
  playgroundKind: "Playground",
  simulationKind: "Simulation",
  explorerKind: "Data explorer",
  resetToPaper: "Reset to the paper's values",
  paperValueShort: "paper",
  offPaperWarning: (anchor) =>
    `You are outside the paper's range — these values were not verified. ${anchor}`,
  notComputable: "undefined here",
  chartPaperKey: "paper's value",
  back: "‹ Back",
  forward: "Next ›",
  play: "Play",
  pause: "Pause",
  replay: "Replay",
  filterPlaceholder: "Filter…",
  filterAria: "Filter the table",
  emptyRows: "No rows match the filter.",
  levels: { temel: "Basic", orta: "Intermediate", ileri: "Advanced" },
  whyItMatters: "Why this paper needs it:",
  readFirst: "Read these first:",
  goal: "Goal:",
  nextStep: (shown, total) => `Show the next step (${shown}/${total})`,
  numericExample: "Worked example",
  result: "Result:",
  checkAnswer: "Check answer",
  correct: "Correct",
  wrong: "Incorrect",
  score: (right, total) => `${right} / ${total} correct`,
  hyperparameters: "Choosing hyperparameters",
  pitfalls: "Common pitfalls",
  pitfallCause: "Cause:",
  pitfallFix: "Fix:",
  whenNotToUse: "When not to use it",
  guideParameter: "Parameter",
  guidePaperValue: "Paper's value",
  guideRange: "Range",
  guideHowToChoose: "How to choose",
  navPrimer: "Primer",
  navPractice: "Learn & Try",
  tabLab: "Lab",
  tabStory: "Story",
  tabPractice: "Learn & Try",
  tabTechnical: "Technical",
  practiceHeading: "Learn & Try",
  derivationsHeading: "Step-by-step derivations",
  interactivesHeading: "Interactive exploration",
  tryItHeading: "Now try it yourself",
  localStudio: "Local paper studio",
  thesis: "Thesis",
  plainSummary: "In plain language",
  researchQuestion: "Research question",
  methodsFindingsLimits: "Methods, findings, limitations",
  methods: "Methods",
  findings: "Findings",
  limitations: "Limitations",
  metrics: "Metrics",
  claims: "Claims",
  glossary: "Glossary",
  openQuestions: "Open questions",
  equations: "Equations",
  algorithmSteps: "Algorithm steps",
  codeSketches: "Code sketches",
  complexity: "Complexity",
  implementationNotes: "Implementation notes",
  operation: "Operation",
  cost: "Cost",
  context: "Context",
  sourceFallback: "source",
  home: "Home",
  library: "Library",
  paperMap: "Paper map",
  linkedSources: "linked sources",
  pickAClaim: "Select a claim",
  pickAClaimHint: "Click a finding, or a source tag inside the story, to see where it comes from.",
  labSectionsAria: "Paper review sections",
};

const TABLES: Record<Language, Strings> = { tr, en };

export function stringsFor(language: string | undefined): Strings {
  return TABLES[(language as Language) ?? "tr"] ?? tr;
}
