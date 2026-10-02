import { DIFFERENCE_WORDS, type DifferenceWords } from "@/lib/compare-projects";
import { MODEL_LABEL_WORDS, exclusionDescriptions, type ExclusionReason, type ModelLabelWords } from "@/lib/model-record";
import type { ResearchProject } from "@/lib/schema";

/** İki makaleyi yan yana koyan ekran ve modellerin alıntı karnesi. */
type Depth = ResearchProject["depth"];

const en = {
  /** İki ekranın üst şeridi; kütüphanenin başlığıyla aynı. */
  pageHeader: {
    back: "Back to the library",
    tagline: "research studio",
    library: "Library",
  },
  compare: {
    eyebrow: "Side by side",
    title: "Two papers, lined up.",
    intro:
      "Nothing here is a verdict. Trace aligns what each paper reports — the same benchmark, the same term — and shows both sources so you can judge. Every number carries the page it came from.",
    etAl: " et al.",
    claims: "Claims",
    verified: "Verified",
    pagesReached: "Pages reached",
    depth: "Depth",
    /** Proje ayarı; İngilizcesi değerin kendisi. */
    depthValues: { concise: "concise", standard: "standard", deep: "deep" } as Record<Depth, string>,
    openThis: "Open this one",
    crossLanguage: (left: string, right: string) =>
      `These two projects were written in different languages (${left} and ${right}). Metrics and terms are matched by name, so labels written in different languages will not line up — few matches here means the wording differs, not the papers.`,
    sameMeasurement: "The same measurement in both",
    noSharedMetric:
      "No metric appears in both papers under the same name and unit. That usually means they measure different things — not that they disagree.",
    sameTerm: "The same term, defined differently",
    sameTermNote:
      "Both papers use these words. The definitions are not identical, which is worth reading before treating a shared word as a shared idea.",
    quiz: "Test yourself on the two",
    quizNote:
      "Knowing each paper is not the same as telling them apart. These questions come from what the two projects record (their claims, years, metrics and glossaries), and each answer says where it comes from.",
    admits: "What each admits it cannot do",
    vocabulary: "Vocabulary each one covers alone",
    /** "<span>A</span> only" */
    onlyBefore: "",
    onlyAfter: " only",
    difference: DIFFERENCE_WORDS as DifferenceWords,
  },
  modelRecord: {
    eyebrow: "Model record",
    title: "How each model’s quotes held up.",
    titleEmpty: "No model has a checked quote yet.",
    intro:
      "Every quote a model writes is searched for on the page it cites. This adds up, for each model, how many were found across the papers in your library. A quote that is not found is not always invented: tables, equations and scanned pages do not survive text extraction. A low rate says look closer, not that the model made it up. No model is asked; the numbers come from the projects alone.",
    byModel: "By model",
    byModelNote:
      "Sorted by the lowest rate the evidence is consistent with (a 95% Wilson interval), so a model checked on three quotes cannot outrank one checked on three hundred. Each model read different papers, and a scanned or table-heavy paper lowers any model’s rate. Reviewed claims are a person’s decisions in the Review tab.",
    columns: {
      model: "Model",
      papers: "Papers",
      quotesFound: "Quotes found on their page",
      /** Dar ekranda hücrenin önündeki etiket. */
      quotesFoundShort: "Quotes found",
      rate: "Rate",
      reviewed: "Reviewed claims",
    },
    foundOf: (found: string, checked: string) => `${found} of ${checked}`,
    likely: (low: string, high: string) => `likely ${low}–${high}`,
    reviewedCounts: (approved: number, rejected: number) => `${approved} approved · ${rejected} rejected`,
    samePaper: "Same paper, different models",
    samePaperNote: "The fairest comparison in the library: the same PDF, so the same tables and equations stood in every model’s way.",
    samePaperEmpty:
      "When the same paper is analysed with two different models, their quotes are lined up here. That is the fairest comparison, because the same tables and equations stand in both models’ way.",
    notCounted: "Not counted",
    notCountedNote: (count: number) =>
      `${count.toLocaleString("en")} project${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} left out rather than counted with numbers that could be wrong.`,
    exclusions: exclusionDescriptions as Record<ExclusionReason, string>,
    /** Stüdyoda düzeltilebilen nedenler için yol. */
    remedies: {
      "not-checked": "Open it and use Check the quotes against the PDF in Evidence health.",
      "changed-since-check": "Check them again with the PDF to count it.",
    } as Partial<Record<ExclusionReason, string>>,
    trackRecord: "Quote record in your library",
    trackRow: (found: number, checked: number, papers: number, rate: string, low: string, high: string) =>
      `${found.toLocaleString("en")} of ${checked.toLocaleString("en")} quotes found on their page, in ${papers.toLocaleString("en")} paper${papers === 1 ? "" : "s"} (${rate}, likely ${low}–${high}).`,
    trackNone: "No checked quotes from this model in your library yet.",
    modelLabel: MODEL_LABEL_WORDS as ModelLabelWords,
  },
};

