import { REVISION_WORDS, type RevisionField, type RevisionReason, type RevisionWords } from "@/lib/project-revisions";
import { REWRITE_PRESET_LABELS, type RewritePresetLabels } from "@/lib/rewrite-presets";
import { sectionKindInfo, type SectionKind } from "@/lib/section-regeneration";
import type { LearningBlockId } from "@/lib/learning-generation";

/**
 * Bölüm yeniden üretimi, öğrenme katmanı ekleme ve sürüm geçmişi.
 *
 * İngilizce tür adları (`sectionKindInfo`) modele giden istemle ortak; bu
 * yüzden İngilizce cümleler onlardan kuruluyor, Türkçe cümleler her tür için
 * ayrı ayrı (hâl ekleri türe göre değişiyor).
 */
const label = (kind: SectionKind) => sectionKindInfo(kind).label;
const noun = (kind: SectionKind) => sectionKindInfo(kind).noun;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const en = {
  regenerator: {
    title: (kind: SectionKind) => `Regenerate ${label(kind)}`,
    strengthenTitle: (kind: SectionKind) => `Strengthen the evidence of a ${label(kind)}`,
    evidenceHealth: "Evidence health",
    evidenceLocked: "Evidence locked",
    /** "This section rests on <b>2 claims</b>, 1 verified. …" — kalın kısım ortada. */
    thinBefore: "This section rests on ",
    thinClaims: (count: number) => `${count} claim${count === 1 ? "" : "s"}`,
    thinAfter: (verified: number, minimum: number) =>
      `, ${verified} verified. The new version must cite at least ${minimum} existing claims, one of them verified, or it is rejected. Where the evidence does not back a sentence, the model narrows the sentence instead.`,
    claimsLegend: (kind: SectionKind) => `Claims this ${noun(kind)} rests on`,
    keepClaims: "Keep the same claims",
    keepClaimsNote: (kind: SectionKind, count: number) =>
      count
        ? `The wording changes; ${count === 1 ? "the cited claim stays exactly as it is" : `the ${count} cited claims stay exactly as they are`}.`
        : `The wording changes; the ${noun(kind)} keeps citing no claims.`,
    openClaims: "Choose from all evidence",
    openClaimsNote: "The model may cite other existing claims. It still cannot add a fact.",
    presetsAria: "Quick requests",
    presetsLabel: "Explain it differently",
    presets: REWRITE_PRESET_LABELS as RewritePresetLabels,
    instruction: "What should change?",
    optional: "Optional",
    placeholders: {
      story: "Shorter, with a concrete example from the method. Use a timeline instead of a matrix.",
      report: "Separate what the authors report from what follows. Name the cost of the design.",
      primer: "Explain it with an everyday analogy before the formal definition.",
      quiz: "Make the wrong options plausible misreadings of the result, not obvious mistakes.",
      derivation: "Smaller steps, and say which assumption each step uses.",
      equation: "Explain every symbol, and say what would change without this term.",
    } as Record<SectionKind, string>,
    onlyThisSent: (kind: SectionKind) =>
      `Only this ${noun(kind)} is sent to the model, with the locked evidence as its sole source. The PDF is not needed, so a local model works too. The key is used for this request and never stored.`,
    probing: "Testing the model with a short request…",
    probeFailed: "The model could not be tested.",
    testing: "Testing…",
    testModel: "Test model",
    regenerate: "Regenerate",
    sending: "Sending the section request.",
    requestFailed: "The section could not be regenerated.",
    nothingCameBack: "The request finished but no section came back.",
    current: "Current",
    proposed: "Proposed",
    cannotApply: "This version can no longer be applied.",
    discard: "Discard",
    useThis: "Use this version",
    whyItMatters: "Why it matters.",
    example: "Example.",
    regenerated: (kind: SectionKind) => `${capitalize(label(kind))} regenerated against the locked evidence.`,
    restoreFailed: "The previous version could not be restored.",
    dismiss: "Dismiss",
  },
  learningGenerator: {
    kicker: "Learning layer",
    title: "Add the learning layer",
    blocks: {
      primer: { label: "Primer", purpose: "What the paper assumes you already know, in the order to learn it." },
      quiz: { label: "Quiz", purpose: "Questions that check understanding; every answer shows its page and quote." },
      misreadings: { label: "Common misreadings", purpose: "What a hurried reader gets wrong about this paper, each corrected from the evidence." },
      derivations: { label: "Derivations", purpose: "The key results worked out step by step, each step with its reason." },
      interactives: { label: "Interactive explorations", purpose: "Playgrounds and simulations that run the paper's formulas from its own settings." },
      applicationGuide: { label: "Application guide", purpose: "How to use the method, its settings, pitfalls, and when not to." },
    } as Record<LearningBlockId, { label: string; purpose: string }>,
    intro: (blocks: string) =>
      `Trace writes ${blocks} from the evidence already collected. Every item cites the claims it rests on and is checked like a full analysis. The PDF is not needed, so a local model works too.`,
    sentNote: "Only the claims, metrics and technical appendix of this project are sent. The key is used for this request and never stored.",
    write: "Write the learning layer",
    sending: "Sending the evidence.",
    requestFailed: "The learning layer could not be written.",
    nothingCameBack: "The request finished but no learning material came back.",
    evidenceChanged: "The evidence changed while the learning material was being written. Nothing was added; try again.",
    checkFailed: (issues: string) => `The learning material did not pass the check: ${issues}`,
    added: (blocks: string) => `Added ${blocks}.`,
    undoable: "The previous version is in the project history, so this can be undone.",
    startWithPrimer: "Start with the primer",
    openIt: "Open it",
  },
  history: {
    reasons: {
      edit: "Before edits",
      regenerate: "Before a regenerated section",
      restore: "Before a restore",
      import: "Before an import",
      manual: "Saved version",
      agent: "Before an agent update",
      verify: "Before a quote check",
      learning: "Before the learning layer was added",
    } as Record<RevisionReason, string>,
    loadFailed: "The history could not be loaded.",
    openFailed: "That version could not be opened.",
    saveFailed: "The version could not be saved.",
    restoreFailed: "The version could not be restored.",
    kicker: "Version history",
    title: "Earlier versions of this project",
    intro: (limit: number) =>
      `Trace keeps the version a change replaced: every regenerated section, restore and import, and a snapshot every ten minutes while you edit. The latest ${limit} are kept.`,
    namePlaceholder: "Name this version (optional)",
    nameAria: "Version name",
    saveThis: "Save this version",
    empty: "No earlier versions yet. They appear after the first regenerated section, restore, import or longer edit.",
    counts: (claims: number, story: number, report: number) => `${claims} claims · ${story} story · ${report} report sections`,
    pick: "Pick a version to see what has changed since.",
    savedAt: (date: string) =>
      `Saved ${date}. Restoring it replaces the current project; the current one is kept in this history first, so the restore can be undone.`,
    unchanged: "Nothing has changed since this version.",
    changedSince: "Changed since this version",
    /** "<del>Struck through</del> is what …; <ins>highlighted</ins> is what …" */
    legend: {
      struck: "Struck through",
      afterStruck: " is what this version says; ",
      highlighted: "highlighted",
      afterHighlighted: " is what the project says now. Restoring brings back the struck text.",
    },
    showText: "Show the text",
    restoring: "Restoring…",
    restoreThis: "Restore this version",
    /** Fark özetinin cümleleri (`describeProjectChanges`). */
    changes: REVISION_WORDS as RevisionWords,
  },
};

