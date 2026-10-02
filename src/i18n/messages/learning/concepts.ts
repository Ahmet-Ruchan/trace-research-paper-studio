const s = (count: number) => (count === 1 ? "" : "s");

/** Kavramlar: Lab'deki kavram paneli, kavram notu, kavram haritası, eş adlar ve literatür haritası. */
const en = {
  conceptsView: {
    noRecord: (reason: string) => `OpenAlex has no certain record of this paper (${reason}).`,
    referencesFailed: "The references could not be loaded.",
    readFirst: "Read first",
    readFirstNote: (count: number) =>
      count === 1
        ? "One paper in your library defines, in its glossary, concepts this paper assumes. Reading it first means this one builds on something you know."
        : `${count} papers in your library define, in their glossaries, concepts this paper assumes. Reading them first means this one builds on something you know.`,
    defines: (list: string) => `defines ${list}`,
    summary: (total: number, here: number, elsewhere: number, inOther: number) =>
      `Of ${total} concept${s(total)} this paper assumes, you studied ${here} here and ${elsewhere} in other papers; ${inOther} ${inOther === 1 ? "is" : "are"} explained in other papers you have not studied yet.`,
    studiedHere: "Studied here",
    studiedElsewhere: "Studied in another paper",
    inOtherPapers: (count: number) => `In ${count} other paper${s(count)}, not studied yet`,
    onlyHere: "Only in this paper",
    suggestTitle: "Papers that teach what you have not studied yet",
    suggestNote: (count: number) =>
      `Looks through the works this paper cites (the 50 most-cited, from OpenAlex) for a title, then an abstract, that names one of the ${count} concept${s(count)} you have not studied in any paper. It is a match on the words, not a judgement of the work, and an abstract match shows the sentence it rests on: open the work and decide.`,
    look: "Look in the references",
    reading: "Reading the reference list…",
    cited: (times: string) => ` · cited ${times} times`,
    titleNames: (phrase: string) => ` · the title names “${phrase}”`,
    abstractNames: (phrase: string) => ` · its abstract names “${phrase}”`,
    alreadyOwned: " · already in your library",
    openIt: "Open it",
    analyze: "Analyze it",
    openWork: (title: string) => `Open ${title}`,
    noneMatch: (count: number) => `None of the ${count} reference${s(count)} OpenAlex lists names these concepts in its title or abstract.`,
  },
  conceptNote: {
    studiedIn: "You studied this in ",
    othersToo: (count: number) => `; ${count === 1 ? "another paper" : `${count} other papers`} in your library explain it too`,
    moveOn: ". Skim it here, or move on.",
    alsoIn: "Also explained in ",
    and: " and ",
    more: (count: number) => ` and ${count} more`,
    end: ".",
  },
  conceptMap: {
    eyebrow: "Concept map",
    heading: (count: number) => (count ? `${count} ${count === 1 ? "concept connects" : "concepts connect"} your papers.` : "No concept connects two papers yet."),
    intro: (total: number) =>
      `The concepts more than one paper in your library explains, from their primers and glossaries, matched by name. A check mark means you studied it in that paper. Spellings are compared loosely (case, hyphens, British and American endings, plurals), never by meaning, so two names for one idea stay apart. ${total} names in all.`,
    orderTitle: "A reading order",
    orderEmpty:
      "Nothing to put in order yet. Papers in your library that define a concept another one assumes are ordered here, and so are the works you save to read later: from a paper’s citation graph, its concept suggestions, or all at once from Zotero below.",
    orderNote:
      "Each paper comes after the papers that define, in their glossary, a concept it assumes. Where nothing decides, the older paper comes first. Papers you saved to read later take their place: before the paper that builds on them or needs a concept they explain, after the paper they cite.",
    unconnected: (count: number) =>
      `${count === 1 ? "One paper is" : `${count} papers are`} not connected to the others this way and ${count === 1 ? "is" : "are"} left out.`,
    next: "Next",
    /** "After <em>başlık</em>: …" — başlık ikisinin arasında. */
    after: { before: "After ", rest: (terms: string) => `: it assumes ${terms}, which that paper defines.` },
    together: (titles: readonly string[]) => `Read it alongside ${titles.join(" and ")}: each defines something the other assumes.`,
    alsoOnList: "Also on your reading list",
    yourList: "Your reading list",
    papers: (count: number) => `${count} papers`,
    primer: "primer",
    glossary: "glossary",
    as: (term: string) => ` · as “${term}”`,
    empty: "Once two papers in your library explain the same concept, it appears here with both of them.",
  },
  conceptAliases: {
    coverage: (names: number, parts: number) => `${names} names, read in ${parts} parts; names with similar definitions were kept in the same part.`,
    failedParts: (failed: number, parts: number) => `${failed} of ${parts} parts could not be read; ask again to try them.`,
    unread: (unread: number) => `${unread} names did not fit in the parts a model is asked at once; link them yourself above if you know another name for one.`,
    saveFailed: "The concept link could not be saved.",
    keyRequired: (label: string) => `${label} is required.`,
    askFailed: "The model could not be asked.",
    title: "Names for the same concept",
    intro:
      "Concepts are matched by name, so one idea under two names stays two concepts. Link them yourself, or ask a model which names in your library may mean the same thing; it only proposes, and nothing is linked until you say so. Links are kept in your library, never in a paper.",
    byModel: "proposed by a model, confirmed by you",
    byYou: "linked by you",
    unlinkLabel: (a: string, b: string) => `Unlink ${a} and ${b}`,
    unlink: "Unlink",
    apart: (count: number) => `${count === 1 ? "One pair was" : `${count} pairs were`} marked as different and will not be proposed again.`,
    firstName: "First name",
    secondName: "Second name",
    firstPlaceholder: "A concept…",
    secondPlaceholder: "…and its other name",
    link: "Link them",
    ask: "Ask a model for other names",
    askNote: "The model sees the names of the concepts in your library and the definitions their papers give, nothing else.",
    readingNames: (count: number) => `Reading ${count} names…`,
    look: "Look for other names",
    proposed: "Proposed pairs",
    same: "Same concept",
    different: "Different",
    noneFound: (model: string) => `${model} found no other names for the same concept.`,
  },
  literatureMap: {
    eyebrow: "Literature map",
    heading: (count: number) => `${count} papers, in the order they appeared.`,
    intro:
      "Nothing here is a verdict. Trace lines up what each paper reports — the same benchmark, the same term — in year order, with the page every number came from. A value that grows over the years is not progress by itself: the dataset, the setup and which direction is better are things the papers say, not this screen.",
    papersTitle: "The papers",
    etAl: " et al.",
    venueUnknown: "venue unknown",
    claims: "Claims",
    verified: "Verified",
    pagesReached: "Pages reached",
    depth: "Depth",
    openThis: "Open this one",
    languages: (list: string) =>
      `These projects were written in different languages (${list}). Metrics and terms are matched by name, so labels written in different languages will not line up — few matches here means the wording differs, not the papers.`,
    metricsTitle: "The same measurement across papers",
    metricsEmpty: "No metric appears in two or more of these papers under the same name and unit. That usually means they measure different things — not that they disagree.",
    termsTitle: "The same term, defined differently",
    termsNote: "These words recur across the papers with definitions that are not identical — worth reading before treating a shared word as a shared idea.",
    limitsTitle: "What each admits it cannot do",
    sparkLabel: (label: string, count: number) => `${label} as reported by ${count} papers, in year order`,
    web: "web",
  },
};

