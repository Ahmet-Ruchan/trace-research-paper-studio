import { EXPORT_MENU_WORDS, type ExportMenuWords } from "@/lib/exports";
import { PUBLISHED_NOTES_WORDS, type PublicationSummary, type PublishedNotesWords } from "@/lib/publications";
import type { NoteGroup } from "@/lib/reader-notes";

/** Yayımlama, yayın sayfasındaki notlar, atıf grafiği ve dışa aktarma menüsü. */
type PublicationState = PublicationSummary["state"];
type PublishBlock = "deepReport" | "technicalAppendix" | "learning" | "figures";
type NotePlace = NoteGroup["place"];

const en = {
  publish: {
    states: { live: "Live", unpublished: "Unpublished", expired: "Expired" } as Record<PublicationState, string>,
    blocks: {
      deepReport: "Deep report",
      technicalAppendix: "Technical appendix",
      learning: "Learning layer",
      figures: "The paper's own figures",
    } as Record<PublishBlock, string>,
    /** `groupNotes` yerleri; İngilizcesi kayıttaki adın kendisi. */
    places: { Lab: "Lab", Story: "Story", "Deep report": "Deep report", Primer: "Primer", Claim: "Claim" } as Record<NotePlace, string>,
    loadFailed: "The publications could not be loaded.",
    kicker: "Share",
    title: "Publish this story",
    intro:
      "A publication is a frozen copy with its own link. Later edits stay private until you update it. Anyone who can reach this Trace server and has the link can read it: on this machine that is only you, on a deployed studio it is everyone with the link. Search engines are asked not to index it.",
    include: "Include",
    storyAndEvidence: "Story and evidence, with every quote and page",
    notInProject: " · not in this project",
    notes: "Notes I choose, as the author’s notes at the end",
    notesAria: "Notes to publish",
    notesNote: "Only the notes ticked here go out, as they are now; Update takes their latest wording. Nothing else from your notes is published.",
    expiry: "Link stops working",
    afterDays: (days: number) => `After ${days} days`,
    never: "Never",
    publishing: "Publishing…",
    publishNew: "Publish a new link",
    empty: "This project has not been published yet.",
    publishedAt: (date: string) => `Published ${date}`,
    expires: (expired: boolean, date: string) => ` · ${expired ? "expired" : "expires"} ${date}`,
    without: (blocks: readonly string[]) => ` · without ${blocks.join(", ").toLowerCase()}`,
    withNotes: (count: number) => ` · with ${count} of your notes`,
    stale: "The project has changed since this copy was taken.",
    copyFailed: "The link could not be copied; open it and copy it from the address bar.",
    copyLink: "Copy link",
    update: "Update to current version",
    removeExpiry: "Remove expiry",
    unpublish: "Unpublish",
    publishAgain: "Publish again",
    deleteLink: "Delete link",
  },
  /** Yayın sayfasının sonundaki notlar (`withPublishedNotes`). */
  sharedNotes: PUBLISHED_NOTES_WORDS as PublishedNotesWords,
  citations: {
    loadFailed: "The citation graph could not be loaded.",
    kicker: "Citation graph",
    title: "What this paper builds on, and what built on it",
    intro:
      "The most-cited works on each side, from OpenAlex. This is context, not evidence: none of it comes from the paper's pages, the counts change over time, and it is not saved into the project.",
    looking: "Looking the paper up in OpenAlex…",
    noGraph: (reason: string) =>
      `No citation graph for this paper: ${reason}. Trace only accepts an exact title match, because a graph for the wrong paper is worse than none.`,
    noAnswer: "OpenAlex did not answer",
    /** "<b>12</b> references · <b>340</b> citing works · retrieved 1 Oct 2026" */
    references: "references",
    citingWorks: "citing works",
    retrieved: "retrieved",
    fullRecord: "full record on OpenAlex",
    bibtex: "BibTeX for the paper and these works",
    mapAria: "Citation map: references on the left, citing works on the right",
    buildsOn: "Builds on",
    buildsOnEmpty: "OpenAlex lists no references for this record.",
    citedBy: "Cited by",
    citedByEmpty: "No citing works are indexed yet.",
    etAl: " et al.",
    citationCount: (count: string) => `${count} citations`,
    analyseTitle: "Find this paper and analyse it",
    lookUpTitle: "No open-access copy on a source Trace downloads from; you can still look it up",
    analyse: "Analyse",
    lookUp: "Look up",
  },
  /** Dışa aktarma menüsü (`exportMenuText`); menünün kendisi stüdyonun çalışma alanında. */
  exportMenu: EXPORT_MENU_WORDS as ExportMenuWords,
};

const trPlaces: Record<NotePlace, string> = {
  Lab: "Lab",
  Story: "Hikâye",
  "Deep report": "Ayrıntılı rapor",
  Primer: "Ön bilgi",
  Claim: "İddia",
};

