import type { EvidencePassId } from "@/lib/evidence-pipeline";
import type { BackupImportText } from "@/lib/full-backup";
import type { LearningBlockId } from "@/lib/learning-generation";
import type { ProviderDefinition } from "@/lib/model-providers";
import type { SectionKind } from "@/lib/section-regeneration";
import { providerProgressText, type ProviderProgressText } from "@/lib/server/provider-progress-text";
import { userErrorText, type UserErrorText } from "@/lib/user-error";

/**
 * `server` bölümü: API'lerin kullanıcıya yazdığı hatalar, üretim sırasında
 * stüdyoya akan ilerleme metinleri ve sunucunun başka yerde söyledikleri
 * (vekil, manifest). Rota isteği yapanın dilini `requestMessages(request)`
 * ile alıyor; istek görmeyen kütüphane kodu anahtarlı hata fırlatıyor
 * (`errors`, bkz. `src/lib/user-error.ts`).
 *
 * İngilizcesi kütüphanede duran sözlükler (`errors`, `progress`) oradan
 * geliyor. Ağır modüllerin adları (öğrenme blokları, bölüm türleri, kanıt
 * katmanları, yedek özeti) burada da yazılı: o modüller tarayıcı paketine
 * girmesin diye. İngilizcelerinin kütüphanedekiyle aynı kaldığını
 * `server-language.test.ts` denetliyor.
 */

type ProviderLike = Pick<ProviderDefinition, "id" | "label" | "keyLabel">;
type LearningGap = { block: LearningBlockId; reason: string };