const tr: typeof en = {
  conceptsView: {
    noRecord: (reason) => `OpenAlex'te bu makalenin kesin bir kaydı yok (${reason}).`,
    referencesFailed: "Kaynaklar yüklenemedi.",
    readFirst: "Önce oku",
    readFirstNote: (count) =>
      count === 1
        ? "Kütüphanendeki bir makale, bu makalenin varsaydığı kavramları sözlüğünde tanımlıyor. Önce onu okursan bu makale bildiğin bir şeyin üzerine kurulur."
        : `Kütüphanendeki ${count} makale, bu makalenin varsaydığı kavramları sözlüklerinde tanımlıyor. Önce onları okursan bu makale bildiğin bir şeyin üzerine kurulur.`,
    defines: (list) => `tanımlıyor: ${list}`,
    summary: (total, here, elsewhere, inOther) =>
      `Bu makalenin varsaydığı ${total} kavramdan ${here} tanesini burada, ${elsewhere} tanesini başka makalelerde çalıştın; ${inOther} tanesi henüz çalışmadığın başka makalelerde anlatılıyor.`,
    studiedHere: "Burada çalışıldı",
    studiedElsewhere: "Başka bir makalede çalışıldı",
    inOtherPapers: (count) => `${count} başka makalede var, henüz çalışılmadı`,
    onlyHere: "Yalnızca bu makalede",
    suggestTitle: "Henüz çalışmadıklarını öğreten makaleler",
    suggestNote: (count) =>
      `Bu makalenin atıf yaptığı çalışmalar (OpenAlex'e göre en çok atıf alan 50 tanesi) arasında, hiçbir makalede çalışmadığın ${count} kavramdan birini önce başlığında, sonra özetinde anan çalışmaları arar. Bu bir kelime eşleşmesi, çalışma hakkında bir yargı değil; özetteki bir eşleşme dayandığı cümleyi gösterir: çalışmayı aç ve kendin karar ver.`,
    look: "Kaynaklarda ara",
    reading: "Kaynak listesi okunuyor…",
    cited: (times) => ` · ${times} atıf`,
    titleNames: (phrase) => ` · başlığında “${phrase}” geçiyor`,
    abstractNames: (phrase) => ` · özetinde “${phrase}” geçiyor`,
    alreadyOwned: " · zaten kütüphanende",
    openIt: "Aç",
    analyze: "Analiz et",
    openWork: (title) => `Aç: ${title}`,
    noneMatch: (count) => `OpenAlex'in listelediği ${count} kaynağın hiçbiri başlığında ya da özetinde bu kavramları anmıyor.`,
  },
  conceptNote: {
    studiedIn: "Bunu şu makalede çalıştın: ",
    othersToo: (count) => `; kütüphanendeki ${count === 1 ? "başka bir makale" : `${count} başka makale`} de anlatıyor`,
    moveOn: ". Burada göz gezdir ya da geç.",
    alsoIn: "Şuralarda da anlatılıyor: ",
    and: " ve ",
    more: (count) => ` ve ${count} makale daha`,
    end: ".",
  },
  conceptMap: {
    eyebrow: "Kavram haritası",
    heading: (count) => (count ? `${count} kavram makalelerini birbirine bağlıyor.` : "Henüz iki makaleyi bağlayan bir kavram yok."),
    intro: (total) =>
      `Kütüphanende birden çok makalenin ön bilgisinde ya da sözlüğünde anlatılan kavramlar, adlarıyla eşleştirilmiş. Onay işareti, kavramı o makalede çalıştığın anlamına gelir. Yazımlar gevşek karşılaştırılır (büyük-küçük harf, kısa çizgi, İngiliz ve Amerikan yazımı, çoğul ekleri), anlamına göre asla; bu yüzden aynı fikrin iki adı ayrı kalır. Toplam ${total} ad.`,
    orderTitle: "Bir okuma sırası",
    orderEmpty:
      "Henüz sıraya konacak bir şey yok. Kütüphanende başka bir makalenin varsaydığı bir kavramı tanımlayan makaleler burada sıralanır; sonra okumak için kaydettiğin çalışmalar da: bir makalenin atıf grafiğinden, kavram önerilerinden ya da aşağıdan Zotero'dan hepsi birden.",
    orderNote:
      "Her makale, varsaydığı bir kavramı sözlüğünde tanımlayan makalelerden sonra gelir. Hiçbir şey belirlemiyorsa eski makale önce gelir. Sonra okumak için kaydettiğin çalışmalar da yerini alır: onların üzerine kurulan ya da anlattıkları bir kavrama ihtiyaç duyan makaleden önce, atıf yaptıkları makaleden sonra.",
    unconnected: (count) =>
      count === 1 ? "Bir makale ötekilere bu yolla bağlı değil ve dışarıda kaldı." : `${count} makale ötekilere bu yolla bağlı değil ve dışarıda kaldı.`,
    next: "Sıradaki",
    after: { before: "Şundan sonra: ", rest: (terms) => `. Varsaydığı kavramları (${terms}) o makale tanımlıyor.` },
    together: (titles) => `Şununla birlikte oku: ${titles.join(" ve ")}. Her biri ötekinin varsaydığı bir şeyi tanımlıyor.`,
    alsoOnList: "Okuma listende ayrıca",
    yourList: "Okuma listen",
    papers: (count) => `${count} makale`,
    primer: "ön bilgi",
    glossary: "sözlük",
    as: (term) => ` · “${term}” adıyla`,
    empty: "Kütüphanendeki iki makale aynı kavramı anlattığında kavram, ikisiyle birlikte burada görünür.",
  },
  conceptAliases: {
    coverage: (names, parts) => `${names} ad, ${parts} parçada okundu; tanımları benzeyen adlar aynı parçada tutuldu.`,
    failedParts: (failed, parts) => `${parts} parçadan ${failed} tanesi okunamadı; onları denemek için yeniden sor.`,
    unread: (unread) => `${unread} ad, bir modele tek seferde sorulan parçalara sığmadı; birinin başka bir adını biliyorsan yukarıda kendin bağla.`,
    saveFailed: "Kavram bağı kaydedilemedi.",
    keyRequired: (label) => `${label} gerekli.`,
    askFailed: "Modele sorulamadı.",
    title: "Aynı kavramın adları",
    intro:
      "Kavramlar adlarıyla eşleşir; bu yüzden iki adla anılan bir fikir iki ayrı kavram olarak kalır. Onları kendin bağla ya da kütüphanendeki hangi adların aynı şeyi anlatıyor olabileceğini bir modele sor; model yalnızca önerir, sen onaylamadıkça hiçbir şey bağlanmaz. Bağlar kütüphanende tutulur, hiçbir makalede değil.",
    byModel: "bir model önerdi, sen onayladın",
    byYou: "sen bağladın",
    unlinkLabel: (a, b) => `Bağı kaldır: ${a} ve ${b}`,
    unlink: "Bağı kaldır",
    apart: (count) =>
      count === 1 ? "Bir çift farklı olarak işaretlendi ve yeniden önerilmeyecek." : `${count} çift farklı olarak işaretlendi ve yeniden önerilmeyecek.`,
    firstName: "Birinci ad",
    secondName: "İkinci ad",
    firstPlaceholder: "Bir kavram…",
    secondPlaceholder: "…ve öteki adı",
    link: "Bağla",
    ask: "Başka adları bir modele sor",
    askNote: "Model yalnızca kütüphanendeki kavramların adlarını ve makalelerinin verdiği tanımları görür, başka hiçbir şeyi değil.",
    readingNames: (count) => `${count} ad okunuyor…`,
    look: "Başka adları ara",
    proposed: "Önerilen çiftler",
    same: "Aynı kavram",
    different: "Farklı",
    noneFound: (model) => `${model} aynı kavram için başka bir ad bulamadı.`,
  },
  literatureMap: {
    eyebrow: "Literatür haritası",
    heading: (count) => `${count} makale, yayımlandıkları sırayla.`,
    intro:
      "Burada hiçbir şey bir hüküm değil. Trace her makalenin bildirdiğini — aynı kıyaslama testini, aynı terimi — yıl sırasıyla, her sayının geldiği sayfayla birlikte hizalıyor. Yıllar içinde büyüyen bir değer tek başına ilerleme değildir: veri kümesi, deney düzeni ve hangi yönün daha iyi olduğu makalelerin söyleyeceği şeyler, bu ekranın değil.",
    papersTitle: "Makaleler",
    etAl: " vd.",
    venueUnknown: "yayın yeri bilinmiyor",
    claims: "İddialar",
    verified: "Doğrulanan",
    pagesReached: "Ulaşılan sayfalar",
    depth: "Derinlik",
    openThis: "Bunu aç",
    languages: (list) =>
      `Bu projeler farklı dillerde yazılmış (${list}). Ölçütler ve terimler adlarıyla eşleşiyor; farklı dillerde yazılmış etiketler hizalanmaz — burada eşleşmenin az olması makalelerin değil, ifadelerin farklı olduğunu gösterir.`,
    metricsTitle: "Makaleler arasında aynı ölçüm",
    metricsEmpty: "Bu makalelerin ikisinde ya da daha fazlasında aynı ad ve birimle geçen bir ölçüt yok. Bu genellikle farklı şeyler ölçtükleri anlamına gelir — aynı fikirde olmadıkları değil.",
    termsTitle: "Aynı terim, farklı tanımlar",
    termsNote: "Bu kelimeler makalelerde birbirinin aynısı olmayan tanımlarla tekrar ediyor — ortak bir kelimeyi ortak bir fikir saymadan önce okumaya değer.",
    limitsTitle: "Her birinin yapamadığını kabul ettiği",
    sparkLabel: (label, count) => `${label}: ${count} makalenin bildirdiği değerler, yıl sırasıyla`,
    web: "web kaynağı",
  },
};

const concepts = { en, tr };

export default concepts;
