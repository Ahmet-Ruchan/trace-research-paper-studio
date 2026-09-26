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
  /** Sayılar makaleden değil; öğretim aracı onları gösterim için seçti. */
  illustrativeValues: string;
  /** Hikâye bölümünün başında, dayandığı ön bilgi kavramları. */
  beforeThisSection: string;
  closeDefinition: string;
  result: string;
  // Quiz
  checkAnswer: string;
  checkAgain: string;
  correct: string;
  correctAfter: (attempts: number) => string;
  notQuite: string;
  missingOption: string;
  tryAgain: string;
  showAnswer: string;
  answerShown: string;
  whereToLook: string;
  score: (firstTry: number, attempted: number) => string;
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
  // Rehberli çalışma
  studyHeading: string;
  studyPhases: Record<"prepare" | "read" | "work" | "check" | "apply" | "review", string>;
  studyStepOf: (step: number, total: number) => string;
  studyDoneOf: (done: number, total: number) => string;
  studyProgress: string;
  studyAllSteps: string;
  studyStartTitle: string;
  studyAhead: string;
  studyAheadConcepts: (count: number) => string;
  studyAheadSections: (count: number, checks: number) => string;
  studyAheadWork: (count: number) => string;
  studyAheadQuiz: (count: number) => string;
  studyAheadGuide: string;
  studyCheckTitle: string;
  studyCheckIntro: string;
  studyFinalTitle: string;
  studyFinalIntro: string;
  studyYourAnswer: (answer: { correct: boolean; attempts: number; revealed: boolean }) => string;
  studyAnswerAgain: string;
  studyBack: string;
  studyNext: string;
  studyBegin: string;
  studySkipCheck: string;
  studyToResults: string;
  studyFinishTitle: string;
  studyFinishSteps: (done: number, total: number) => string;
  studyFinishChecks: (firstTry: number, answered: number, total: number) => string;
  studyRevisit: string;
  studyRevisitHint: string;
  studyAllClear: string;
  studySkipped: string;
  studyMoreSteps: (count: number) => string;
  studyStartOver: string;
  studyStartOverConfirm: string;
  studyClear: string;
  studyKeep: string;
  studyBrowserNote: string;
  // Kabuk
  navPrimer: string;
  navPractice: string;
  tabLab: string;
  tabStory: string;
  tabPractice: string;
  tabTechnical: string;
  tabStudy: string;
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
  healthReviewed: string;
  healthReviewedNote: (approved: number, rejected: number, pending: number) => string;
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
  illustrativeValues: "Illustrative values, not from the paper",
  beforeThisSection: "Before this section:",
  closeDefinition: "Close the definition",
  result: "Result:",
  checkAnswer: "Check answer",
  checkAgain: "Check again",
  correct: "Correct",
  correctAfter: (attempts) => `Correct on attempt ${attempts}`,
  notQuite: "Not quite",
  missingOption: "Everything you picked is right, but another option is right too.",
  tryAgain: "Try again",
  showAnswer: "Show the answer",
  answerShown: "The answer",
  whereToLook: "Where the paper says it:",
  score: (firstTry, attempted) => `${firstTry} of ${attempted} right on the first try`,
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
  studyHeading: "Study this paper",
  studyPhases: { prepare: "Prepare", read: "Read", work: "Work it through", check: "Check", apply: "Apply", review: "Review" },
  studyStepOf: (step, total) => `Step ${step} of ${total}`,
  studyDoneOf: (done, total) => `${done} of ${total} done`,
  studyProgress: "Study progress",
  studyAllSteps: "All steps",
  studyStartTitle: "What this paper asks",
  studyAhead: "The path ahead",
  studyAheadConcepts: (count) => `${count} ${count === 1 ? "concept" : "concepts"} the paper assumes you know`,
  studyAheadSections: (count, checks) =>
    `${count} ${count === 1 ? "section" : "sections"} of the story${checks ? `, ${checks === count ? "each" : `${checks} of them`} ending in one question` : ""}`,
  studyAheadWork: (count) => `${count} ${count === 1 ? "derivation or exploration" : "derivations and explorations"} to work through`,
  studyAheadQuiz: (count) => `a final check of ${count} ${count === 1 ? "question" : "questions"}`,
  studyAheadGuide: "how to apply it in practice",
  studyCheckTitle: "Check yourself",
  studyCheckIntro: "One question on what you just read. Answer from memory before you look back.",
  studyFinalTitle: "Final check",
  studyFinalIntro: "The questions no section has asked yet.",
  studyYourAnswer: (answer) =>
    answer.correct
      ? answer.attempts === 1 ? "Last time: right on the first try." : `Last time: right after ${answer.attempts} tries.`
      : "Last time: you asked for the answer.",
  studyAnswerAgain: "Answer again",
  studyBack: "Back",
  studyNext: "Next",
  studyBegin: "Begin",
  studySkipCheck: "Skip the question",
  studyToResults: "See how it went",
  studyFinishTitle: "How it went",
  studyFinishSteps: (done, total) => `You worked through ${done} of ${total} steps.`,
  studyFinishChecks: (firstTry, answered, total) =>
    `${firstTry} of ${answered} ${answered === 1 ? "question" : "questions"} right on the first try${answered < total ? `; ${total - answered} not answered yet` : ""}.`,
  studyRevisit: "Worth another look",
  studyRevisitHint: "Where a question took more than one try, these are the steps it rests on.",
  studyAllClear: "Every question you answered was right on the first try.",
  studySkipped: "Not done yet",
  studyMoreSteps: (count) => `and ${count} more ${count === 1 ? "step" : "steps"}, in the list of all steps above.`,
  studyStartOver: "Start over",
  studyStartOverConfirm: "Clear your progress and answers?",
  studyClear: "Clear",
  studyKeep: "Keep",
  studyBrowserNote: "Your progress stays in this browser. It is not sent anywhere, and it is not part of the paper.",
  navPractice: "Learn & Try",
  tabLab: "Lab",
  tabStory: "Story",
  tabPractice: "Learn & Try",
  tabTechnical: "Technical",
  tabStudy: "Study",
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
  healthReviewed: "claims reviewed by a person",
  healthReviewedNote: (approved, rejected, pending) =>
    `${approved} approved, ${rejected} rejected${pending ? `, ${pending} not looked at yet` : ""}. A person's decision is kept apart from the model's own confidence.`,
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