const characters = (count: number, locale: string) => count.toLocaleString(locale);
const capitalTr = (text: string) => `${text.charAt(0).toLocaleUpperCase("tr")}${text.slice(1)}`;
const listTr = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ve ${items[items.length - 1]}`);

const LEARNING_BLOCKS_EN: Record<LearningBlockId, { noun: string; title: string }> = {
  primer: { noun: "the primer", title: "Writing the primer" },
  quiz: { noun: "the quiz", title: "Writing the quiz" },
  misreadings: { noun: "the common misreadings", title: "Writing the common misreadings" },
  derivations: { noun: "the derivations", title: "Writing the step-by-step derivations" },
  interactives: { noun: "the interactive explorations", title: "Building the playgrounds" },
  applicationGuide: { noun: "the application guide", title: "Writing the application guide" },
};

const LEARNING_BLOCKS_TR: Record<LearningBlockId, { noun: string; title: string }> = {
  primer: { noun: "ön bilgi", title: "Ön bilgi yazılıyor" },
  quiz: { noun: "test", title: "Test yazılıyor" },
  misreadings: { noun: "sık yapılan yanlış okumalar", title: "Sık yapılan yanlış okumalar yazılıyor" },
  derivations: { noun: "türetimler", title: "Adım adım türetimler yazılıyor" },
  interactives: { noun: "etkileşimli keşifler", title: "Oyun alanları kuruluyor" },
  applicationGuide: { noun: "uygulama rehberi", title: "Uygulama rehberi yazılıyor" },
};

const SECTION_KINDS_EN: Record<SectionKind, { label: string; noun: string }> = {
  story: { label: "story section", noun: "section" },
  report: { label: "report section", noun: "section" },
  primer: { label: "primer concept", noun: "concept" },
  quiz: { label: "quiz question", noun: "question" },
  derivation: { label: "derivation", noun: "derivation" },
  equation: { label: "equation", noun: "equation" },
};

const SECTION_KINDS_TR: Record<SectionKind, { label: string; noun: string }> = {
  story: { label: "hikâye bölümü", noun: "bölüm" },
  report: { label: "rapor bölümü", noun: "bölüm" },
  primer: { label: "ön bilgi kavramı", noun: "kavram" },
  quiz: { label: "test sorusu", noun: "soru" },
  derivation: { label: "türetim", noun: "türetim" },
  equation: { label: "denklem", noun: "denklem" },
};

const EVIDENCE_PASSES_EN: Record<EvidencePassId, string> = {
  overview: "Overview",
  methods: "Method and architecture",
  results: "Findings and metrics",
  limitations: "Limits and scope",
};

const EVIDENCE_PASSES_TR: Record<EvidencePassId, string> = {
  overview: "Genel bakış",
  methods: "Yöntem ve mimari",
  results: "Bulgular ve ölçümler",
  limitations: "Sınırlar ve kapsam",
};

/** Anahtarın adı, stüdyonun model ayarlarındakiyle aynı (`studio/models.ts`). */
const KEY_LABELS_TR: Record<string, string> = {
  gemini: "Gemini API anahtarı",
  openai: "OpenAI API anahtarı",
  anthropic: "Claude API anahtarı",
  openrouter: "OpenRouter API anahtarı",
  local: "Yerel sunucu adresi",
};

/** Model görevlerinin adları; hata metninde "kanıt görevi" gibi geçiyor. */
const TASK_ROLES_TR: Record<string, string> = {
  evidence: "kanıt",
  technical: "teknik",
  report: "rapor",
  visual: "görsel",
  teaching: "öğretim",
};

const backupCount = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

const en = {
  /** Kütüphane kodunun fırlattığı hatalar ve sağlayıcı hatasının söylenişi. */
  errors: userErrorText as UserErrorText,
  /** Sağlayıcı hazırlanırken akan ilerleme metinleri. */
  progress: providerProgressText as ProviderProgressText,

  /** Birçok rotanın ortak cevapları. */
  request: {
    invalidJson: "The request is not valid JSON.",
    projectIdRequired: "A project id is required.",
    notInLibrary: "The project is not in the library.",
    formDataUnreadable: "The submitted form data could not be read.",
    emptyOrTooLarge: "The request is empty or too large.",
    notValid: "The request is not valid.",
    projectInvalid: "The Trace project is not valid.",
    projectSchemaInvalid: (path: string, message: string | undefined) => `Invalid Trace project schema: ${path || "root"} · ${message ?? "unknown error"}`,
    modelSelectionInvalid: "The model and provider selection is not valid.",
    localAddressInvalid: "The local model address is not valid.",
    keyRequired: (provider: ProviderLike) => `${provider.keyLabel} is required.`,
    pdfTooLarge: "The PDF exceeds the 35 MB limit.",
  },

  /** Yapı ve ağ denemelerinin ilerleme ayrıntısı. */
  retry: {
    structure: (issues: number, attempt: number) => `Clearing ${issues} inconsistencies · structure attempt ${attempt}/2`,
    network: (attempt: number, max: number) => `Transient model error · network attempt ${attempt}/${max}`,
  },

  library: {
    readFailed: "The Trace library could not be read.",
    tooLarge: "The Trace JSON exceeds the 5 MB limit.",
    unknownReason: "Unknown save reason.",
    saveFailed: "The Trace project could not be saved.",
    deleteFailed: "The Trace project could not be deleted.",
  },
  tags: {
    readFailed: "The library tags could not be read.",
    tooLarge: "The tag list is too large.",
    invalid: "The tag list is not valid.",
    saveFailed: "The tags could not be saved.",
  },
  study: {
    readFailed: "The study progress could not be read.",
    tooLarge: "The study progress is too large.",
    invalid: "The study progress is not valid.",
    saveFailed: "The study progress could not be saved.",
  },
  notes: {
    readFailed: "Your notes could not be read.",
    tooLarge: "The notes are too large.",
    invalid: "The notes are not valid.",
    saveFailed: "Your notes could not be saved.",
  },
  readingList: {
    readFailed: "The reading list could not be read.",
    tooLarge: "The paper's details are too large.",
    invalid: "The paper's details are not valid.",
    saveFailed: "The reading list could not be saved.",
    paperIdRequired: "A paper id is required.",
  },
  revisions: {
    idInvalid: "The revision id is not valid.",
    missing: "That revision does not exist.",
    readFailed: "The project history could not be read.",
    saveFirst: "Save the project before marking a version.",
    saveFailed: "The version could not be saved.",
  },
  aliases: {
    readFailed: "The concept links could not be read.",
    notConcepts: "Both names must be concepts of a paper in your library.",
    saveFailed: "The concept link could not be saved.",
    modelRequired: "A model and provider are required.",
    modelNotAsked: "The model could not be asked.",
  },
  obsidian: {
    exportFailed: "The library could not be exported.",
  },
  backup: {
    listFailed: "The backups could not be listed.",
    writeFailed: "The weekly backup could not be written.",
  },
  profile: {
    readFailed: "The profile could not be read.",
    tooLarge: "The profile is too large; use a smaller photo.",
    required: "A profile is required.",
    fieldInvalid: (path: string, message: string | undefined) => `${path || "profile"}: ${message ?? "not valid"}`,
    saveFailed: "The profile could not be saved.",
  },
  workLog: {
    readFailed: "The work log could not be read.",
    tooMany: "Too many sessions at once.",
    futureEnd: "A session cannot end in the future.",
    invalid: "The sessions are not valid.",
    saveFailed: "The sessions could not be saved.",
    idRequired: "A session id is required.",
    notFound: "The session is not in the work log.",
    deleteFailed: "The session could not be deleted.",
  },
  data: {
    readFailed: "Your data could not be read.",
    tooLarge: "The file is larger than 300 MB.",
    notTraceFile: "This is not a Trace data file.",
    invalidJson: "The file is not valid JSON.",
    importFailed: "Your data could not be imported.",
  },
  /** "Verilerimi içe aktar"ın özeti (`describeBackupImport`, `full-backup.ts`). */
  backupImport: {
    sessionsAdded: (sessions: number) => `${backupCount(sessions, "session", "sessions")} added`,
    profileAdopted: "the profile in the file taken over",
    papersAdded: (papers: number) => `${backupCount(papers, "paper", "papers")} added to your library`,
    papersKept: (papers: number) => `${backupCount(papers, "paper", "papers")} already here kept as they are`,
    studyMerged: (papers: number) => `study progress merged for ${backupCount(papers, "paper", "papers")}`,
    notesAdded: (notes: number) => `${backupCount(notes, "note", "notes")} added`,
    readingAdded: (works: number) => `${backupCount(works, "work", "works")} added to your reading list`,
    tagsMerged: (papers: number) => `tags merged for ${backupCount(papers, "paper", "papers")}`,
    aliasesAdded: (links: number) => `${backupCount(links, "concept link", "concept links")} added`,
    withoutPaper: (records: number) => `${backupCount(records, "record", "records")} left out because the paper is not in your library`,
    papersUnreadable: (papers: number) => `${backupCount(papers, "paper", "papers")} in the file could not be read`,
    sentence: (parts: readonly string[]) => {
      const text = parts.join(", ");
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}. Nothing was removed.`;
    },
  } satisfies BackupImportText as BackupImportText,
  templates: {
    readFailed: "The templates could not be read.",
    tooLarge: "The template is too large.",
    invalid: (path: string, message: string | undefined) => `Invalid template: ${path || "root"} · ${message ?? "unknown error"}`,
    saveFailed: "The template could not be saved.",
    idRequired: "A valid template id is required.",
    deleteFailed: "The template could not be deleted.",
  },
  publications: {
    invalid: (path: string, message: string | undefined) => `Invalid publication request: ${path || "root"} · ${message ?? "unknown error"}`,
    readFailed: "The publications could not be read.",
    saveFirst: "Save the project to the library before publishing it.",
    publishFailed: "The project could not be published.",
    missing: "That publication does not exist.",
    updateFailed: "The publication could not be updated.",
    deleteFailed: "The publication could not be deleted.",
  },
  team: {
    detailsInvalid: "The details are not valid.",
    changeFailed: "The team could not be changed.",
    memberIdRequired: "A member id is required.",
  },
  citations: {
    titleRequired: "A paper title is required.",
  },
  /** Alıntıyı sayfasında gösterme ve alıntıları PDF'e karşı denetleme. */
  excerpts: {
    pdfWithLimit: "Upload the paper's PDF (max. 35 MB).",
    pageAndQuote: "A page number and a quote are required.",
    locateFailed: "The quote could not be located.",
    pdfRequired: "Upload the paper's PDF.",
    evidenceMissing: "The project's evidence is missing or too large.",
    evidenceInvalid: "The project's evidence is not valid.",
    wrongPdf: (found: number, checked: number) =>
      `Only ${found} of ${checked} quotes were found in this PDF. It is probably a different paper or a different version, so nothing was changed.`,
    checkFailed: "The quotes could not be checked.",
  },
  openRouter: {
    keyRequired: "An OpenRouter API key is required.",
    keyInvalid: "The OpenRouter API key is not valid.",
    catalogueFailed: "The OpenRouter model catalogue could not be loaded.",
  },
  probe: {
    requestInvalid: "The model test request is not valid.",
    timedOut: (seconds: number, fullAnalysis: boolean) =>
      `The model did not finish a short test within ${seconds} s. ${fullAnalysis ? "A full analysis" : "A section"} would almost certainly exceed the limit. Pick a faster model.`,
  },
  resolve: {
    queryTooShort: "Enter a paper title, DOI, arXiv id or link.",
    lookupFailed: "The paper could not be looked up.",
    noPdfAddress: "No downloadable PDF address was given.",
    untitled: "Untitled paper",
  },
  ask: {
    questionTooShort: "Ask a question of at least three characters.",
  },
  explain: {
    length: (min: number, max: number) => `Write at least ${min} characters, at most ${max}.`,
    sectionMissing: "That section is not in the project.",
  },

  /** Mevcut bir projeye öğrenme katmanı (`/api/learning`) ve tam analizdeki öğrenme şeridi. */
  learningLayer: {
    requestInvalid: (path: string, message: string | undefined) => `The learning layer request is not valid: ${path || "root"} · ${message ?? "unknown error"}`,
    alreadyComplete: "This project already has its learning layer.",
    alreadyHas: (block: LearningBlockId) => `This project already has ${LEARNING_BLOCKS_EN[block].noun}. Regenerate its items one by one instead.`,
    tooLarge: "The project is too large to add a learning layer to.",
    unreadable: "The learning layer request could not be read.",
    preparing: "Preparing the teaching model.",
    preparingDetail: "The evidence is locked; the learning material is written from it alone, without the PDF.",
    writing: (block: LearningBlockId) => `${LEARNING_BLOCKS_EN[block].title}.`,
    part: (index: number, total: number) => `Part ${index}/${total} of the learning layer.`,
    received: (count: number, index: number, total: number) => `Received ${characters(count, "en")} characters · part ${index}/${total}`,
    relinking: (block: LearningBlockId) => `Relinking ${LEARNING_BLOCKS_EN[block].noun}.`,
    reconnecting: (block: LearningBlockId) => `Reconnecting for ${LEARNING_BLOCKS_EN[block].noun}.`,
    passed: "The learning material passed the evidence check.",
    allCited: "Every part cites only claims the evidence has.",
    /** Yazılamayan blokların tek cümlelik özeti (`describeLearningGaps` ile aynı). */
    gaps: (failed: readonly LearningGap[]) => {
      if (!failed.length) return undefined;
      const nouns = failed.map(({ block }) => LEARNING_BLOCKS_EN[block].noun);
      const list = nouns.length <= 1 ? (nouns[0] ?? "") : `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
      const reasons = [...new Set(failed.map(({ reason }) => reason))].join(" ");
      return `The learning layer is incomplete: ${list} could not be written. ${reasons} Everything else is complete; the missing parts can be added from the Lab.`;
    },
  },

  /** Tek bir bölümü yeniden üretmek (`/api/regenerate`). */
  regenerate: {
    requestInvalid: (path: string, message: string | undefined) => `The regeneration request is not valid: ${path || "root"} · ${message ?? "unknown error"}`,
    notFound: (kind: SectionKind, id: string) => `There is no ${SECTION_KINDS_EN[kind].label} with id "${id}" in this project.`,
    tooLarge: "The project is too large to regenerate a section of.",
    unreadable: "The regeneration request could not be read.",
    preparing: (kind: SectionKind) => `Preparing the ${SECTION_KINDS_EN[kind].label}.`,
    preparingDetail: (kind: SectionKind) => `The evidence is locked; only this ${SECTION_KINDS_EN[kind].noun} will be rewritten.`,
    streaming: (kind: SectionKind) => `Streaming the ${SECTION_KINDS_EN[kind].label}.`,
    received: (count: number) => `Received ${characters(count, "en")} characters.`,
    relinking: (kind: SectionKind) => `Relinking the ${SECTION_KINDS_EN[kind].label}.`,
    reconnecting: (kind: SectionKind) => `Reconnecting for the ${SECTION_KINDS_EN[kind].label}.`,
    passed: (kind: SectionKind) => `The ${SECTION_KINDS_EN[kind].noun} passed the evidence check.`,
    reviewFirst: "Review it before it replaces the current version.",
    failedTwice: (kind: SectionKind) =>
      `The regenerated ${SECTION_KINDS_EN[kind].noun} failed the evidence check on both attempts. Nothing was changed; try again, or relax the claim lock.`,
  },

  /** Tam analiz (`/api/generate`): girdinin denetimi ve akan ilerleme. */
  generate: {
    assignmentInvalid: "The per-task model assignment is not valid.",
    keyAssignmentInvalid: "The provider API key assignment is not valid.",
    pdfRequired: "You must upload a PDF file.",
    pdfOnly: "Only PDF files are supported.",
    claudePdfLimit: "The PDF limit for Claude is 24 MB; base64 encoding would push the request past its total limit.",
    cannotReadPdf: (provider: string, role: string) =>
      `${provider} cannot be given the PDF, so it cannot run the ${role} stage — that stage reads the paper itself. Assign a provider that reads documents to Evidence and Technical; ${provider} can still write the report and the visuals.`,
    sourcesInvalid: "The list of source URLs is not valid.",
    templateInvalidJson: "The narrative template is not valid JSON.",
    templateInvalid: "The narrative template is not valid.",
    templateUnusable: (problems: string) => `The narrative template cannot be used: ${problems}.`,
    /** Okunamayan destekleyici kaynağın uyarısı: "<adres>: <neden>". */
    sourceUnreadable: "could not be read",
    excerptCheckSkipped: {
      "missing-tool": "Quotes were not checked against the page text: pdftotext (Poppler) is not installed on the server.",
      "no-text": "Quotes were not checked against the page text: the PDF has no extractable text, it is probably a scan.",
      failed: "Quotes were not checked against the page text: the text could not be extracted from the PDF.",
    },
    preparingSources: "Preparing the sources in a sandbox.",
    checkingSources: (count: number) => `Checking the PDF along with ${count} supporting source(s).`,
    pdfValidated: "The PDF passed file validation before analysis.",
    textExtracted: "Extracted the paper's text for the local model.",
    textExtractedDetail: (pages: number) => `${pages} pages · page boundaries kept, so every claim still points at a page.`,
    resuming: "Resuming from the saved evidence stages.",
    resumingDetail: (done: number) => `${done}/4 stages will be reused; only the missing ones are generated.`,
    splitting: "Splitting the paper into four evidence layers.",
    splittingDetail: "At most two small model tasks run at a time.",
    extracting: (pass: EvidencePassId) => `Extracting ${EVIDENCE_PASSES_EN[pass]}.`,
    passWaiting: (done: number) => `${done}/4 stages complete · waiting for the structured stream`,
    passOmitted: (done: number, pages: string) =>
      `${done}/4 stages complete · pages ${pages} did not fit the local model's context and were left out of this stage`,
    streamingPass: (pass: EvidencePassId) => `Streaming ${EVIDENCE_PASSES_EN[pass]}.`,
    passReceived: (count: number, done: number) => `${characters(count, "en")} characters received · ${done}/4 stages complete`,
    recheckingPass: (pass: EvidencePassId) => `Rechecking ${EVIDENCE_PASSES_EN[pass]}.`,
    reconnectingPass: (pass: EvidencePassId) => `Reconnecting for ${EVIDENCE_PASSES_EN[pass]}.`,
    downgraded: (pass: EvidencePassId, claims: number) =>
      `${EVIDENCE_PASSES_EN[pass]}: ${claims} claim(s) quote text that could not be found on the cited page, so they were marked needs-review.`,
    passValidated: (pass: EvidencePassId) => `${EVIDENCE_PASSES_EN[pass]} validated.`,
    passValidatedDetail: (done: number) => `${done}/4 evidence stages complete and written to the checkpoint.`,
    overviewMissing: "The paper overview checkpoint could not be found.",
    merged: "The four evidence layers were merged.",
    mergedDetail: (claims: number, metrics: number, limitations: number) => `${claims} claims · ${metrics} metrics · ${limitations} limitations`,
    designing: "Designing the visual narrative, the deep report and the learning material.",
    designingDetail: "Different models run in parallel; tasks sharing one model run in a controlled sequence.",
    streamingStory: "Streaming the StorySpec.",
    storyReceived: (count: number) => `Received ${characters(count, "en")} characters of validated narrative.`,
    relinkingStory: "Relinking the story.",
    storyRetry: (issues: number, attempt: number) => `Clearing ${issues} narrative inconsistencies · structure attempt ${attempt}/2`,
    reconnectingStory: "Reconnecting for the story.",
    streamingReport: "Streaming the deep report.",
    reportReceived: (count: number) => `Received ${characters(count, "en")} characters of analytical report.`,
    relinkingReport: "Relinking the report.",
    reportRetry: (issues: number, attempt: number) => `Clearing ${issues} report inconsistencies · structure attempt ${attempt}/2`,
    reconnectingReport: "Reconnecting for the report.",
    preparingTechnical: "Preparing the technical appendix.",
    technicalReceived: (count: number) => `Received ${characters(count, "en")} characters of equation, algorithm and code analysis.`,
    relinkingTechnical: "Relinking the technical appendix.",
    technicalRetry: (issues: number, attempt: number) => `Clearing ${issues} technical inconsistencies · structure attempt ${attempt}/2`,
    reconnectingTechnical: "Reconnecting for the technical appendix.",
    learningStep: (index: number, total: number) => `Learning material ${index}/${total} · built from the evidence only, without the PDF.`,
    learningReceived: (count: number, index: number, total: number) => `Received ${characters(count, "en")} characters · learning material ${index}/${total}`,
    missingOutputs: "The model team did not produce every required output.",
    finalCheck: "Running the final integrity check.",
    finalCheckDetail: "Claims, pages, metrics and visual links are checked together.",
    cleaning: "Cleaning up temporary files.",
    cleaningDetail: (workspaces: number) => `Cleaning up ${workspaces} model workspace(s); no API key is retained.`,
  },

  /** Tarayıcıdaki istemcilerin yedek hataları: sunucu okunur bir hata vermediyse. */
  client: {
    libraryRequestFailed: (status: number) => `The Trace library request failed (HTTP ${status}).`,
    libraryEmpty: "The Trace library returned an empty response.",
    publicationRequestFailed: (status: number) => `The publication request failed (HTTP ${status}).`,
    publicationEmpty: "The publication service returned an empty response.",
    templateRequestFailed: (status: number) => `The template request failed (HTTP ${status}).`,
    templateEmpty: "The template library returned an empty response.",
  },

  /** Vekilin (`proxy.ts`) parola kapısı. */
  proxy: {
    authenticationRequired: "Authentication required.",
  },
  /** Kurulabilir uygulamanın açıklaması (`app/manifest.ts`). */
  manifest: {
    description: "Papers you can read, verify and play with. Your library opens offline too.",
  },
};

