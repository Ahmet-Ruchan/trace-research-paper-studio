/**
 * Görsellerin arayüz metinleri, iki dilde: İngilizce ve Türkçe.
 *
 * Makale içeriği onu üreten modelin yazdığı dilde kalıyor; bu dosya yalnızca
 * çevresindeki etiketleri taşıyor. İkisi ayrı: kanıta bağlı metni çevirmek
 * alıntıyı bozar.
 *
 * Bu paket eklentinin bağımsız görüntüleyicisine ve dışa aktarılan dosyalara
 * da giriyor; o yüzden saf TypeScript: `@/i18n/*` kaydını içine çekmiyor.
 * Dışa aktarımların (rapor, slayt, defter) etiketleri de burada, aynı
 * kuralla: makale Türkçeyse Türkçe, değilse İngilizce.
 */
import { READING_DRILL_WORDS, type ReadingDrillWords } from "@/lib/reading-drill";
import type { Claim, DeepReport, Misreading, Source } from "@/lib/schema";

/** BCP-47 dil etiketi; artık iki dille sınırlı değil. */
export type Language = string;

/** Görsellerin konuştuğu arayüz dilleri; stüdyonun `UiLanguage`'ıyla aynı. */
export type ChromeLanguage = "en" | "tr";

/** Raporun başındaki not için kanıt özeti. */
export type ReportSummary = {
  verified: number;
  total: number;
  /** Alıntılar PDF ile karşılaştırıldıysa. */
  quotes?: { located: number; total: number };
  /** Bir kişi en az bir iddiaya karar verdiyse. */
  reviews?: { approved: number; rejected: number };
};

type ClaimKind = Claim["kind"];
type ReportKind = DeepReport["sections"][number]["kind"];

export type Strings = {
  /** Sıralama ve büyük/küçük harf dönüşümü için BCP-47 etiketi. */
  locale: string;
  /** Etiketlerin dili: kök `lang` ve arayüz metnindeki tarihler için. */
  chrome: ChromeLanguage;
  // Ortak
  sourceLabel: string;
  page: (page: number) => string;
  evidenceLabel: string;
  /** Ekran okuyucu için yüzde: "80%" / "%80". */
  percent: (value: number) => string;
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
  // Hikâye görselleri
  architectureConnections: string;
  // Ön bilgi
  levels: Record<"temel" | "orta" | "ileri", string>;
  whyItMatters: string;
  readFirst: string;
  // Önce tahmin
  predictHeading: string;
  predictIntro: (label: string, min: string, max: string) => string;
  curveShapes: Record<"rises" | "falls" | "flat" | "peak" | "valley", string>;
  predictCross: (left: string, right: string) => string;
  predictCrossYes: string;
  predictCrossNo: string;
  predictShow: string;
  predictSkip: string;
  predictRight: string;
  predictWrong: string;
  curveActual: (shape: string, start: string, end: string, flat: boolean) => string;
  crossActual: (xParam: string, at?: string) => string;
  predictScore: (right: number, total: number) => string;
  nextStepQuestion: string;
  justShowIt: string;
  stepCalled: string;
  stepComesAt: (text: string, position: number) => string;
  stepsCalled: (right: number, total: number) => string;
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
  // Yanlış okumalar
  misreadingTempting: string;
  misreadingActually: string;
  misreadingReveal: string;
  /** Yanlış okumanın türü; arayüz ve rapor aynı adı kullanıyor. */
  misreadingTraps: Record<Misreading["trap"], string>;
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
  studyAheadMisreadings: (count: number) => string;
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
  studySaveFile: string;
  studyLoadFile: string;
  studyCarryHint: string;
  studyLoaded: (steps: number, answers: number, cards: number) => string;
  studyLoadOtherPaper: (title: string) => string;
  studyLoadInvalid: string;
  studyNothingToSave: string;
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
  /** Görüntüleyicide iddianın türü (İngilizcede şemadaki değer olduğu gibi). */
  claimKindBadge: Record<ClaimKind, string>;
  /** Görüntüleyicide rapor bölümünün türü (İngilizcede şemadaki değer olduğu gibi). */
  reportKindBadge: Record<ReportKind, string>;
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
  /** Kaynağın türü etiketi. */
  sourceTypes: Record<Source["type"], string>;
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
  /** Bulunamayan alıntının sahibi iddia değilse: ölçüm ya da sözlük maddesi. */
  healthOwners: Record<"metric" | "glossary", string>;
  healthQuotesCheck: string;
  healthQuotesRecheck: string;
  healthQuotesPage: (page?: number) => string;
  healthReviewed: string;
  healthReviewedNote: (approved: number, rejected: number, pending: number) => string;
  // Kalıcı bağlantı
  permalinkTitle: string;
  /** "Hakem gibi oku" alıştırması (`reading-drill.ts`); mührü dilden bağımsız. */
  drill: ReadingDrillWords;
  // Dışa aktarılan rapor (Markdown ve yazdırılabilir HTML)
  reportIntro: (summary: ReportSummary) => string;
  reportRestsOn: (references: string) => string;
  reportMethod: string;
  reportNumbers: string;
  reportTableHead: readonly [measurement: string, value: string, context: string, source: string];
  reportMisreading: (misreading: string) => string;
  reportLedger: string;
  /** İddianın türü, raporda. */
  claimKinds: Record<ClaimKind, string>;
  reportVerifiedByModel: string;
  reportNeedsReview: string;
  reportQuoteNotFound: string;
  reportReview: (status: "approved" | "rejected", by: string) => string;
  reportReviewerNote: (note: string) => string;
  reportSources: string;
  printTitle: (title: string) => string;
  printHint: string;
  // Slaytlar
  slidesTitle: (title: string) => string;
  slidesThesisKicker: string;
  slidesNumbersHeading: string;
  slidesLimitsKicker: string;
  slidesLimitsHeading: string;
  slidesHint: string;
  // Jupyter defteri
  notebookIntro: string;
  notebookLeftOut: string;
  notebookUntranslatable: string;
  notebookInPaper: (anchor: string) => string;
  notebookConfigComment: string;
  notebookSweepComment: (label: string) => string;
};