/** Her tür için Türkçe adlar; ekler türe göre elle yazılmış. */
const trKinds: Record<SectionKind, { name: string; accusative: string; genitive: string; noun: string; nounGenitive: string }> = {
  story: { name: "Hikâye bölümü", accusative: "Hikâye bölümünü", genitive: "Hikâye bölümünün", noun: "bölüm", nounGenitive: "bölümün" },
  report: { name: "Rapor bölümü", accusative: "Rapor bölümünü", genitive: "Rapor bölümünün", noun: "bölüm", nounGenitive: "bölümün" },
  primer: { name: "Ön bilgi kavramı", accusative: "Ön bilgi kavramını", genitive: "Ön bilgi kavramının", noun: "kavram", nounGenitive: "kavramın" },
  quiz: { name: "Test sorusu", accusative: "Test sorusunu", genitive: "Test sorusunun", noun: "soru", nounGenitive: "sorunun" },
  derivation: { name: "Türetim", accusative: "Türetimi", genitive: "Türetimin", noun: "türetim", nounGenitive: "türetimin" },
  equation: { name: "Denklem", accusative: "Denklemi", genitive: "Denklemin", noun: "denklem", nounGenitive: "denklemin" },
};

/** Geçmiş panelinde alan adları. */
const trFields: Record<RevisionField, string> = {
  title: "başlık",
  dek: "spot",
  readingTime: "okuma süresi",
  accent: "vurgu rengi",
  closing: "kapanış",
  kicker: "üst başlık",
  text: "metin",
  visual: "görsel",
  claims: "iddialar",
  openQuestions: "açık sorular",
  kind: "tür",
  summary: "özet",
  analysis: "analiz",
  label: "etiket",
  expression: "ifade",
  latex: "LaTeX",
  explanation: "açıklama",
  variables: "değişkenler",
  overview: "genel bakış",
  term: "terim",
  level: "düzey",
  intuition: "sezgi",
  formal: "biçimsel tanım",
  whyItMatters: "neden önemli",
  prerequisites: "ön koşullar",
  goal: "amaç",
  equation: "denklem",
  steps: "adımlar",
  example: "örnek",
  intro: "giriş",
  prompt: "soru",
  options: "seçenekler",
  misreading: "yanlış okuma",
  trap: "tuzak",
  correction: "düzeltme",
  language: "dil",
  audience: "hedef kitle",
  depth: "derinlik",
};