const errorsTr: UserErrorText = {
  requestBodyEmpty: () => "İsteğin gövdesi boş.",
  requestBodyInvalidJson: () => "İsteğin gövdesi geçerli bir JSON değil.",
  requestTooLarge: () => "İstek çok büyük.",
  signInToStudio: () => "Önce stüdyoya giriş yap.",
  ownerOnlyData: () => "Ekipte bütün veriyi yalnızca bir sahip dışa aktarabilir, içe aktarabilir ya da yedekleyebilir: bu veri her üyenin notlarını içeriyor.",

  teamBusy: () => "Ekip ayarları şu an meşgul. Birazdan tekrar dene.",
  teamHasAccounts: () => "Ekipte zaten hesaplar var. Bunun yerine giriş yap.",
  tooManyWrongPasswords: () => "Bu ad için çok fazla yanlış parola girildi. On beş dakika sonra tekrar dene.",
  wrongNameOrPassword: () => "Ad ya da parola yanlış.",
  signInFirst: () => "Önce giriş yap.",
  ownerOnlyTeam: () => "Ekibi yalnızca bir sahip değiştirebilir.",
  nameTaken: () => "Ekipte bu adı kullanan biri zaten var.",
  noSuchMember: () => "Böyle bir üye yok.",
  lastOwner: () => "Son sahip ekipten çıkarılamaz.",
  wrongCurrentPassword: () => "Şu anki parola yanlış.",
  nameRequired: () => "Ad gerekli.",
  nameTooLong: (max) => `Ad en çok ${max} karakter olabilir.`,
  nameControlCharacters: () => "Ad denetim karakteri içeremez.",
  passwordTooShort: (min) => `Parola en az ${min} karakter olmalı.`,
  passwordTooLong: (max) => `Parola en çok ${max} karakter olabilir.`,

  accentBusy: () => "Makale renkleri şu an meşgul. Birazdan tekrar dene.",
  tagsBusy: () => "Etiketler şu an meşgul. Birazdan tekrar dene.",
  studyBusy: () => "Çalışma ilerlemesi şu an meşgul. Birazdan tekrar dene.",
  notesBusy: () => "Notların şu an meşgul. Birazdan tekrar dene.",
  readingListBusy: () => "Okuma listesi şu an meşgul. Birazdan tekrar dene.",
  aliasesBusy: () => "Kavram bağları şu an meşgul. Birazdan tekrar dene.",
  profileBusy: () => "Profil şu an meşgul. Birazdan tekrar dene.",
  workLogBusy: () => "Çalışma kaydı şu an meşgul. Birazdan tekrar dene.",
  templateIdInvalid: () => "Şablon kimliği geçerli değil.",
  templateIdBuiltIn: () => "Bu kimlik hazır bir şablonun; başka bir ad seç.",
  templateUnusable: (issues) => `Şablon kullanılamıyor: ${issues}.`,
  publicationIdInvalid: () => "Yayın kimliği geçerli değil.",
  publicationSourceGone: () => "Proje artık kütüphanede değil, bu yüzden bu yayın güncellenemiyor.",

  localAddressInvalid: (value, example) => `“${value}” geçerli bir adres değil. ${example} gibi bir adres yaz.`,
  localAddressCredentials: () => "Yerel model adresi kimlik bilgisi içermemeli.",
  localAddressNotLoopback: (hostname) =>
    `Yalnızca bu makinedeki bir adres kabul ediliyor (127.0.0.1, localhost ya da ::1); “${hostname}” bunlardan biri değil. İstek Trace sunucusundan çıkıyor; başka bir adres, isteğin senin hiç istemediğin makinelere ulaşmasına yol açardı.`,

  sourceProtocol: () => "Yalnızca HTTP ya da HTTPS kaynakları destekleniyor.",
  sourceCredentials: () => "Kimlik bilgisi taşıyan adresler desteklenmiyor.",
  sourceLocalNetwork: () => "Yerel ağ adresleri kaynak olarak kullanılamaz.",
  sourcePrivateAddress: () => "Özel IP adreslerine erişim engelli.",
  sourceUnsafeAddress: () => "Kaynak güvenli, herkese açık bir adrese çözümlenmedi.",
  sourceTooManyRedirects: () => "Kaynak çok fazla yönlendirme yaptı.",
  sourceStatus: (status) => `Kaynak ${status} koduyla yanıt verdi.`,
  sourceNotText: () => "Kaynak ne HTML ne de düz metin.",
  sourceUnreadable: () => "Kaynağın içeriği okunamadı.",
  sourceTooLarge: () => "Kaynak, içerik sınırını aşıyor.",
  sourceFetchFailed: () => "Kaynak alınamadı.",

  pdftotextMissing: () =>
    "Makaleyi metin olarak okumak için pdftotext gerekiyor ama bulunamadı. Poppler'ı kur (macOS: brew install poppler · Debian/Ubuntu: apt install poppler-utils · Windows: choco install poppler) ve tekrar dene ya da Kanıt ve Teknik aşamalarına bir bulut sağlayıcısı ata.",
  pdfTextFailed: (detail) => `PDF'in metni çıkarılamadı: ${detail}`,
  pdfNoText: () =>
    "Bu PDF'te çıkarılabilir metin neredeyse hiç yok; büyük olasılıkla taranmış bir belge. Yerel model onu okuyamaz; PDF'in kendisini alan Kanıt ve Teknik aşamalarına bir bulut sağlayıcısı ata.",
  popplerMissing: () => "Bir alıntıyı sayfasında göstermek için Poppler (pdftotext ve pdftoppm) gerekiyor ama bulunamadı.",
  pageUnreadable: (detail) => `Sayfa okunamadı: ${detail}`,
  pdfNoPage: (page) => `PDF'te ${page}. sayfa yok.`,

  modelCouldNotProcessPdf: () => "Model PDF'i işleyemedi.",
  pdfProcessingTimedOut: () => "PDF'in işlenmesi zaman aşımına uğradı.",
  stageEmptyResponse: (stage) => `“${stage}” aşaması boş bir yanıt döndürdü.`,
  stageInvalidJson: (stage) => `“${stage}” aşaması geçerli bir JSON döndürmedi.`,
  openRouterNoText: (model) => `${model} adlı OpenRouter modeli metin/JSON çıktısı vermiyor. Trace görevleri için çıktı türü “text” olan bir model seç.`,
  openRouterNoStructured: (model) => `${model} adlı OpenRouter modeli katı yapılandırılmış çıktıyı desteklemiyor. Uyumlu katalogdan başka bir model seç.`,
  localServerUnreachable: (endpoint) =>
    `${endpoint} adresinde yanıt veren bir yerel model sunucusu yok. Bir tane başlat (\`ollama serve\` ya da LM Studio'nun yerel sunucusu) veya Trace'e sunucunun dinlediği adresi ver.`,
  localServerStatus: (endpoint, status) => `${endpoint} adresindeki yerel model sunucusu ${status} koduyla yanıt verdi.`,
  localModelMissing: (endpoint, model, installed) =>
    `${endpoint} adresindeki yerel sunucuda “${model}” yok. Yüklü olanlar: ${installed}. Önce onu indir, örneğin \`ollama pull ${model}\`.`,

  generationCancelled: () => "Üretim iptal edildi.",
  providerName: (label, local) => (local ? "Yerel model" : label ?? "Model sağlayıcısı"),
  providerTask: (provider, model, task) => `${provider}${model ? ` (${model})` : ""}${task ? ` · ${TASK_ROLES_TR[task] ?? task} görevi` : ""}`,
  providerTimedOut: (who, local) =>
    `${who} ${local ? "15 dakika" : "120 saniye"} içinde bitmedi. Tamamlanan aşamalar korundu; tekrar deneyebilirsin.${local ? " Daha küçük ya da düşünme adımı olmayan bir yerel model veya bir bulut sağlayıcısı daha çabuk bitirir." : ""}`,
  apiKeyInvalid: (provider) => `${provider} API anahtarı geçersiz ya da bu model için yetkili değil.`,
  quotaExhausted: (provider) => `${provider} kotası doldu ya da hız sınırına ulaşıldı. Tamamlanan aşamalar korundu.`,
  insufficientCredit: (provider, model) => `${provider} hesabında bu istek için yeterli kredi yok.${model ? ` (${model})` : ""}`,
  modelUnavailable: (provider) => `Seçilen ${provider} modeli bu API anahtarıyla kullanılamıyor. Başka bir model seçip tekrar dene.`,
  providerUnreachable: (provider) => `${provider} şu an yanıt vermiyor. Tamamlanan aşamalar korundu; tekrar deneyebilirsin.`,
  upstreamFailed: (who, diagnostic, fallback) =>
    `${who} üst sağlayıcıda başarısız oldu${diagnostic ? ` (${diagnostic})` : ""}.${fallback ? ` Uyumlu yedek model ${fallback} de başarısız oldu.` : ""} Uyumlu katalogdan yalnızca metin çıktısı veren ve yapılandırılmış çıktıyı destekleyen başka bir model seç.`,
  schemaFailedTwice: () => "Modelin çıktısı iki denemede de kanıt şemasından geçemedi. Uydurulmuş hiçbir veri yayımlanmadı; tamamlanan aşamalar korundu.",
  processingFailed: () => "Makale işlenirken bir şeyler ters gitti.",

  teachingKeyRefused: () => "Öğretim modelinin anahtarı reddedildi.",
  teachingRateLimited: () => "Öğretim modelinin hız sınırına ulaşıldı.",
  teachingTimedOut: () => "Öğretim modeli zamanında yanıt vermedi.",
  teachingChecksFailed: () => "Modelin yanıtı denetimlerden iki kez geçemedi.",
  teachingFailed: () => "Öğretim modeli bir hata döndürdü.",
};