const tr: typeof en = {
  publish: {
    states: { live: "Yayında", unpublished: "Yayından kaldırıldı", expired: "Süresi doldu" },
    blocks: {
      deepReport: "Ayrıntılı rapor",
      technicalAppendix: "Teknik ek",
      learning: "Öğrenme katmanı",
      figures: "Makalenin kendi şekilleri",
    },
    places: trPlaces,
    loadFailed: "Yayınlar yüklenemedi.",
    kicker: "Paylaş",
    title: "Bu hikâyeyi yayımla",
    intro:
      "Yayın, kendi bağlantısı olan dondurulmuş bir kopyadır. Sonraki düzenlemeler sen güncelleyene kadar sende kalır. Bu Trace sunucusuna erişebilen ve bağlantıyı bilen herkes okuyabilir: bu bilgisayarda yalnızca sen, yayına alınmış bir stüdyoda bağlantıyı bilen herkes. Arama motorlarından onu dizine eklememeleri istenir.",
    include: "Dahil et",
    storyAndEvidence: "Hikâye ve kanıt, her alıntı ve sayfasıyla",
    notInProject: " · bu projede yok",
    notes: "Seçtiğim notlar, sonda yazarın notları olarak",
    notesAria: "Yayımlanacak notlar",
    notesNote: "Yalnızca burada işaretlenen notlar, şimdiki halleriyle yayımlanır; güncellemek en son hallerini alır. Notlarından başka hiçbir şey yayımlanmaz.",
    expiry: "Bağlantının süresi",
    afterDays: (days) => `${days} gün sonra dolsun`,
    never: "Hiç dolmasın",
    publishing: "Yayımlanıyor…",
    publishNew: "Yeni bağlantı yayımla",
    empty: "Bu proje henüz yayımlanmadı.",
    publishedAt: (date) => `Yayımlandı: ${date}`,
    expires: (expired, date) => ` · ${expired ? "süresi doldu" : "süresi doluyor"}: ${date}`,
    without: (blocks) => ` · ${blocks.join(", ").toLocaleLowerCase("tr")} olmadan`,
    withNotes: (count) => ` · ${count} notunla`,
    stale: "Bu kopya alındıktan sonra proje değişti.",
    copyFailed: "Bağlantı kopyalanamadı; aç ve adres çubuğundan kopyala.",
    copyLink: "Bağlantıyı kopyala",
    update: "Şu anki sürüme güncelle",
    removeExpiry: "Süre sınırını kaldır",
    unpublish: "Yayından kaldır",
    publishAgain: "Yeniden yayımla",
    deleteLink: "Bağlantıyı sil",
  },
  sharedNotes: {
    heading: "Yazarın notları",
    intro: "Bu hikâyeyi paylaşan kişi kendi notlarını ekledi. Notlar analizin parçası değil ve kendi başlarına kanıt taşımıyor.",
    places: trPlaces,
    paperBlocks: {
      thesis: "Ana tez",
      question: "Araştırma sorusu",
      summary: "Sade dille özet",
      methods: "Yöntem",
      limitations: "Sınırlılıklar",
      technical: "Teknik ek",
    },
    page: (page) => `s. ${page}`,
  },
  citations: {
    loadFailed: "Atıf grafiği yüklenemedi.",
    kicker: "Atıf grafiği",
    title: "Bu makalenin dayandıkları ve ona dayananlar",
    intro:
      "İki taraftaki en çok atıf alan çalışmalar, OpenAlex'ten. Bu kanıt değil, bağlam: hiçbiri makalenin sayfalarından gelmiyor, sayılar zamanla değişiyor ve projeye kaydedilmiyor.",
    looking: "Makale OpenAlex'te aranıyor…",
    noGraph: (reason) =>
      `Bu makale için atıf grafiği yok: ${reason}. Trace yalnızca başlığı birebir eşleşen kaydı kabul ediyor, çünkü yanlış makalenin grafiği hiç olmamasından kötü.`,
    noAnswer: "OpenAlex yanıt vermedi",
    references: "kaynak",
    citingWorks: "atıf yapan çalışma",
    retrieved: "alınma tarihi",
    fullRecord: "OpenAlex'teki tam kayıt",
    bibtex: "Makale ve bu çalışmalar için BibTeX",
    mapAria: "Atıf haritası: solda kaynaklar, sağda atıf yapan çalışmalar",
    buildsOn: "Dayandıkları",
    buildsOnEmpty: "OpenAlex bu kayıt için hiç kaynak listelemiyor.",
    citedBy: "Atıf yapanlar",
    citedByEmpty: "Henüz dizinlenmiş atıf yapan çalışma yok.",
    etAl: " vd.",
    citationCount: (count) => `${count} atıf`,
    analyseTitle: "Bu makaleyi bul ve analiz et",
    lookUpTitle: "Trace'in indirdiği kaynaklarda açık erişimli bir kopyası yok; yine de arayabilirsin",
    analyse: "Analiz et",
    lookUp: "Ara",
  },
  exportMenu: {
    md: { label: "Markdown raporu", description: "Obsidian, Notion ya da bir depo için. Her iddia alıntısı ve sayfasıyla." },
    html: { label: "Yazdırılabilir rapor (PDF)", description: "Bir sayfa olarak açılır; yazdır ve “PDF olarak kaydet”i seç." },
    slides: { label: "Slaytlar", description: "Hikâyenin her bölümü için bir slayt, her biri alıntısı ve sayfasıyla. Ok tuşlarıyla ilerle." },
    ipynb: {
      label: "Jupyter not defteri",
      description: "Makalenin denklemleri, makalenin kendi değerlerinden başlayan çalıştırılabilir NumPy kodu olarak.",
      unavailable: "Bu projede koda dönüştürülecek bir formül oyun alanı yok.",
    },
    bib: { label: "BibTeX", description: "Makalenin atıf kaydı; LaTeX, Zotero ya da Mendeley için." },
    ris: { label: "RIS", description: "Aynı atıf kaydı; Zotero, EndNote ve çoğu kaynak yöneticisi için." },
    anki: {
      label: "Anki kartları",
      description: "Ön bilgi kavramları, test soruları ve sözlük; her kart alıntısı ve sayfasıyla.",
      unavailable: "Bu projede kart yapılacak ön bilgi, test ya da sözlük yok.",
    },
  },
};

const sharing = { en, tr };

export default sharing;
