import { READING_SHARE_WORDS, type ReadingShareWords } from "@/lib/reading-share";
import type { UiLanguage } from "../languages";

/**
 * Sunucunun stüdyonun dışına verdiği sayfalar: paylaşılan okuma listesi
 * (`/r/<kimlik>`), bulunamayan liste ve yayın sayfaları, okuma listesi
 * paylaşımının hataları.
 *
 * Kayıtta (`messages/index.ts`) değil: rotalar ve okuma listesi deposu
 * doğrudan buradan alıyor. Bulunamayan sayfa ziyaretçinin dilinde; paylaşılan
 * liste onu paylaşanın dilinde (kayıttaki `language`).
 */
const en = {
  /** Bulunamayan, yayından kaldırılmış ya da süresi dolmuş liste ve hikâye. */
  notAvailable: {
    title: "Not available",
    readingListHeading: "This reading list is not available",
    readingListBody: "The link may be wrong, or the person who shared it has taken it down.",
    storyHeading: "This story is not available",
    storyBody: "The link may be wrong, or its author has unpublished it.",
  },
  /** Paylaşılan listenin kaydı ve sayfası (`reading-share.ts`). */
  readingShare: READING_SHARE_WORDS,
  /** `/api/reading-list/share` hataları; stüdyo bunları olduğu gibi gösteriyor. */
  shareApi: {
    invalidRequest: "The request is not valid.",
    invalidJson: "The request is not valid JSON.",
    readFailed: "The shared lists could not be read.",
    nothingToShare: "Save a work to read later before sharing the list.",
    shareFailed: "The list could not be shared.",
    notFound: "The shared list was not found.",
    updateFailed: "The shared list could not be updated.",
    deleteFailed: "The shared list could not be deleted.",
  },
};

const readingShareTr: ReadingShareWords = {
  lang: "tr",
  defaultTitle: "Okuma listesi",
  alreadyAnalysed: "Listede ve zaten analiz edildi.",
  reasons: {
    beforeConcept: (title, concept) =>
      concept
        ? `${title} makalesinden önce: o makalenin bildiğini varsaydığı “${concept}” kavramını anlatıyor.`
        : `${title} makalesinden önce: o makalenin bildiğini varsaydığı bir kavramı anlatıyor.`,
    beforeReference: (title) => `${title} makalesinden önce: o makale bunun üzerine kuruluyor.`,
    afterCitedBy: (title) => `${title} makalesinden sonra: o makaleye atıf yapıyor.`,
    explainsConcept: (title, concept) =>
      concept
        ? `${title} makalesinin bildiğini varsaydığı “${concept}” kavramını anlatıyor.`
        : `${title} makalesinin bildiğini varsaydığı bir kavramı anlatıyor.`,
    buildsOn: (title) => `${title} makalesi bunun üzerine kuruluyor.`,
    cites: (title) => `${title} makalesine atıf yapıyor.`,
  },
  eyebrow: "Okuma listesi",
  kindPaper: "Trace ile okundu",
  kindSaved: "Okunacak",
  etAl: " vd.",
  lede: (count, updated) =>
    `Okuma sırasıyla ${count} çalışma: bir çalışma, onun üzerine kurulan ya da anlattığı bir kavrama ihtiyaç duyan makaleden önce, atıf yaptığı makaleden sonra geliyor. Güncelleme: ${updated}.`,
  footer: "Kanıta dayalı bir araştırma stüdyosu olan Trace'ten paylaşıldı. Yalnızca liste paylaşılıyor; notlar ve okuma ilerlemesi paylaşılmıyor.",
};

const tr: typeof en = {
  notAvailable: {
    title: "Erişilemiyor",
    readingListHeading: "Bu okuma listesine erişilemiyor",
    readingListBody: "Bağlantı yanlış olabilir ya da listeyi paylaşan kişi onu kaldırmış olabilir.",
    storyHeading: "Bu hikâyeye erişilemiyor",
    storyBody: "Bağlantı yanlış olabilir ya da yazarı hikâyeyi yayından kaldırmış olabilir.",
  },
  readingShare: readingShareTr,
  shareApi: {
    invalidRequest: "İstek geçerli değil.",
    invalidJson: "İstek geçerli bir JSON değil.",
    readFailed: "Paylaşılan listeler okunamadı.",
    nothingToShare: "Listeyi paylaşmak için önce “Sonra oku” ile bir çalışma kaydet.",
    shareFailed: "Liste paylaşılamadı.",
    notFound: "Paylaşılan liste bulunamadı.",
    updateFailed: "Paylaşılan liste güncellenemedi.",
    deleteFailed: "Paylaşılan liste silinemedi.",
  },
};

const pages = { en, tr };

/** Bir dilin metinleri; dil yoksa (eski kayıt) İngilizce. */
export function pagesFor(language: UiLanguage | undefined) {
  return pages[language ?? "en"];
}

export default pages;