const en: Strings = {
  locale: "en",
  chrome: "en",
  sourceLabel: "View source",
  page: (page) => `p. ${page}`,
  evidenceLabel: "View evidence",
  percent: (value) => `${value}%`,
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
  architectureConnections: "Architecture connections",
  levels: { temel: "Basic", orta: "Intermediate", ileri: "Advanced" },
  whyItMatters: "Why this paper needs it:",
  readFirst: "Read these first:",
  predictHeading: "Predict first",
  predictIntro: (label, min, max) => `Before you see the chart: as ${label} goes from ${min} to ${max}, with everything else at the paper's values, what happens?`,
  curveShapes: {
    rises: "It rises",
    falls: "It falls",
    flat: "It stays about the same",
    peak: "It rises, then falls",
    valley: "It falls, then rises",
  },
  predictCross: (left, right) => `Do “${left}” and “${right}” cross?`,
  predictCrossYes: "Yes, they cross",
  predictCrossNo: "No, they never meet",
  predictShow: "Check and show the chart",
  predictSkip: "Just show the chart",
  predictRight: "You called it.",
  predictWrong: "Not quite.",
  curveActual: (shape, start, end, flat) => (flat ? `${shape}: ${start} throughout.` : `${shape}: from ${start} to ${end}.`),
  crossActual: (xParam, at) => (at === undefined ? "They never cross in this range." : `They cross near ${xParam} = ${at}.`),
  predictScore: (right, total) => `${right} of ${total} ${total === 1 ? "prediction" : "predictions"} right.`,
  nextStepQuestion: "Which step comes next?",
  justShowIt: "Just show it",
  stepCalled: "You called it.",
  stepComesAt: (text, position) => `You picked “${text}”: true, but that is step ${position}.`,
  stepsCalled: (right, total) => `You called ${right} of ${total} ${total === 1 ? "step" : "steps"} before seeing ${total === 1 ? "it" : "them"}.`,
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
  misreadingTempting: "Tempting to conclude:",
  misreadingActually: "What the paper shows",
  misreadingReveal: "Why this is wrong",
  misreadingTraps: {
    "interpretation-as-result": "An interpretation read as a result",
    "beyond-tested": "Beyond what was tested",
    number: "A misread number",
    mechanism: "How the method works",
  },
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
  studyAheadMisreadings: (count) => `${count} common ${count === 1 ? "misreading" : "misreadings"} of this paper to see through`,
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
  studySaveFile: "Save progress to a file",
  studyLoadFile: "Load progress from a file",
  studyCarryHint:
    "To continue on another device, save your progress to a file and load it there: on the published page, the exported page or in the studio. It merges with what is there instead of replacing it.",
  studyLoaded: (steps, answers, cards) =>
    `Progress loaded and merged with what was here: ${steps} ${steps === 1 ? "step" : "steps"} done, ${answers} ${answers === 1 ? "answer" : "answers"}, ${cards} review ${cards === 1 ? "card" : "cards"}.`,
  studyLoadOtherPaper: (title) => `That file holds progress for another paper: ${title}. Nothing was changed.`,
  studyLoadInvalid: "That file is not Trace study progress. Nothing was changed.",
  studyNothingToSave: "There is no progress to save yet.",
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
  claimKindBadge: {
    "reported-result": "reported-result",
    "author-interpretation": "author-interpretation",
    method: "method",
    background: "background",
    limitation: "limitation",
  },
  reportKindBadge: {
    contribution: "contribution",
    mechanism: "mechanism",
    experiment: "experiment",
    critique: "critique",
    reproduction: "reproduction",
    implication: "implication",
  },
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
  sourceTypes: { paper: "paper", web: "web" },
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
  healthOwners: { metric: "metric", glossary: "glossary" },
  healthQuotesCheck: "Check the quotes against the PDF",
  healthQuotesRecheck: "Check again with the PDF",
  healthQuotesPage: (page) => (page ? `p. ${page}` : "no page"),
  healthReviewed: "claims reviewed by a person",
  healthReviewedNote: (approved, rejected, pending) =>
    `${approved} approved, ${rejected} rejected${pending ? `, ${pending} not looked at yet` : ""}. A person's decision is kept apart from the model's own confidence.`,
  permalinkTitle: "Copy a link to this",
  drill: READING_DRILL_WORDS,
  reportIntro: ({ verified, total, quotes, reviews }) =>
    `An evidence-grounded reading made with Trace. ${verified} of ${total} claims are marked verified by the model. ` +
    (quotes ? `${quotes.located} of ${quotes.total} quotes were found in the text of the page they cite.` : "The quotes were not checked against the PDF.") +
    (reviews ? ` A person approved ${reviews.approved} claims and rejected ${reviews.rejected}.` : "") +
    " This is not a substitute for the paper.",
  reportRestsOn: (references) => `Rests on: ${references}`,
  reportMethod: "Method",
  reportNumbers: "Reported numbers",
  reportTableHead: ["Measurement", "Value", "Context", "Source"],
  reportMisreading: (misreading) => `Misreading: ${misreading}`,
  reportLedger: "Evidence ledger",
  claimKinds: {
    "reported-result": "Reported result",
    "author-interpretation": "Author interpretation",
    method: "Method",
    background: "Background",
    limitation: "Limitation",
  },
  reportVerifiedByModel: "verified by the model",
  reportNeedsReview: "needs review",
  reportQuoteNotFound: "quote not found on its page",
  reportReview: (status, by) => `${status} by ${by}`,
  reportReviewerNote: (note) => `Reviewer's note: ${note}`,
  reportSources: "Sources",
  printTitle: (title) => `${title} — Trace report`,
  printHint: "To save this as a PDF, print the page (Ctrl/Cmd + P) and choose “Save as PDF”. This note is not printed.",
  slidesTitle: (title) => `${title} — slides`,
  slidesThesisKicker: "The claim of the paper",
  slidesNumbersHeading: "What the paper measured",
  slidesLimitsKicker: "Before you build on it",
  slidesLimitsHeading: "What the paper says it cannot do",
  slidesHint: "← → to move · N for the full text",
  notebookIntro:
    "The equations below were generated by Trace from the paper's interactive playgrounds. Each one is translated from a parsed formula, not pasted as text, and starts at the value the paper itself uses. Moving away from that value leaves the region the paper verified.",
  notebookLeftOut: "Left out because they could not be translated exactly:",
  notebookUntranslatable: "could not be translated",
  notebookInPaper: (anchor) => `In the paper: ${anchor}`,
  notebookConfigComment: "The paper's own configuration",
  notebookSweepComment: (label) => `Sweep ${label} over the range the playground uses; everything else stays at the paper's value.`,
};