const tr: typeof en = {
  pageHeader: {
    back: "Kütüphaneye dön",
    tagline: "araştırma stüdyosu",
    library: "Kütüphane",
  },
  compare: {
    eyebrow: "Yan yana",
    title: "İki makale, hizalanmış.",
    intro:
      "Burada hiçbir şey bir hüküm değil. Trace her makalenin bildirdiğini hizalıyor (aynı kıyaslama, aynı terim) ve karar verebilmen için iki kaynağı da gösteriyor. Her sayı geldiği sayfayı taşıyor.",
    etAl: " vd.",
    claims: "İddia",
    verified: "Doğrulanmış",
    pagesReached: "Ulaşılan sayfa",
    depth: "Derinlik",
    depthValues: { concise: "özlü", standard: "standart", deep: "derin" },
    openThis: "Bunu aç",
    crossLanguage: (left, right) =>
      `Bu iki proje farklı dillerde yazılmış (${left} ve ${right}). Metrikler ve terimler adlarıyla eşleştiriliyor, bu yüzden farklı dillerde yazılmış etiketler hizalanmaz. Burada az eşleşme olması makalelerin değil, ifadelerin farklı olduğunu gösterir.`,
    sameMeasurement: "İkisinde de aynı ölçüm",
    noSharedMetric:
      "Hiçbir metrik iki makalede aynı ad ve birimle geçmiyor. Bu genellikle farklı şeyler ölçtükleri anlamına gelir, aynı fikirde olmadıkları anlamına değil.",
    sameTerm: "Aynı terim, farklı tanım",
    sameTermNote:
      "İki makale de bu kelimeleri kullanıyor. Tanımlar aynı değil; ortak bir kelimeyi ortak bir fikir saymadan önce okumaya değer.",
    quiz: "İkisi üzerine kendini sına",
    quizNote:
      "Her makaleyi bilmek, onları birbirinden ayırabilmekle aynı şey değil. Bu sorular iki projenin kayıtlarından (iddiaları, yılları, metrikleri ve sözlükleri) geliyor ve her yanıt nereden geldiğini söylüyor.",
    admits: "Her birinin yapamadığını kabul ettiği şeyler",
    vocabulary: "Yalnızca birinin kapsadığı terimler",
    onlyBefore: "",
    onlyAfter: " makalesine özgü",
    difference: { equal: "eşit", locale: "tr" },
  },
  modelRecord: {
    eyebrow: "Model karnesi",
    title: "Her modelin alıntıları ne kadar tuttu.",
    titleEmpty: "Henüz hiçbir modelin denetlenmiş alıntısı yok.",
    intro:
      "Bir modelin yazdığı her alıntı, atıf yaptığı sayfada aranıyor. Bu ekran her model için kütüphanendeki makalelerde kaç tanesinin bulunduğunu topluyor. Bulunamayan bir alıntı her zaman uydurma değildir: tablolar, denklemler ve taranmış sayfalar metin çıkarmada kaybolur. Düşük bir oran “daha yakından bak” der, “model uydurdu” demez. Hiçbir modele sorulmuyor; sayılar yalnızca projelerden geliyor.",
    byModel: "Modele göre",
    byModelNote:
      "Kanıtla uyumlu en düşük orana göre sıralı (%95 Wilson aralığı); böylece üç alıntıyla denetlenen bir model, üç yüz alıntıyla denetleneni geçemez. Her model farklı makaleler okudu; taranmış ya da tablo ağırlıklı bir makale her modelin oranını düşürür. İncelenen iddialar, İnceleme sekmesinde bir insanın verdiği kararlardır.",
    columns: {
      model: "Model",
      papers: "Makale",
      quotesFound: "Sayfasında bulunan alıntı",
      quotesFoundShort: "Bulunan alıntı",
      rate: "Oran",
      reviewed: "İncelenen iddia",
    },
    foundOf: (found, checked) => `${found}/${checked}`,
    likely: (low, high) => `muhtemelen ${low}–${high}`,
    reviewedCounts: (approved, rejected) => `${approved} onaylandı · ${rejected} reddedildi`,
    samePaper: "Aynı makale, farklı modeller",
    samePaperNote: "Kütüphanedeki en adil karşılaştırma: aynı PDF, yani her modelin önüne aynı tablolar ve denklemler çıktı.",
    samePaperEmpty:
      "Aynı makale iki farklı modelle analiz edildiğinde alıntıları burada yan yana gelir. Bu en adil karşılaştırmadır, çünkü iki modelin önüne de aynı tablolar ve denklemler çıkar.",
    notCounted: "Sayılmayanlar",
    notCountedNote: (count) => `${count.toLocaleString("tr")} proje, yanlış olabilecek sayılarla sayılmak yerine dışarıda bırakıldı.`,
    exclusions: {
      "not-checked": "Alıntıları hiç PDF'e karşı denetlenmedi.",
      "model-not-recorded": "Proje, onu hangi modelin yazdığını söylemiyor.",
      "check-truncated": "Denetimi bulunamayan alıntıları 400'de listelemeyi bıraktı; oranı olduğundan iyi görünürdü.",
      "changed-since-check": "Alıntıları denetlendikten sonra kanıt değişti.",
      "stage-unknown": "Kanıtını iki model yazdı ve bazı iddiaların hangi aşamada yazıldığı izlenemiyor.",
    },
    remedies: {
      "not-checked": "Projeyi aç ve Kanıt sağlığı bölümünden alıntıları PDF'e karşı denetle.",
      "changed-since-check": "Sayılması için alıntıları PDF'le yeniden denetle.",
    },
    trackRecord: "Kütüphanendeki alıntı karnesi",
    trackRow: (found, checked, papers, rate, low, high) =>
      `${papers.toLocaleString("tr")} makalede ${checked.toLocaleString("tr")} alıntının ${found.toLocaleString("tr")} tanesi sayfasında bulundu (${rate}, muhtemelen ${low}–${high}).`,
    trackNone: "Kütüphanende bu modelin henüz denetlenmiş alıntısı yok.",
    modelLabel: { agent: "Ajan" },
  },
};

const records = { en, tr };

export default records;
