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
  exportedCopy: string;
  publishedStory: string;
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
  // Kanıt sağlığı
  navHealth: string;
  healthHeading: string;
  healthIntro: string;
  healthVerified: string;
  healthVerifiedNote: (needsReview: number) => string;
  healthPages: string;
  healthPagesNote: (first: number, last: number, gaps: number) => string;
  healthPagesNone: string;
  healthInUse: string;
  healthInUseNote: (unused: number) => string;
  healthGrounding: string;
  healthGroundingNote: (fromPaper: number, fromWeb: number) => string;
  healthCitations: (count: number) => string;
  healthNeverCited: string;
  healthGaps: string;
  healthGapsNote: (first: number, last: number) => string;
  healthThin: string;
  healthThinNote: string;
  healthSectionClaims: (verified: number, total: number) => string;
  healthStrengthen: string;
  healthAreaStory: string;
  healthAreaReport: string;
  healthUnused: string;
  healthUnusedNote: string;
  healthQuotes: string;
  healthQuotesNote: (missing: number) => string;
  healthQuotesUnchecked: string;
  healthQuotesUncheckedNote: string;
  healthQuotesMissing: string;
  healthQuotesMissingNote: (date: string) => string;
  healthQuotesCheck: string;
  healthQuotesRecheck: string;
  healthQuotesPage: (page?: number) => string;
  // Kalıcı bağlantı
  permalinkTitle: string;
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
  exportedCopy: "Standalone copy",
  publishedStory: "Published story",
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
  navHealth: "Evidence health",
  healthHeading: "Evidence health",
  healthIntro:
    "Everything below is computed from this project's own data — no model was asked. It shows where the analysis stands on solid ground and where it does not.",
  healthVerified: "claims verified",
  healthVerifiedNote: (needsReview) =>
    needsReview === 0
      ? "Every claim's excerpt directly supports its statement."
      : `${needsReview} still marked needs-review: the excerpt supports them only partly.`,
  healthPages: "pages reached",
  healthPagesNote: (first, last, gaps) =>
    gaps === 0
      ? `Continuous from p. ${first} to p. ${last}.`
      : `From p. ${first} to p. ${last}, with ${gaps} page${gaps === 1 ? "" : "s"} never cited.`,
  healthPagesNone: "No claim carries a page number; this analysis rests on web context alone.",
  healthInUse: "claims in use",
  healthInUseNote: (unused) =>
    unused === 0
      ? "Every collected claim is used somewhere in the narrative."
      : `${unused} claim${unused === 1 ? " was" : "s were"} collected but never used.`,
  healthGrounding: "Where the evidence comes from",
  healthGroundingNote: (fromPaper, fromWeb) =>
    fromWeb === 0
      ? `All ${fromPaper} claims are anchored to the paper itself.`
      : `${fromPaper} claims come from the paper, ${fromWeb} from published context about it — citation counts, venue, version history. Context is not a paper claim.`,
  healthCitations: (count) => `${count} citation${count === 1 ? "" : "s"}`,
  healthNeverCited: "never cited",
  healthGaps: "Pages the analysis never reaches",
  healthGapsNote: (first, last) =>
    `The paper's total length is not stored in a Trace project, so only the span between the first and last cited page (p. ${first}–${last}) can be judged. These pages fall inside it and no claim, metric or figure touches them.`,
  healthThin: "Sections resting on thin evidence",
  healthThinNote:
    "A section is thin when it hangs on a single claim, or when none of the claims under it are verified. That is not necessarily wrong — but it is where to look first.",
  healthSectionClaims: (verified, total) => `${verified}/${total} verified`,
  healthStrengthen: "Strengthen",
  healthAreaStory: "Story",
  healthAreaReport: "Report",
  healthUnused: "Collected but unused",
  healthUnusedNote:
    "These claims are in the evidence ledger and no section, equation or figure refers to them. Often they are the most interesting leftovers.",
  healthQuotes: "quotes found on their page",
  healthQuotesNote: (missing) =>
    missing === 0
      ? "Every quote was found in the text of the page it cites."
      : `${missing} quote${missing === 1 ? " was" : "s were"} not found on the cited page.`,
  healthQuotesUnchecked: "quotes not checked",
  healthQuotesUncheckedNote: "Nobody has compared the quotes with the PDF's text yet.",
  healthQuotesMissing: "Quotes that were not found on the cited page",
  healthQuotesMissingNote: (date) =>
    `Checked on ${date} against the text extracted from the PDF. A quote can be missing because it was paraphrased or invented, or because it sits in a table, an equation or a scanned page that text extraction cannot read. A claim whose quotes are all missing is marked needs-review; open it and look at the page.`,
  healthQuotesCheck: "Check the quotes against the PDF",
  healthQuotesRecheck: "Check again with the PDF",
  healthQuotesPage: (page) => (page ? `p. ${page}` : "no page"),
  permalinkTitle: "Copy a link to this",
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