/**
 * Türkçe arayüz metinleri. `Strings` ile yazıldığı için eksik anahtar
 * derlemede yakalanıyor. Terimler `src/i18n/glossary.md` ile aynı.
 */
const tr: Strings = {
  locale: "tr",
  chrome: "tr",
  sourceLabel: "Kaynağı gör",
  page: (page) => `s. ${page}`,
  evidenceLabel: "Kanıtı gör",
  percent: (value) => `%${value}`,
  playgroundKind: "Deneme alanı",
  simulationKind: "Simülasyon",
  explorerKind: "Veri gezgini",
  resetToPaper: "Makalenin değerlerine dön",
  paperValueShort: "makalede",
  offPaperWarning: (anchor) =>
    `Makalenin aralığının dışındasın — bu değerler doğrulanmadı. ${anchor}`,
  notComputable: "burada tanımsız",
  chartPaperKey: "makalenin değeri",
  back: "‹ Geri",
  forward: "İleri ›",
  play: "Oynat",
  pause: "Duraklat",
  replay: "Yeniden oynat",
  filterPlaceholder: "Filtrele…",
  filterAria: "Tabloyu filtrele",
  emptyRows: "Filtreye uyan satır yok.",
  architectureConnections: "Mimari bağlantılar",
  levels: { temel: "Temel", orta: "Orta", ileri: "İleri" },
  whyItMatters: "Makalede neden gerekli:",
  readFirst: "Önce bunları oku:",
  predictHeading: "Önce tahmin et",
  predictIntro: (label, min, max) => `Grafiği görmeden önce: ${label}, ${min} değerinden ${max} değerine giderken ve geri kalan her şey makalenin değerlerindeyken ne olur?`,
  curveShapes: {
    rises: "Artar",
    falls: "Azalır",
    flat: "Aşağı yukarı aynı kalır",
    peak: "Önce artar, sonra azalır",
    valley: "Önce azalır, sonra artar",
  },
  predictCross: (left, right) => `“${left}” ile “${right}” kesişir mi?`,
  predictCrossYes: "Evet, kesişirler",
  predictCrossNo: "Hayır, hiç buluşmazlar",
  predictShow: "Kontrol et ve grafiği göster",
  predictSkip: "Grafiği doğrudan göster",
  predictRight: "Bildin.",
  predictWrong: "Tam değil.",
  curveActual: (shape, start, end, flat) => (flat ? `${shape}: baştan sona ${start}.` : `${shape}: ${start} değerinden ${end} değerine.`),
  crossActual: (xParam, at) => (at === undefined ? "Bu aralıkta hiç kesişmiyorlar." : `${xParam} = ${at} civarında kesişiyorlar.`),
  predictScore: (right, total) => `${total} tahminden ${right} tanesi doğru.`,
  nextStepQuestion: "Sıradaki adım hangisi?",
  justShowIt: "Doğrudan göster",
  stepCalled: "Bildin.",
  stepComesAt: (text, position) => `Seçtiğin: “${text}”. Doğru bir adım, ama sırası ${position}.`,
  stepsCalled: (right, total) => `${total} adımdan ${right} tanesini görmeden bildin.`,
  goal: "Amaç:",
  nextStep: (shown, total) => `Sonraki adımı göster (${shown}/${total})`,
  numericExample: "Çözümlü örnek",
  illustrativeValues: "Örnek değerler, makaleden değil",
  beforeThisSection: "Bu bölümden önce:",
  closeDefinition: "Tanımı kapat",
  result: "Sonuç:",
  checkAnswer: "Cevabı kontrol et",
  checkAgain: "Yeniden kontrol et",
  correct: "Doğru",
  correctAfter: (attempts) => `${attempts}. denemede doğru`,
  notQuite: "Tam değil",
  missingOption: "Seçtiklerinin hepsi doğru, ama doğru olan başka bir seçenek daha var.",
  tryAgain: "Yeniden dene",
  showAnswer: "Cevabı göster",
  answerShown: "Cevap",
  whereToLook: "Makalede nerede geçiyor:",
  score: (firstTry, attempted) => `${attempted} sorudan ${firstTry} tanesi ilk denemede doğru`,
  misreadingTempting: "Şu sonuca varmak cazip:",
  misreadingActually: "Makalenin gösterdiği",
  misreadingReveal: "Bu neden yanlış",
  misreadingTraps: {
    "interpretation-as-result": "Sonuç sanılan bir yorum",
    "beyond-tested": "Denenenin ötesine geçmek",
    number: "Yanlış okunan bir sayı",
    mechanism: "Yöntemin nasıl çalıştığı",
  },
  hyperparameters: "Hiperparametre seçimi",
  pitfalls: "Sık yapılan hatalar",
  pitfallCause: "Neden:",
  pitfallFix: "Çözüm:",
  whenNotToUse: "Ne zaman kullanılmamalı",
  guideParameter: "Parametre",
  guidePaperValue: "Makaledeki değer",
  guideRange: "Aralık",
  guideHowToChoose: "Nasıl seçilir",
  navPrimer: "Ön bilgi",
  studyHeading: "Bu makaleyi çalış",
  studyPhases: { prepare: "Hazırlık", read: "Okuma", work: "Üzerinde çalışma", check: "Kontrol", apply: "Uygulama", review: "Tekrar" },
  studyStepOf: (step, total) => `Adım ${step} / ${total}`,
  studyDoneOf: (done, total) => `${done}/${total} tamamlandı`,
  studyProgress: "Çalışma ilerlemesi",
  studyAllSteps: "Tüm adımlar",
  studyStartTitle: "Bu makale neyi soruyor",
  studyAhead: "Önündeki yol",
  studyAheadConcepts: (count) => `makalenin bildiğini varsaydığı ${count} kavram`,
  studyAheadSections: (count, checks) =>
    `hikâyenin ${count} bölümü${checks ? (checks === count ? ", her biri tek bir soruyla bitiyor" : `, ${checks} tanesi tek bir soruyla bitiyor`) : ""}`,
  studyAheadWork: (count) => `üzerinde çalışacağın ${count} ${count === 1 ? "türetim ya da keşif" : "türetim ve keşif"}`,
  studyAheadQuiz: (count) => `${count} soruluk bir son kontrol`,
  studyAheadGuide: "uygulamada nasıl kullanılacağı",
  studyAheadMisreadings: (count) => `bu makalenin fark etmen gereken ${count} yaygın yanlış okuması`,
  studyCheckTitle: "Kendini sına",
  studyCheckIntro: "Az önce okuduğun yerle ilgili tek bir soru. Geri dönüp bakmadan, aklında kalanla cevapla.",
  studyFinalTitle: "Son kontrol",
  studyFinalIntro: "Henüz hiçbir bölümün sormadığı sorular.",
  studyYourAnswer: (answer) =>
    answer.correct
      ? answer.attempts === 1 ? "Geçen sefer: ilk denemede doğru." : `Geçen sefer: ${answer.attempts} denemede doğru.`
      : "Geçen sefer: cevabı açmıştın.",
  studyAnswerAgain: "Yeniden cevapla",
  studyBack: "Geri",
  studyNext: "İleri",
  studyBegin: "Başla",
  studySkipCheck: "Soruyu atla",
  studyToResults: "Nasıl geçtiğine bak",
  studyFinishTitle: "Nasıl geçti",
  studyFinishSteps: (done, total) => `${total} adımın ${done} tanesini tamamladın.`,
  studyFinishChecks: (firstTry, answered, total) =>
    `${answered} sorudan ${firstTry} tanesi ilk denemede doğru${answered < total ? `; ${total - answered} soru henüz cevaplanmadı` : ""}.`,
  studyRevisit: "Bir kez daha bakmaya değer",
  studyRevisitHint: "Birden fazla deneme gerektiren soruların dayandığı adımlar bunlar.",
  studyAllClear: "Cevapladığın her soruyu ilk denemede bildin.",
  studySkipped: "Henüz yapılmadı",
  studyMoreSteps: (count) => `ve ${count} adım daha; hepsi yukarıdaki tüm adımlar listesinde.`,
  studyStartOver: "Baştan başla",
  studyStartOverConfirm: "İlerlemen ve cevapların silinsin mi?",
  studyClear: "Sil",
  studyKeep: "Kalsın",
  studyBrowserNote: "İlerlemen bu tarayıcıda kalıyor. Hiçbir yere gönderilmiyor ve makalenin bir parçası değil.",
  studySaveFile: "İlerlemeyi dosyaya kaydet",
  studyLoadFile: "İlerlemeyi dosyadan yükle",
  studyCarryHint:
    "Başka bir cihazda devam etmek için ilerlemeni bir dosyaya kaydet ve orada yükle: yayımlanmış sayfada, dışa aktarılan sayfada ya da stüdyoda. Oradakinin yerine geçmiyor, onunla birleşiyor.",
  studyLoaded: (steps, answers, cards) =>
    `İlerleme yüklendi ve buradakiyle birleşti: ${steps} adım tamamlandı, ${answers} cevap, ${cards} tekrar kartı.`,
  studyLoadOtherPaper: (title) => `Bu dosya başka bir makalenin ilerlemesini taşıyor: ${title}. Hiçbir şey değişmedi.`,
  studyLoadInvalid: "Bu dosya bir Trace çalışma ilerlemesi değil. Hiçbir şey değişmedi.",
  studyNothingToSave: "Henüz kaydedilecek bir ilerleme yok.",
  navPractice: "Öğren ve Dene",
  tabLab: "Lab",
  tabStory: "Hikâye",
  tabPractice: "Öğren ve Dene",
  tabTechnical: "Teknik",
  tabStudy: "Çalış",
  practiceHeading: "Öğren ve Dene",
  derivationsHeading: "Adım adım türetimler",
  interactivesHeading: "Etkileşimli keşif",
  tryItHeading: "Şimdi kendin dene",
  localStudio: "Yerel makale stüdyosu",
  exportedCopy: "Bağımsız kopya",
  publishedStory: "Yayımlanmış hikâye",
  thesis: "Tez",
  plainSummary: "Sade bir dille",
  researchQuestion: "Araştırma sorusu",
  methodsFindingsLimits: "Yöntemler, bulgular, sınırlılıklar",
  methods: "Yöntemler",
  findings: "Bulgular",
  limitations: "Sınırlılıklar",
  metrics: "Ölçümler",
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
  paperMap: "Makale haritası",
  linkedSources: "bağlı kaynaklar",
  pickAClaim: "Bir iddia seç",
  pickAClaimHint: "Nereden geldiğini görmek için bir bulguya ya da hikâyedeki bir kaynak etiketine tıkla.",
  claimKindBadge: {
    "reported-result": "bildirilen sonuç",
    "author-interpretation": "yazarın yorumu",
    method: "yöntem",
    background: "arka plan",
    limitation: "sınırlılık",
  },
  reportKindBadge: {
    contribution: "katkı",
    mechanism: "mekanizma",
    experiment: "deney",
    critique: "eleştiri",
    reproduction: "yeniden üretim",
    implication: "çıkarım",
  },
  openInStudio: "Stüdyoda aç",
  studioOfflineTitle: "Trace Studio çalışmıyor",
  studioOfflineBody: "Stüdyo tam çalışma alanı: kütüphane, düzenleme ve yan yana makaleler. Bu komutla bir kez başlat, sonra teslimi yeniden çalıştır; proje kendiliğinden oraya düşer.",
  studioOfflineNote: "Bu sayfadaki her şey stüdyo olmadan da çalışıyor; yukarıdaki Trace JSON da senin, istediğin zaman bir stüdyoya içe aktarabilirsin.",
  studioTryAnyway: "Zaten çalışıyor mu? localhost:3000 adresini aç",
  studioBanner: "Bu, makalenin taşınabilir kopyası. Tam stüdyo (kütüphane, düzenleme, yan yana makaleler) tek bir komut uzağında.",
  studioBannerAction: "Komutu göster",
  copyCommand: "Komutu kopyala",
  copied: "Kopyalandı",
  close: "Kapat",
  labSectionsAria: "Makale analizinin bölümleri",
  figuresHeading: "Makaledeki şekiller",
  figureExpand: "Tam boyutta gör",
  figureCollapse: "Genişliğe sığdır",
  figureFromPaper: (page) => `Makaleden · s. ${page}`,
  navHealth: "Kanıt sağlığı",
  healthHeading: "Kanıt sağlığı",
  healthIntro:
    "Aşağıdaki her şey bu projenin kendi verisinden hesaplandı; hiçbir modele sorulmadı. Analizin nerede sağlam zemine bastığını, nerede basmadığını gösteriyor.",
  healthVerified: "doğrulanmış iddia",
  healthVerifiedNote: (needsReview) =>
    needsReview === 0
      ? "Her iddianın alıntısı ifadesini doğrudan destekliyor."
      : `${needsReview} iddia hâlâ “incelenmeli” olarak işaretli: alıntı onları yalnızca kısmen destekliyor.`,
  healthPages: "ulaşılan sayfa",
  healthPagesNote: (first, last, gaps) =>
    gaps === 0
      ? `s. ${first} ile s. ${last} arası kesintisiz.`
      : `s. ${first} ile s. ${last} arası; ${gaps} sayfaya hiç atıf yok.`,
  healthPagesNone: "Hiçbir iddia sayfa numarası taşımıyor; bu analiz yalnızca web bağlamına dayanıyor.",
  healthInUse: "kullanılan iddia",
  healthInUseNote: (unused) =>
    unused === 0
      ? "Toplanan her iddia anlatıda bir yerde kullanılıyor."
      : `${unused} iddia toplandı ama hiç kullanılmadı.`,
  healthGrounding: "Kanıt nereden geliyor",
  healthGroundingNote: (fromPaper, fromWeb) =>
    fromWeb === 0
      ? `${fromPaper} iddianın hepsi doğrudan makaleye dayanıyor.`
      : `${fromPaper} iddia makaleden, ${fromWeb} iddia makale hakkında yayımlanmış bağlamdan geliyor: atıf sayıları, yayın yeri, sürüm geçmişi. Bağlam, makalenin bir iddiası değildir.`,
  healthCitations: (count) => `${count} atıf`,
  healthNeverCited: "hiç atıf yok",
  sourceTypes: { paper: "makale", web: "internet" },
  healthGaps: "Analizin hiç ulaşmadığı sayfalar",
  healthGapsNote: (first, last) =>
    `Makalenin toplam uzunluğu Trace projesinde saklanmıyor; bu yüzden yalnızca atıf yapılan ilk ve son sayfa arasındaki aralık (s. ${first}–${last}) değerlendirilebiliyor. Bu sayfalar o aralığın içinde ve hiçbir iddia, ölçüm ya da şekil onlara dokunmuyor.`,
  healthThin: "İnce kanıta dayanan bölümler",
  healthThinNote:
    "Bir bölüm tek bir iddiaya dayanıyorsa ya da altındaki iddiaların hiçbiri doğrulanmamışsa incedir. Bu illa yanlış olduğu anlamına gelmez; ama ilk bakılacak yer orası.",
  healthSectionClaims: (verified, total) => `${verified}/${total} doğrulandı`,
  healthStrengthen: "Güçlendir",
  healthAreaStory: "Hikâye",
  healthAreaReport: "Rapor",
  healthUnused: "Toplandı ama kullanılmadı",
  healthUnusedNote:
    "Bu iddialar kanıt defterinde duruyor ama hiçbir bölüm, denklem ya da şekil onlara başvurmuyor. Çoğu zaman en ilginç artıklar bunlardır.",
  healthQuotes: "sayfasında bulunan alıntı",
  healthQuotesNote: (missing) =>
    missing === 0
      ? "Her alıntı, atıf yaptığı sayfanın metninde bulundu."
      : `${missing} alıntı atıf yapılan sayfada bulunamadı.`,
  healthQuotesUnchecked: "alıntılar denetlenmedi",
  healthQuotesUncheckedNote: "Alıntılar henüz PDF'in metniyle karşılaştırılmadı.",
  healthQuotesMissing: "Atıf yapılan sayfada bulunamayan alıntılar",
  healthQuotesMissingNote: (date) =>
    `${date} tarihinde PDF'ten çıkarılan metne karşı denetlendi. Bir alıntı başka sözlerle aktarıldığı ya da uydurulduğu için bulunamayabilir; metin çıkarmanın okuyamadığı bir tabloda, denklemde ya da taranmış bir sayfada duruyor da olabilir. Alıntılarının hiçbiri bulunamayan iddia “incelenmeli” olarak işaretlenir; onu aç ve sayfaya bak.`,
  healthOwners: { metric: "ölçüm", glossary: "sözlük" },
  healthQuotesCheck: "Alıntıları PDF ile karşılaştır",
  healthQuotesRecheck: "PDF ile yeniden karşılaştır",
  healthQuotesPage: (page) => (page ? `s. ${page}` : "sayfa yok"),
  healthReviewed: "bir kişinin incelediği iddia",
  healthReviewedNote: (approved, rejected, pending) =>
    `${approved} onaylandı, ${rejected} reddedildi${pending ? `, ${pending} henüz incelenmedi` : ""}. Bir kişinin kararı, modelin kendi güveninden ayrı tutuluyor.`,
  permalinkTitle: "Bunun bağlantısını kopyala",
  drill: {
    title: "Hakem gibi oku",
    intro:
      "Bir modelin değil, kanıtın kendisinden üretilen sorular: bir iddianın ne tür bir ifade olduğu, makalenin hangi cümlesine dayandığı ve makalenin hangi sayıyı bildirdiği. Her yanıt kendi sayfasında denetlenebilir.",
    kinds: {
      "reported-result": {
        option: "Bildirilen bir sonuç: yazarların ölçtüğü bir şey",
        meaning: "Bildirilen sonuç, yazarların ölçtüğü bir şeydir; çoğunlukla bir sayı ya da karşılaştırma.",
      },
      "author-interpretation": {
        option: "Yazarların bir sonucun ne anlama geldiğine dair yorumu",
        meaning: "Yorum, yazarların bir sonucu okuyuşudur; ölçülenin ötesine geçer.",
      },
      method: {
        option: "Yöntem: yazarların kurduğu ya da yaptığı şey",
        meaning: "Yöntem, yazarların kurduğu ya da yaptığı şeydir; ondan çıkan sonuç değil.",
      },
      background: {
        option: "Makalenin dayandığı arka plan",
        meaning: "Arka plan, makalenin dayandığı önceki çalışmalar ya da bilgidir; makalenin kendi bulgusu değil.",
      },
      limitation: {
        option: "Makalenin kabul ettiği bir sınırlılık",
        meaning: "Sınırlılık, makalenin kabul ettiği bir sınırdır: neyi denemediği ya da nerede geçerli olmayabileceği.",
      },
    },
    kindPrompt: (statement) => `Bu ne tür bir ifade? ${statement}`,
    kindRight: (meaning, page) => `${meaning} Bu cümle de tam olarak bu${page ? ` (s. ${page})` : ""}.`,
    kindWrong: (meaning) => `${meaning} Bu cümlenin yaptığı bu değil.`,
    quotePrompt: (statement) => `Makaledeki hangi cümle bu iddiayı destekliyor? ${statement}`,
    quoteRight: (page) => `İddianın dayandığı cümle bu${page ? ` (s. ${page})` : ""}.`,
    quoteOther: (statement) => `Bu cümle başka bir iddiayı destekliyor: ${statement}`,
    numberPrompt: (label) => `Makale şu ölçüm için hangi sayıyı bildiriyor: ${label}?`,
    numberRight: (context, excerpt, page) => `${context}. Makale: ${excerpt}${page ? ` (s. ${page})` : ""}`,
    numberOther: (label) => `Bu, makalenin şu ölçüm için verdiği sayı: ${label}.`,
  },
  reportIntro: ({ verified, total, quotes, reviews }) =>
    `Trace ile yapılmış, kanıta dayalı bir okuma. ${total} iddiadan ${verified} tanesini model doğrulanmış olarak işaretledi. ` +
    (quotes ? `${quotes.total} alıntıdan ${quotes.located} tanesi atıf yaptığı sayfanın metninde bulundu.` : "Alıntılar PDF ile karşılaştırılmadı.") +
    (reviews ? ` Bir kişi ${reviews.approved} iddiayı onayladı, ${reviews.rejected} iddiayı reddetti.` : "") +
    " Makalenin yerini tutmaz.",
  reportRestsOn: (references) => `Dayandığı iddialar: ${references}`,
  reportMethod: "Yöntem",
  reportNumbers: "Bildirilen sayılar",
  reportTableHead: ["Ölçüm", "Değer", "Bağlam", "Kaynak"],
  reportMisreading: (misreading) => `Yanlış okuma: ${misreading}`,
  reportLedger: "Kanıt defteri",
  claimKinds: {
    "reported-result": "Bildirilen sonuç",
    "author-interpretation": "Yazarın yorumu",
    method: "Yöntem",
    background: "Arka plan",
    limitation: "Sınırlılık",
  },
  reportVerifiedByModel: "model doğruladı",
  reportNeedsReview: "incelenmeli",
  reportQuoteNotFound: "alıntı sayfasında bulunamadı",
  reportReview: (status, by) => (status === "approved" ? `Onaylayan: ${by}` : `Reddeden: ${by}`),
  reportReviewerNote: (note) => `İnceleyenin notu: ${note}`,
  reportSources: "Kaynaklar",
  printTitle: (title) => `${title} — Trace raporu`,
  printHint: "PDF olarak kaydetmek için sayfayı yazdır (Ctrl/Cmd + P) ve “PDF olarak kaydet”i seç. Bu not yazdırılmaz.",
  slidesTitle: (title) => `${title} — slaytlar`,
  slidesThesisKicker: "Makalenin iddiası",
  slidesNumbersHeading: "Makalenin ölçtükleri",
  slidesLimitsKicker: "Üzerine kurmadan önce",
  slidesLimitsHeading: "Makalenin yapamadığını söyledikleri",
  slidesHint: "← → ile ilerle · tam metin için N",
  notebookIntro:
    "Aşağıdaki denklemleri Trace, makalenin etkileşimli deneme alanlarından üretti. Her biri metin olarak yapıştırılmadı, ayrıştırılmış bir formülden çevrildi ve makalenin kendi kullandığı değerle başlıyor. Bu değerden uzaklaşmak, makalenin doğruladığı bölgenin dışına çıkmak demek.",
  notebookLeftOut: "Birebir çevrilemedikleri için dışarıda kalanlar:",
  notebookUntranslatable: "çevrilemedi",
  notebookInPaper: (anchor) => `Makalede: ${anchor}`,
  notebookConfigComment: "Makalenin kendi yapılandırması",
  notebookSweepComment: (label) => `Tarama: ${label}, deneme alanının kullandığı aralık boyunca; geri kalan her şey makalenin değerinde.`,
};