const tr: typeof en = {
  errors: errorsTr,
  progress: {
    pdfProcessing: "PDF model için hazırlanıyor.",
    pdfProcessingDetail: "Belgenin sayfaları ve görsel katmanları ayrıştırılıyor.",
    geminiReceived: "PDF alındı; sayfaları çözümleniyor.",
    claudeSplit: "PDF, Claude için görsel ve metin katmanlarına ayrıldı.",
    localAnswering: "Yerel model yanıtlıyor.",
    localAnsweringDetail: (model, endpoint) => `${model} · ${endpoint} · hiçbir şey bu makineden çıkmıyor`,
    openRouterRedirected: "Yapılandırılmış çıktı veren bir OpenRouter modeline geçildi.",
    openRouterRedirectedDetail: (model, effective) => `${model} görsel üreten bir model; Trace tuvalinin JSON'u ${effective} ile üretilecek.`,
    openRouterPdfReady: "PDF, OpenRouter isteği için hazır.",
    openRouterFallback: "OpenRouter uç noktası değiştiriliyor.",
    openRouterFallbackDetail: (model, fallback) => `${model} üst sağlayıcıda hata verdi; güvenli biçimde ${fallback} ile yeniden deneniyor.`,
    openAiReceived: "PDF, OpenAI çalışma alanına alındı.",
  },

  request: {
    invalidJson: "İstek geçerli bir JSON değil.",
    projectIdRequired: "Proje kimliği gerekli.",
    notInLibrary: "Proje kütüphanede değil.",
    formDataUnreadable: "Gönderilen form verisi okunamadı.",
    emptyOrTooLarge: "İstek boş ya da çok büyük.",
    notValid: "İstek geçerli değil.",
    projectInvalid: "Trace projesi geçerli değil.",
    projectSchemaInvalid: (path, message) => `Trace projesinin şeması geçersiz: ${path || "kök"} · ${message ?? "bilinmeyen hata"}`,
    modelSelectionInvalid: "Model ve sağlayıcı seçimi geçerli değil.",
    localAddressInvalid: "Yerel model adresi geçerli değil.",
    keyRequired: (provider) => `${KEY_LABELS_TR[provider.id] ?? `${provider.label} API anahtarı`} gerekli.`,
    pdfTooLarge: "PDF 35 MB sınırını aşıyor.",
  },

  retry: {
    structure: (issues, attempt) => `${issues} tutarsızlık gideriliyor · yapı denemesi ${attempt}/2`,
    network: (attempt, max) => `Geçici model hatası · ağ denemesi ${attempt}/${max}`,
  },

  library: {
    readFailed: "Trace kütüphanesi okunamadı.",
    tooLarge: "Trace JSON'u 5 MB sınırını aşıyor.",
    unknownReason: "Bilinmeyen kaydetme nedeni.",
    saveFailed: "Trace projesi kaydedilemedi.",
    deleteFailed: "Trace projesi silinemedi.",
  },
  tags: {
    readFailed: "Kütüphane etiketleri okunamadı.",
    tooLarge: "Etiket listesi çok büyük.",
    invalid: "Etiket listesi geçerli değil.",
    saveFailed: "Etiketler kaydedilemedi.",
  },
  study: {
    readFailed: "Çalışma ilerlemesi okunamadı.",
    tooLarge: "Çalışma ilerlemesi çok büyük.",
    invalid: "Çalışma ilerlemesi geçerli değil.",
    saveFailed: "Çalışma ilerlemesi kaydedilemedi.",
  },
  notes: {
    readFailed: "Notların okunamadı.",
    tooLarge: "Notlar çok büyük.",
    invalid: "Notlar geçerli değil.",
    saveFailed: "Notların kaydedilemedi.",
  },
  readingList: {
    readFailed: "Okuma listesi okunamadı.",
    tooLarge: "Makalenin bilgileri çok büyük.",
    invalid: "Makalenin bilgileri geçerli değil.",
    saveFailed: "Okuma listesi kaydedilemedi.",
    paperIdRequired: "Makale kimliği gerekli.",
  },
  revisions: {
    idInvalid: "Sürüm kimliği geçerli değil.",
    missing: "Böyle bir sürüm yok.",
    readFailed: "Projenin geçmişi okunamadı.",
    saveFirst: "Bir sürümü işaretlemeden önce projeyi kaydet.",
    saveFailed: "Sürüm kaydedilemedi.",
  },
  aliases: {
    readFailed: "Kavram bağları okunamadı.",
    notConcepts: "İki ad da kütüphanendeki bir makalenin kavramı olmalı.",
    saveFailed: "Kavram bağı kaydedilemedi.",
    modelRequired: "Bir model ve sağlayıcı gerekli.",
    modelNotAsked: "Modele sorulamadı.",
  },
  obsidian: {
    exportFailed: "Kütüphane dışa aktarılamadı.",
  },
  backup: {
    listFailed: "Yedekler listelenemedi.",
    writeFailed: "Haftalık yedek yazılamadı.",
  },
  profile: {
    readFailed: "Profil okunamadı.",
    tooLarge: "Profil çok büyük; daha küçük bir fotoğraf kullan.",
    required: "Profil gerekli.",
    fieldInvalid: (path, message) => `${path || "profil"}: ${message ?? "geçerli değil"}`,
    saveFailed: "Profil kaydedilemedi.",
  },
  workLog: {
    readFailed: "Çalışma kaydı okunamadı.",
    tooMany: "Tek seferde çok fazla oturum var.",
    futureEnd: "Bir oturum gelecekte bitemez.",
    invalid: "Oturumlar geçerli değil.",
    saveFailed: "Oturumlar kaydedilemedi.",
    idRequired: "Oturum kimliği gerekli.",
    notFound: "Bu oturum çalışma kaydında yok.",
    deleteFailed: "Oturum silinemedi.",
  },
  data: {
    readFailed: "Verin okunamadı.",
    tooLarge: "Dosya 300 MB'tan büyük.",
    notTraceFile: "Bu bir Trace veri dosyası değil.",
    invalidJson: "Dosya geçerli bir JSON değil.",
    importFailed: "Verin içe aktarılamadı.",
  },
  backupImport: {
    sessionsAdded: (sessions) => `${sessions} oturum eklendi`,
    profileAdopted: "dosyadaki profil alındı",
    papersAdded: (papers) => `kütüphanene ${papers} makale eklendi`,
    papersKept: (papers) => `zaten burada olan ${papers} makale olduğu gibi bırakıldı`,
    studyMerged: (papers) => `${papers} makalenin çalışma ilerlemesi birleştirildi`,
    notesAdded: (notes) => `${notes} not eklendi`,
    readingAdded: (works) => `okuma listene ${works} çalışma eklendi`,
    tagsMerged: (papers) => `${papers} makalenin etiketleri birleştirildi`,
    aliasesAdded: (links) => `${links} kavram bağı eklendi`,
    withoutPaper: (records) => `makalesi kütüphanende olmadığı için ${records} kayıt dışarıda kaldı`,
    papersUnreadable: (papers) => `dosyadaki ${papers} makale okunamadı`,
    sentence: (parts) => `${capitalTr(parts.join(", "))}. Hiçbir şey silinmedi.`,
  },
  templates: {
    readFailed: "Şablonlar okunamadı.",
    tooLarge: "Şablon çok büyük.",
    invalid: (path, message) => `Geçersiz şablon: ${path || "kök"} · ${message ?? "bilinmeyen hata"}`,
    saveFailed: "Şablon kaydedilemedi.",
    idRequired: "Geçerli bir şablon kimliği gerekli.",
    deleteFailed: "Şablon silinemedi.",
  },
  publications: {
    invalid: (path, message) => `Geçersiz yayın isteği: ${path || "kök"} · ${message ?? "bilinmeyen hata"}`,
    readFailed: "Yayınlar okunamadı.",
    saveFirst: "Yayımlamadan önce projeyi kütüphaneye kaydet.",
    publishFailed: "Proje yayımlanamadı.",
    missing: "Böyle bir yayın yok.",
    updateFailed: "Yayın güncellenemedi.",
    deleteFailed: "Yayın silinemedi.",
  },
  team: {
    detailsInvalid: "Bilgiler geçerli değil.",
    changeFailed: "Ekip değiştirilemedi.",
    memberIdRequired: "Üye kimliği gerekli.",
  },
  citations: {
    titleRequired: "Makalenin başlığı gerekli.",
  },
  excerpts: {
    pdfWithLimit: "Makalenin PDF'ini yükle (en çok 35 MB).",
    pageAndQuote: "Sayfa numarası ve alıntı gerekli.",
    locateFailed: "Alıntının yeri bulunamadı.",
    pdfRequired: "Makalenin PDF'ini yükle.",
    evidenceMissing: "Projenin kanıtı eksik ya da çok büyük.",
    evidenceInvalid: "Projenin kanıtı geçerli değil.",
    wrongPdf: (found, checked) =>
      `Bu PDF'te ${checked} alıntıdan yalnızca ${found} tanesi bulundu. Büyük olasılıkla başka bir makale ya da makalenin başka bir sürümü; bu yüzden hiçbir şey değiştirilmedi.`,
    checkFailed: "Alıntılar denetlenemedi.",
  },
  openRouter: {
    keyRequired: "OpenRouter API anahtarı gerekli.",
    keyInvalid: "OpenRouter API anahtarı geçerli değil.",
    catalogueFailed: "OpenRouter model kataloğu yüklenemedi.",
  },
  probe: {
    requestInvalid: "Model deneme isteği geçerli değil.",
    timedOut: (seconds, fullAnalysis) =>
      `Model kısa bir denemeyi ${seconds} sn içinde bitiremedi. ${fullAnalysis ? "Tam bir analiz" : "Bir bölüm"} sınırı neredeyse kesinlikle aşar. Daha hızlı bir model seç.`,
  },
  resolve: {
    queryTooShort: "Bir makale başlığı, DOI, arXiv kimliği ya da bağlantı yaz.",
    lookupFailed: "Makale aranamadı.",
    noPdfAddress: "İndirilebilir bir PDF adresi verilmedi.",
    untitled: "Başlıksız makale",
  },
  ask: {
    questionTooShort: "En az üç karakterlik bir soru sor.",
  },
  explain: {
    length: (min, max) => `En az ${min}, en çok ${max} karakter yaz.`,
    sectionMissing: "Bu bölüm projede yok.",
  },

  learningLayer: {
    requestInvalid: (path, message) => `Öğrenme katmanı isteği geçersiz: ${path || "kök"} · ${message ?? "bilinmeyen hata"}`,
    alreadyComplete: "Bu projenin öğrenme katmanı zaten var.",
    alreadyHas: (block) => `Bu projede ${LEARNING_BLOCKS_TR[block].noun} zaten var. Onun öğelerini tek tek yeniden üret.`,
    tooLarge: "Proje, öğrenme katmanı eklemek için fazla büyük.",
    unreadable: "Öğrenme katmanı isteği okunamadı.",
    preparing: "Öğretim modeli hazırlanıyor.",
    preparingDetail: "Kanıt kilitli; öğrenme malzemesi PDF olmadan, yalnızca kanıttan yazılıyor.",
    writing: (block) => `${LEARNING_BLOCKS_TR[block].title}.`,
    part: (index, total) => `Öğrenme katmanı, parça ${index}/${total}.`,
    received: (count, index, total) => `${characters(count, "tr")} karakter alındı · parça ${index}/${total}`,
    relinking: (block) => `${capitalTr(LEARNING_BLOCKS_TR[block].noun)} kanıta yeniden bağlanıyor.`,
    reconnecting: (block) => `${capitalTr(LEARNING_BLOCKS_TR[block].noun)} için bağlantı yeniden kuruluyor.`,
    passed: "Öğrenme malzemesi kanıt denetiminden geçti.",
    allCited: "Her parça yalnızca kanıtta olan iddialara atıf yapıyor.",
    gaps: (failed) => {
      if (!failed.length) return undefined;
      const list = listTr(failed.map(({ block }) => LEARNING_BLOCKS_TR[block].noun));
      const reasons = [...new Set(failed.map(({ reason }) => reason))].join(" ");
      return `Öğrenme katmanı eksik; yazılamayanlar: ${list}. ${reasons} Geri kalan her şey tamam; eksik parçaları Lab'den ekleyebilirsin.`;
    },
  },

  regenerate: {
    requestInvalid: (path, message) => `Yeniden üretim isteği geçersiz: ${path || "kök"} · ${message ?? "bilinmeyen hata"}`,
    notFound: (kind, id) => `Bu projede “${id}” kimlikli bir ${SECTION_KINDS_TR[kind].label} yok.`,
    tooLarge: "Proje, bir bölümünü yeniden üretmek için fazla büyük.",
    unreadable: "Yeniden üretim isteği okunamadı.",
    preparing: (kind) => `${capitalTr(SECTION_KINDS_TR[kind].label)} hazırlanıyor.`,
    preparingDetail: (kind) => `Kanıt kilitli; yalnızca bu ${SECTION_KINDS_TR[kind].noun} yeniden yazılacak.`,
    streaming: (kind) => `${capitalTr(SECTION_KINDS_TR[kind].label)} geliyor.`,
    received: (count) => `${characters(count, "tr")} karakter alındı.`,
    relinking: (kind) => `${capitalTr(SECTION_KINDS_TR[kind].label)} kanıta yeniden bağlanıyor.`,
    reconnecting: (kind) => `${capitalTr(SECTION_KINDS_TR[kind].label)} için bağlantı yeniden kuruluyor.`,
    passed: (kind) => `${capitalTr(SECTION_KINDS_TR[kind].noun)} kanıt denetiminden geçti.`,
    reviewFirst: "Şimdiki sürümün yerine geçmeden önce onu gözden geçir.",
    failedTwice: (kind) =>
      `Yeniden üretilen ${SECTION_KINDS_TR[kind].noun} iki denemede de kanıt denetiminden geçemedi. Hiçbir şey değişmedi; tekrar dene ya da iddia kilidini gevşet.`,
  },

  generate: {
    assignmentInvalid: "Görev başına model ataması geçerli değil.",
    keyAssignmentInvalid: "Sağlayıcıların API anahtarı ataması geçerli değil.",
    pdfRequired: "Bir PDF dosyası yüklemelisin.",
    pdfOnly: "Yalnızca PDF dosyaları destekleniyor.",
    claudePdfLimit: "Claude için PDF sınırı 24 MB; base64 kodlaması isteği toplam sınırının ötesine taşırdı.",
    cannotReadPdf: (provider, role) =>
      `${provider} PDF'i alamıyor, bu yüzden makaleyi kendisi okuyan ${TASK_ROLES_TR[role] ?? role} aşamasını çalıştıramaz. Kanıt ve Teknik aşamalarına belge okuyabilen bir sağlayıcı ata; ${provider} raporu ve görselleri yine yazabilir.`,
    sourcesInvalid: "Kaynak adreslerinin listesi geçerli değil.",
    templateInvalidJson: "Anlatı şablonu geçerli bir JSON değil.",
    templateInvalid: "Anlatı şablonu geçerli değil.",
    templateUnusable: (problems) => `Anlatı şablonu kullanılamıyor: ${problems}.`,
    sourceUnreadable: "okunamadı",
    excerptCheckSkipped: {
      "missing-tool": "Alıntılar sayfa metnine karşı denetlenmedi: sunucuda pdftotext (Poppler) kurulu değil.",
      "no-text": "Alıntılar sayfa metnine karşı denetlenmedi: PDF'te çıkarılabilir metin yok, büyük olasılıkla taranmış bir belge.",
      failed: "Alıntılar sayfa metnine karşı denetlenmedi: PDF'ten metin çıkarılamadı.",
    },
    preparingSources: "Kaynaklar korumalı bir alanda hazırlanıyor.",
    checkingSources: (count) => `PDF, ${count} destekleyici kaynakla birlikte denetleniyor.`,
    pdfValidated: "PDF, analizden önce dosya denetiminden geçti.",
    textExtracted: "Makalenin metni yerel model için çıkarıldı.",
    textExtractedDetail: (pages) => `${pages} sayfa · sayfa sınırları korundu, böylece her iddia yine bir sayfayı gösteriyor.`,
    resuming: "Kaydedilmiş kanıt aşamalarından devam ediliyor.",
    resumingDetail: (done) => `${done}/4 aşama yeniden kullanılacak; yalnızca eksik olanlar üretiliyor.`,
    splitting: "Makale dört kanıt katmanına ayrılıyor.",
    splittingDetail: "Aynı anda en çok iki küçük model görevi çalışıyor.",
    extracting: (pass) => `${EVIDENCE_PASSES_TR[pass]} çıkarılıyor.`,
    passWaiting: (done) => `${done}/4 aşama tamam · yapılandırılmış akış bekleniyor`,
    passOmitted: (done, pages) => `${done}/4 aşama tamam · ${pages} numaralı sayfalar yerel modelin bağlamına sığmadı ve bu aşamanın dışında kaldı`,
    streamingPass: (pass) => `${EVIDENCE_PASSES_TR[pass]} geliyor.`,
    passReceived: (count, done) => `${characters(count, "tr")} karakter alındı · ${done}/4 aşama tamam`,
    recheckingPass: (pass) => `${EVIDENCE_PASSES_TR[pass]} yeniden denetleniyor.`,
    reconnectingPass: (pass) => `${EVIDENCE_PASSES_TR[pass]} için bağlantı yeniden kuruluyor.`,
    downgraded: (pass, claims) =>
      `${EVIDENCE_PASSES_TR[pass]}: ${claims} iddianın alıntısı atıf yapılan sayfada bulunamadı, bu yüzden “incelenmeli” olarak işaretlendi.`,
    passValidated: (pass) => `${EVIDENCE_PASSES_TR[pass]} doğrulandı.`,
    passValidatedDetail: (done) => `${done}/4 kanıt aşaması tamamlandı ve kontrol noktasına yazıldı.`,
    overviewMissing: "Makalenin genel bakış kontrol noktası bulunamadı.",
    merged: "Dört kanıt katmanı birleştirildi.",
    mergedDetail: (claims, metrics, limitations) => `${claims} iddia · ${metrics} ölçüm · ${limitations} sınırlılık`,
    designing: "Görsel anlatı, ayrıntılı rapor ve öğrenme malzemesi tasarlanıyor.",
    designingDetail: "Farklı modeller paralel çalışıyor; aynı modeli paylaşan görevler denetimli bir sırayla ilerliyor.",
    streamingStory: "StorySpec geliyor.",
    storyReceived: (count) => `Doğrulanmış anlatının ${characters(count, "tr")} karakteri alındı.`,
    relinkingStory: "Hikâye kanıta yeniden bağlanıyor.",
    storyRetry: (issues, attempt) => `${issues} anlatı tutarsızlığı gideriliyor · yapı denemesi ${attempt}/2`,
    reconnectingStory: "Hikâye için bağlantı yeniden kuruluyor.",
    streamingReport: "Ayrıntılı rapor geliyor.",
    reportReceived: (count) => `Analitik raporun ${characters(count, "tr")} karakteri alındı.`,
    relinkingReport: "Rapor kanıta yeniden bağlanıyor.",
    reportRetry: (issues, attempt) => `${issues} rapor tutarsızlığı gideriliyor · yapı denemesi ${attempt}/2`,
    reconnectingReport: "Rapor için bağlantı yeniden kuruluyor.",
    preparingTechnical: "Teknik ek hazırlanıyor.",
    technicalReceived: (count) => `Denklem, algoritma ve kod analizinin ${characters(count, "tr")} karakteri alındı.`,
    relinkingTechnical: "Teknik ek kanıta yeniden bağlanıyor.",
    technicalRetry: (issues, attempt) => `${issues} teknik tutarsızlık gideriliyor · yapı denemesi ${attempt}/2`,
    reconnectingTechnical: "Teknik ek için bağlantı yeniden kuruluyor.",
    learningStep: (index, total) => `Öğrenme malzemesi ${index}/${total} · PDF olmadan, yalnızca kanıttan yazılıyor.`,
    learningReceived: (count, index, total) => `${characters(count, "tr")} karakter alındı · öğrenme malzemesi ${index}/${total}`,
    missingOutputs: "Model ekibi gereken çıktıların hepsini üretmedi.",
    finalCheck: "Son bütünlük denetimi yapılıyor.",
    finalCheckDetail: "İddialar, sayfalar, ölçümler ve görsel bağlantılar birlikte denetleniyor.",
    cleaning: "Geçici dosyalar temizleniyor.",
    cleaningDetail: (workspaces) => `${workspaces} model çalışma alanı temizleniyor; hiçbir API anahtarı saklanmıyor.`,
  },

  client: {
    libraryRequestFailed: (status) => `Trace kütüphanesine yapılan istek başarısız oldu (HTTP ${status}).`,
    libraryEmpty: "Trace kütüphanesi boş bir yanıt döndürdü.",
    publicationRequestFailed: (status) => `Yayın isteği başarısız oldu (HTTP ${status}).`,
    publicationEmpty: "Yayın hizmeti boş bir yanıt döndürdü.",
    templateRequestFailed: (status) => `Şablon isteği başarısız oldu (HTTP ${status}).`,
    templateEmpty: "Şablon kütüphanesi boş bir yanıt döndürdü.",
  },

  proxy: {
    authenticationRequired: "Kimlik doğrulaması gerekli.",
  },
  manifest: {
    description: "Okuyabildiğin, doğrulayabildiğin ve üzerinde oynayabildiğin makaleler. Kütüphanen çevrimdışı da açılıyor.",
  },
};

const server = { en, tr };

export default server;
