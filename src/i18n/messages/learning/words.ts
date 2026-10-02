import { ALIAS_WORDS } from "@/lib/concept-aliases";
import { CROSS_QUESTION_WORDS } from "@/lib/cross-questions";
import { MISSING_BLOCK_WORDS } from "@/lib/learning-health";
import { READING_DRILL_WORDS } from "@/lib/reading-drill";
import { READING_LIST_LIMIT_WORDS, SAVED_REASON_WORDS } from "@/lib/reading-list";
import { POSITION_LABEL_WORDS } from "@/lib/reading-position";
import { REFERENCE_IMPORT_WORDS } from "@/lib/reference-import";
import { DUE_WORDS } from "@/lib/review-schedule";
import { stringsFor } from "@/visuals/i18n";

/**
 * Kütüphane modüllerinin (`src/lib`) okuyucuya yazdığı cümleler. Bu modüller
 * eklentinin paketine de giriyor ve sözlüğü içe aktaramıyor: kelimeleri
 * isteğe bağlı bir parametreyle alıyorlar. İngilizcesi modülün kendi
 * varsayılanı (ajan çıktısıyla aynı), Türkçesi burada.
 *
 * Kullanım: `describeDue(due, now, t.learning.words.due)`.
 */
const en = {
  words: {
    due: DUE_WORDS,
    missingBlocks: MISSING_BLOCK_WORDS,
    savedReason: SAVED_REASON_WORDS,
    readingListLimits: READING_LIST_LIMIT_WORDS,
    referenceImport: REFERENCE_IMPORT_WORDS,
    positionLabel: POSITION_LABEL_WORDS,
    crossQuestions: CROSS_QUESTION_WORDS,
    alias: ALIAS_WORDS,
    readingDrill: READING_DRILL_WORDS,
  },
};

const tr: typeof en = {
  words: {
    due: { now: "şimdi", tomorrow: "yarın", inDays: (days) => `${days} gün sonra` },
    missingBlocks: {
      nouns: {
        primer: "ön bilgi",
        quiz: "test",
        misreadings: "sık yapılan yanlış okumalar",
        derivations: "türetimler",
        interactives: "etkileşimli keşifler",
        applicationGuide: "uygulama rehberi",
      },
      list: (nouns) => (nouns.length <= 1 ? (nouns[0] ?? "") : `${nouns.slice(0, -1).join(", ")} ve ${nouns[nouns.length - 1]}`),
    },
    savedReason: {
      beforeConcept: (title, concept) =>
        concept ? `${title} makalesinden önce: o makalenin varsaydığı ${concept} kavramını anlatıyor.` : `${title} makalesinden önce: o makalenin varsaydığı bir kavramı anlatıyor.`,
      beforeReference: (title) => `${title} makalesinden önce: o makale bunun üzerine kurulu.`,
      afterCitedBy: (title) => `${title} makalesinden sonra: o makaleye atıf yapıyor.`,
      explainsConcept: (title, concept) =>
        concept ? `${title} makalesinin varsaydığı ${concept} kavramını anlatıyor.` : `${title} makalesinin varsaydığı bir kavramı anlatıyor.`,
      buildsOn: (title) => `${title} makalesi bunun üzerine kurulu.`,
      cites: (title) => `${title} makalesine atıf yapıyor.`,
    },
    readingListLimits: {
      full: (max) => `Okuma listesi en çok ${max} makale alır.`,
      tooMany: (max, room) => `Okuma listesi en çok ${max} makale alır; ${room} tane daha sığar.`,
    },
    referenceImport: {
      tooLarge: "Dosya 5 MB sınırını aşıyor.",
      unknownFormat: "Bu bir BibTeX, RIS ya da CSL JSON dosyası değil. Zotero'da Koleksiyonu Dışa Aktar… ile bu biçimlerden birini seç.",
      unreadable: (format) => `${format} dosyası okunamadı.`,
    },
    positionLabel: { label: (at, total, title) => `bölüm ${at}/${total}, “${title}”` },
    crossQuestions: {
      page: (page) => `s. ${page}`,
      itsSources: "kaynaklarında",
      whoSays: (statement) => `Bunu hangi makale söylüyor? “${statement}”`,
      yesHere: (where, excerpt) => `Evet, bu makalede (${where}): “${excerpt}”`,
      notHere: "Bu makalenin kanıtında yok.",
      whichFirst: "İki makaleden hangisi önce yayımlandı?",
      isFrom: (title, year) => `${title} makalesinin yılı ${year}.`,
      whichHigher: (metric, unit) => `İki makale de ${metric}${unit ? ` (${unit})` : ""} değerini bildiriyor. Hangisi daha yüksek bir değer bildiriyor?`,
      higherValue: (title, value) => `${title}: ${value}. Daha yüksek her zaman daha iyi değildir; hangi yönün iyi olduğunu makale söyler.`,
      valueOnPage: (value, page) => `${value} (s. ${page})`,
      whoDefines: (term) => `Hangi makale sözlüğünde “${term}” terimini tanımlıyor?`,
      definesIt: (term) => `Bu makale tanımlıyor; öteki makalenin sözlüğünde “${term}” yok.`,
      doesNotDefine: (term) => `Bu makalenin sözlüğünde “${term}” yok.`,
      whoseDefinition: (term, title) => `İki makale de “${term}” terimini tanımlıyor. Hangi tanım ${title} makalesine ait?`,
      definedBy: (title) => `${title} makalesi onu böyle tanımlıyor.`,
    },
    alias: { sameName: "Bunlar aynı adın iki yazımı; bağlanacak bir şey yok." },
    // Görsellerle ortak (bağımsız görüntüleyici de kullanıyor): tek Türkçe.
    readingDrill: stringsFor(undefined, "tr").drill,
  },
};

const words = { en, tr };

export default words;
