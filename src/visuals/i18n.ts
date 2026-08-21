/**
 * Arayüz metinleri — HER ZAMAN İNGİLİZCE.
 *
 * Ürün tek bir arayüz dili konuşuyor; makale içeriği ise onu üreten modelin
 * yazdığı dilde kalıyor. İkisi ayrı: kanıta bağlı metni çevirmek alıntıyı
 * bozar, arayüzü çevirmek ise ürünü iki farklı ürüne böler.
 *
 * Projenin dilinden yalnızca `locale` etkilenir (sıralama ve harf dönüşümü).
 */

/** BCP-47 dil etiketi; artık iki dille sınırlı değil. */
export type Language = string;

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
  // Bağımsız görüntüleyici → stüdyo köprüsü
  openInStudio: string;
  studioOfflineTitle: string;
  studioOfflineBody: string;
  studioOfflineNote: string;
  studioTryAnyway: string;
  studioBanner: string;
  studioBannerAction: string;
  copyCommand: string;
  copied: string;
  close: string;
  labSectionsAria: string;
  // Makalenin kendi şekilleri
  figuresHeading: string;
  figureExpand: string;
  figureCollapse: string;
  figureFromPaper: (page: number) => string;
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
  openInStudio: "Open in Studio",
  studioOfflineTitle: "Trace Studio is not running",
  studioOfflineBody: "The studio is the full workspace: a library, editing and side-by-side papers. Start it once with this command, then run the delivery again and the project lands there on its own.",
  studioOfflineNote: "Everything on this page works without the studio, and the Trace JSON above is yours to keep — import it into any studio later.",
  studioTryAnyway: "Already running it? Open localhost:3000",
  studioBanner: "This is the portable copy of your paper. The full studio — library, editing, side-by-side papers — is one command away.",
  studioBannerAction: "Show me the command",
  copyCommand: "Copy command",
  copied: "Copied",
  close: "Close",
  labSectionsAria: "Paper review sections",
  figuresHeading: "Figures from the paper",
  figureExpand: "View full size",
  figureCollapse: "Fit to width",
  figureFromPaper: (page) => `From the paper · p. ${page}`,
};

const BCP47 = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * İçeriğin dilinden yalnızca `locale` etkilenir: sayı ve tarih biçimleme,
 * sıralama, harf dönüşümü ("i" → "İ") makalenin diline göre yapılmalı. Arayüz
 * metinleri her dilde aynı kalır.
 *
 * Etiket doğrudan `Intl`e gidiyor, o yüzden biçimi doğrulanıyor: bozuk bir
 * etiket orada `RangeError` fırlatır ve bileşeni komple düşürürdü.
 */
export function stringsFor(language: string | undefined): Strings {
  const tag = language?.trim();
  return tag && BCP47.test(tag) ? { ...en, locale: tag } : en;
}