const BCP47 = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * Görsellerin metinleri ve içeriğin `locale`'i.
 *
 * İki ayrı dil var:
 * - `locale` her zaman içeriğin dili: sayı ve tarih biçimleme, sıralama,
 *   harf dönüşümü ("i" → "İ") makalenin diline göre yapılmalı.
 * - Etiketler (`ui`) arayüzün dili. Stüdyo okuyucunun seçtiği dili veriyor.
 *   Verilmezse (bağımsız görüntüleyici, yayımlanmış hikâye, dışa aktarılan
 *   sayfa) içerik Türkçeyse Türkçe, değilse İngilizce: o sayfayı okuyan kişi
 *   stüdyonun seçimini bilmiyor, makalenin dili en iyi işaret.
 *
 * Etiket doğrudan `Intl`e gidiyor, o yüzden biçimi doğrulanıyor: bozuk bir
 * etiket orada `RangeError` fırlatır ve bileşeni komple düşürürdü.
 */
export function stringsFor(language: string | undefined, ui?: ChromeLanguage): Strings {
  const tag = language?.trim();
  const valid = Boolean(tag && BCP47.test(tag));
  const chrome = ui ?? (valid && tag!.toLowerCase().split("-")[0] === "tr" ? "tr" : "en");
  const base = chrome === "tr" ? tr : en;
  return valid ? { ...base, locale: tag! } : base;
}