const trRevisionWords: RevisionWords = {
  nouns: {
    story: "Hikâye",
    storySection: "Hikâye bölümü",
    deepReport: "Ayrıntılı rapor",
    report: "Rapor",
    reportSection: "Rapor bölümü",
    technicalAppendix: "Teknik ek",
    equation: "Denklem",
    primer: "Ön bilgi",
    primerConcept: "Ön bilgi kavramı",
    derivations: "Türetimler",
    derivation: "Türetim",
    quiz: "Test",
    quizQuestion: "Test sorusu",
    misreadings: "Sık yapılan yanlış okumalar",
    misreading: "Yanlış okuma",
    interactives: "Etkileşimli öğeler",
    applicationGuide: "Uygulama rehberi",
    figures: "Şekiller",
  },
  fields: trFields,
  list: (items) => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} ve ${items[items.length - 1]}`),
  added: (name) => `${name} eklendi`,
  removed: (name) => `${name} kaldırıldı`,
  fieldsChanged: (name, fields) => `${name}: ${fields} değişti`,
  changed: (name) => `${name} değişti`,
  reordered: (name) => `${name} sırası değişti`,
  settingsChanged: (fields) => {
    const text = `${fields} değişti`;
    return text.charAt(0).toLocaleUpperCase("tr") + text.slice(1);
  },
  evidence: ({ added, removed, edited }) => {
    const parts = [added ? `${added} iddia eklendi` : "", removed ? `${removed} kaldırıldı` : "", edited ? `${edited} düzenlendi` : ""].filter(Boolean);
    return parts.length ? `Kanıt: ${parts.join(", ")}` : "Kanıt ayrıntıları değişti";
  },
};

const tr: typeof en = {
  regenerator: {
    title: (kind) => `${trKinds[kind].accusative} yeniden üret`,
    strengthenTitle: (kind) => `${trKinds[kind].genitive} kanıtını güçlendir`,
    evidenceHealth: "Kanıt sağlığı",
    evidenceLocked: "Kanıt kilitli",
    thinBefore: "Bu bölüm ",
    thinClaims: (count) => `${count} iddiaya`,
    thinAfter: (verified, minimum) =>
      ` dayanıyor; ${verified} tanesi doğrulanmış. Yeni sürüm en az ${minimum} mevcut iddiaya atıf yapmalı ve bunlardan biri doğrulanmış olmalı; yoksa reddedilir. Kanıtın desteklemediği bir cümleyi model genişletmez, daraltır.`,
    claimsLegend: (kind) => `Bu ${trKinds[kind].nounGenitive} dayandığı iddialar`,
    keepClaims: "Aynı iddiaları koru",
    keepClaimsNote: (kind, count) =>
      count
        ? `Metin değişir; ${count === 1 ? "atıf yapılan iddia olduğu gibi kalır" : `atıf yapılan ${count} iddia olduğu gibi kalır`}.`
        : `Metin değişir; ${trKinds[kind].noun} yine hiçbir iddiaya atıf yapmaz.`,
    openClaims: "Bütün kanıttan seç",
    openClaimsNote: "Model mevcut başka iddialara da atıf yapabilir. Yine de yeni bir olgu ekleyemez.",
    presetsAria: "Hazır istekler",
    presetsLabel: "Farklı anlat",
    presets: {
      simpler: "Daha basit",
      analogy: "Bir benzetmeyle",
      example: "Çözümlü örnekle",
      technical: "Daha teknik",
      shorter: "Daha kısa",
      separate: "Ölçülen ve yorumlanan",
      connect: "Makaleye bağla",
      harder: "Daha zor",
      easier: "Daha kolay",
      misconception: "Bir yanılgıyı sına",
      explain: "Daha iyi açıklamalar",
      smaller: "Daha küçük adımlar",
      intuition: "Önce sezgi",
      symbols: "Her sembolü açıkla",
      why: "Her terim neden var",
    },
    instruction: "Ne değişmeli?",
    optional: "İsteğe bağlı",
    placeholders: {
      story: "Daha kısa, yöntemden somut bir örnekle. Matris yerine zaman çizelgesi kullan.",
      report: "Yazarların bildirdiğini ondan çıkanlardan ayır. Tasarımın bedelini söyle.",
      primer: "Biçimsel tanımdan önce gündelik bir benzetmeyle açıkla.",
      quiz: "Yanlış seçenekler bariz hatalar değil, sonucun akla yatkın yanlış okumaları olsun.",
      derivation: "Daha küçük adımlar; her adımın hangi varsayımı kullandığını söyle.",
      equation: "Her sembolü açıkla ve bu terim olmasa neyin değişeceğini söyle.",
    },
    onlyThisSent: (kind) =>
      `Modele yalnızca bu ${trKinds[kind].noun} gönderilir; tek kaynağı kilitli kanıttır. PDF gerekmez, bu yüzden yerel bir model de çalışır. Anahtar yalnızca bu istek için kullanılır, hiçbir yerde saklanmaz.`,
    probing: "Model kısa bir istekle deneniyor…",
    probeFailed: "Model denenemedi.",
    testing: "Deneniyor…",
    testModel: "Modeli dene",
    regenerate: "Yeniden üret",
    sending: "Bölüm isteği gönderiliyor.",
    requestFailed: "Bölüm yeniden üretilemedi.",
    nothingCameBack: "İstek tamamlandı ama bölüm gelmedi.",
    current: "Şu anki",
    proposed: "Önerilen",
    cannotApply: "Bu sürüm artık uygulanamıyor.",
    discard: "Vazgeç",
    useThis: "Bu sürümü kullan",
    whyItMatters: "Neden önemli.",
    example: "Örnek.",
    regenerated: (kind) => `${trKinds[kind].name} kilitli kanıta göre yeniden üretildi.`,
    restoreFailed: "Önceki sürüm geri getirilemedi.",
    dismiss: "Kapat",
  },
  learningGenerator: {
    kicker: "Öğrenme katmanı",
    title: "Öğrenme katmanını ekle",
    blocks: {
      primer: { label: "Ön bilgi", purpose: "Makalenin zaten bildiğini varsaydığı şeyler, öğrenilecek sırayla." },
      quiz: { label: "Test", purpose: "Anlamayı yoklayan sorular; her yanıt sayfasını ve alıntısını gösterir." },
      misreadings: { label: "Sık yapılan yanlış okumalar", purpose: "Aceleci bir okuyucunun bu makalede yanlış anladıkları; her biri kanıttan düzeltilmiş." },
      derivations: { label: "Türetimler", purpose: "Temel sonuçlar adım adım; her adım gerekçesiyle." },
      interactives: { label: "Etkileşimli keşifler", purpose: "Makalenin formüllerini kendi ayarlarıyla çalıştıran oyun alanları ve simülasyonlar." },
      applicationGuide: { label: "Uygulama rehberi", purpose: "Yöntemi nasıl kullanacağın: ayarları, tuzakları ve ne zaman kullanmaman gerektiği." },
    },
    intro: (blocks) =>
      `Trace zaten toplanmış kanıttan şunları yazar: ${blocks}. Her öğe dayandığı iddialara atıf yapar ve tam bir analiz gibi denetlenir. PDF gerekmez, bu yüzden yerel bir model de çalışır.`,
    sentNote: "Yalnızca bu projenin iddiaları, metrikleri ve teknik eki gönderilir. Anahtar yalnızca bu istek için kullanılır, hiçbir yerde saklanmaz.",
    write: "Öğrenme katmanını yaz",
    sending: "Kanıt gönderiliyor.",
    requestFailed: "Öğrenme katmanı yazılamadı.",
    nothingCameBack: "İstek tamamlandı ama öğrenme malzemesi gelmedi.",
    evidenceChanged: "Öğrenme malzemesi yazılırken kanıt değişti. Hiçbir şey eklenmedi; tekrar dene.",
    checkFailed: (issues) => `Öğrenme malzemesi denetimden geçemedi: ${issues}`,
    added: (blocks) => `Eklendi: ${blocks}.`,
    undoable: "Önceki sürüm proje geçmişinde duruyor; bu yüzden bu işlem geri alınabilir.",
    startWithPrimer: "Ön bilgiyle başla",
    openIt: "Aç",
  },
  history: {
    reasons: {
      edit: "Düzenlemelerden önce",
      regenerate: "Bir bölüm yeniden üretilmeden önce",
      restore: "Geri yüklemeden önce",
      import: "İçe aktarmadan önce",
      manual: "Kaydedilen sürüm",
      agent: "Ajan güncellemesinden önce",
      verify: "Alıntı denetiminden önce",
      learning: "Öğrenme katmanı eklenmeden önce",
    },
    loadFailed: "Geçmiş yüklenemedi.",
    openFailed: "O sürüm açılamadı.",
    saveFailed: "Sürüm kaydedilemedi.",
    restoreFailed: "Sürüm geri yüklenemedi.",
    kicker: "Sürüm geçmişi",
    title: "Bu projenin önceki sürümleri",
    intro: (limit) =>
      `Trace, bir değişikliğin yerini aldığı sürümü saklar: yeniden üretilen her bölümde, her geri yüklemede ve içe aktarmada, düzenlerken de on dakikada bir. Son ${limit} sürüm tutulur.`,
    namePlaceholder: "Bu sürüme ad ver (isteğe bağlı)",
    nameAria: "Sürüm adı",
    saveThis: "Bu sürümü kaydet",
    empty: "Henüz önceki sürüm yok. İlk yeniden üretilen bölümden, geri yüklemeden, içe aktarmadan ya da uzunca bir düzenlemeden sonra görünürler.",
    counts: (claims, story, report) => `${claims} iddia · ${story} hikâye · ${report} rapor bölümü`,
    pick: "Ne değiştiğini görmek için bir sürüm seç.",
    savedAt: (date) =>
      `Kaydedildi: ${date}. Geri yüklemek şu anki projenin yerine geçer; şu anki proje önce bu geçmişe kaydedilir, böylece geri yükleme geri alınabilir.`,
    unchanged: "Bu sürümden beri hiçbir şey değişmedi.",
    changedSince: "Bu sürümden beri değişenler",
    legend: {
      struck: "Üstü çizili",
      afterStruck: " olan bu sürümdeki metin; ",
      highlighted: "vurgulu",
      afterHighlighted: " olan projenin şimdiki metni. Geri yüklemek üstü çizili metni geri getirir.",
    },
    showText: "Metni göster",
    restoring: "Geri yükleniyor…",
    restoreThis: "Bu sürümü geri yükle",
    changes: trRevisionWords,
  },
};

const regeneration = { en, tr };

export default regeneration;
