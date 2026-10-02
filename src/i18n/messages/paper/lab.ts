import { PAPER_HIT_LABELS, type PaperHitKind } from "@/lib/paper-search";
import type { DeepReportSection } from "@/lib/schema";

/** Lab, hikâye önizlemesi ve hikâye düzenleyicisi. */
type RegenNoun = "section" | "equation" | "derivation" | "concept" | "question";
type ReportKind = DeepReportSection["kind"];
type SearchPart = { kind: PaperHitKind; count: number };

const en = {
  lab: {
    regenerate: "Regenerate",
    regenerateTitle: (noun: RegenNoun) => `Rewrite this ${noun} with a model; the evidence stays locked`,
    quoteCheck: {
      running: "Comparing every quote with the text of the page it cites…",
      failed: "The quotes could not be checked.",
      partlyFound: (found: number, checked: number, downgraded: number) =>
        `${found} of ${checked} quotes were found. ${downgraded} claim(s) were marked needs-review.`,
      allFound: (checked: number) => `All ${checked} quotes were found on the page they cite.`,
    },
    nav: {
      overview: "Overview",
      concepts: "Concepts",
      deepReport: "Deep report",
      claims: "Claims",
      notes: (count: number) => (count ? `Notes (${count})` : "Notes"),
      learningHealth: "Learning health",
      ask: "Ask",
      review: "Review",
      method: "Method",
      technical: "Technical",
      metrics: "Metrics",
      limitations: "Limitations",
      glossary: "Glossary",
      select: "Section",
    },
    learningOffer: {
      aria: "Learning layer",
      title: "Learn this paper, not just read it",
      body: (missing: string) =>
        `This project is missing ${missing}. Trace can write them from the evidence already collected: every item cites its claims, and the PDF is not needed.`,
      action: "Add the learning layer",
    },
    studyOffer: {
      finished: (firstTry: number, answered: number) =>
        `You reached the end: ${firstTry} of ${answered} questions right on the first try. The results show what to read again.`,
      inProgress: (done: number, total: number) => `${done} of ${total} steps done. You continue where you left off.`,
      notStarted: (steps: number) =>
        `A guided path in ${steps} steps: what the paper assumes, each section with one question after it, then what to read again.`,
      reviewCards: (count: number) => `Review ${count} ${count === 1 ? "card" : "cards"}`,
      seeResults: "See your results",
      continue: "Continue studying",
      start: "Start studying",
    },
    overview: {
      coreThesis: "Core thesis",
      researchQuestion: "Research question",
      plainSummary: "Plain-language summary",
      keyFindings: "Key findings",
    },
    study: {
      focusHint: "Work through the path in a focus round, with a break after it: the time is counted for this paper.",
      loading: "Loading your study progress…",
      nothingChanged: "Nothing was changed; reload the page to try again.",
      note: "Your progress is saved in your library, next to this paper. It is not part of the project file, so exports and published pages never carry your answers.",
      notSaved: (error: string) => `Progress not saved: ${error}`,
    },
    report: {
      kicker: (readingTime: string) => `Deep report · ${readingTime}`,
      kinds: {
        contribution: "Contribution",
        mechanism: "Mechanism",
        experiment: "Experiment",
        critique: "Critique",
        reproduction: "Reproduction",
        implication: "Implication",
      } as Record<ReportKind, string>,
      openQuestions: "Open questions",
      openQuestionsHeading: "Questions the paper has not answered yet",
    },
    claims: {
      heading: "Evidence ledger",
      verifiedCount: (verified: number, total: number) => `${verified}/${total} verified`,
      noted: "You noted this claim",
      /** Defterdeki rozet; çekmecedeki "Needs review"dan kısa. */
      review: "Review",
    },
    notes: { heading: "Your notes and highlights" },
    ask: {
      heading: "Ask the evidence",
      intro:
        "The model answering here has not read the paper. It sees only the claims, metrics and glossary collected in this project, must name the claims it used, and says so when they do not cover your question. Nothing is saved.",
    },
    review: {
      heading: "Claim review",
      intro:
        "A model says how sure it is, and a program can check that a quote is on its page. Neither can say that the quote actually supports the claim. That takes a person: open the claim, look at the page, decide.",
    },
    concepts: {
      heading: "Concepts across your papers",
      intro:
        "The concepts this paper assumes, and where else your library explains them. Nothing is generated: concepts are matched by name across your papers, and each paper's study progress says what you have already studied.",
    },
    learning: {
      heading: "Learning health",
      intro:
        "Evidence health asks whether every sentence is tied to a page. This asks whether a reader can learn from the result: whether a question checks every section, whether the quiz asks about results, interpretations and limitations, whether the playgrounds respond and the derivations explain. It is computed from the project; no model is asked.",
    },
    method: { heading: "Method flow" },
    technical: {
      kicker: "Technical appendix",
      equations: "Equations and mechanisms",
      algorithm: "Algorithm flow",
      codeSketches: "Explanatory code sketches",
      complexity: "Complexity",
      implementationNotes: "Implementation notes",
    },
    metrics: {
      heading: "Extracted metrics",
      page: (page: number | undefined) => `p. ${page ?? "—"}`,
    },
    limits: {
      heading: "Limitations of the paper",
      intro: "A strong account keeps its limits as visible as its findings.",
    },
    search: {
      heading: "Search this paper",
      placeholder: "Claims, sections, concepts, terms and your notes",
      hint: "Type a word or two. Press / anywhere in the Lab to come back here, or Ctrl+K to go anywhere in the studio.",
      summary: (total: number, parts: readonly SearchPart[]) =>
        `${total} ${total === 1 ? "match" : "matches"}: ${parts.map(({ kind, count }) => `${count} ${PAPER_HIT_LABELS[kind].toLowerCase()}`).join(", ")}.`,
      nothing: "Nothing in this paper mentions every word you typed.",
      showingFirst: (shown: number) => `Showing the first ${shown}. Add a word to narrow the search.`,
      hitLabels: PAPER_HIT_LABELS,
    },
    glossary: { heading: "Glossary" },
  },
  story: {
    mark: "Trace story",
    etAl: " et al.",
    start: "Start the story",
    source: (page: number | undefined) => `Source ${page ? `· p. ${page}` : ""}`,
    sectionsAria: "Story sections",
    closing: "Closing",
    primarySource: "Primary source",
  },
  storyEditor: {
    outline: "Story outline",
    sections: (count: number) => `${count} sections`,
    preview: "Full-screen preview",
    saveTemplate: "Save as template",
    section: (label: string) => `Section ${label}`,
    visual: (type: string) => `${type} visual`,
    kicker: "Kicker",
    title: "Title",
    narrative: "Narrative",
    linkedClaims: "Linked claims",
    rendererOutput: "Renderer output",
    rendererNote: "The visual is generated from validated StorySpec data; no free-form model code runs here.",
  },
};

const trRegenThis: Record<RegenNoun, string> = {
  section: "Bu bölümü",
  equation: "Bu denklemi",
  derivation: "Bu türetimi",
  concept: "Bu kavramı",
  question: "Bu soruyu",
};

const trHitLabels: Record<PaperHitKind, string> = {
  claim: "İddia",
  story: "Hikâye",
  report: "Ayrıntılı rapor",
  concept: "Ön bilgi",
  term: "Sözlük",
  note: "Notun",
};

/** Sayımda küçük harfle: "3 iddia, 1 hikâye". */
const trHitCounts: Record<PaperHitKind, string> = {
  claim: "iddia",
  story: "hikâye",
  report: "rapor",
  concept: "ön bilgi",
  term: "sözlük",
  note: "not",
};

const tr: typeof en = {
  lab: {
    regenerate: "Yeniden üret",
    regenerateTitle: (noun) => `${trRegenThis[noun]} bir modelle yeniden yaz; kanıt kilitli kalır`,
    quoteCheck: {
      running: "Her alıntı, atıf yaptığı sayfanın metniyle karşılaştırılıyor…",
      failed: "Alıntılar denetlenemedi.",
      partlyFound: (found, checked, downgraded) =>
        `${checked} alıntıdan ${found} tanesi bulundu. ${downgraded} iddia “incelenmeli” olarak işaretlendi.`,
      allFound: (checked) => `${checked} alıntının hepsi atıf yaptığı sayfada bulundu.`,
    },
    nav: {
      overview: "Genel bakış",
      concepts: "Kavramlar",
      deepReport: "Ayrıntılı rapor",
      claims: "İddialar",
      notes: (count) => (count ? `Notlar (${count})` : "Notlar"),
      learningHealth: "Öğrenme sağlığı",
      ask: "Sor",
      review: "İnceleme",
      method: "Yöntem",
      technical: "Teknik",
      metrics: "Metrikler",
      limitations: "Sınırlılıklar",
      glossary: "Sözlük",
      select: "Bölüm",
    },
    learningOffer: {
      aria: "Öğrenme katmanı",
      title: "Bu makaleyi yalnızca okuma, öğren",
      body: (missing) =>
        `Bu projede şunlar eksik: ${missing}. Trace bunları zaten toplanmış kanıttan yazabilir: her öğe kendi iddialarına atıf yapar, PDF gerekmez.`,
      action: "Öğrenme katmanını ekle",
    },
    studyOffer: {
      finished: (firstTry, answered) =>
        `Sona ulaştın: ${answered} sorunun ${firstTry} tanesini ilk denemede doğru yanıtladın. Sonuçlar neyi yeniden okuman gerektiğini gösteriyor.`,
      inProgress: (done, total) => `${total} adımın ${done} tanesi tamam. Kaldığın yerden devam ediyorsun.`,
      notStarted: (steps) =>
        `${steps} adımlık rehberli bir yol: makalenin varsaydıkları, ardından her bölüm ve arkasından bir soru, sonra yeniden okunacaklar.`,
      reviewCards: (count) => `${count} kartı tekrarla`,
      seeResults: "Sonuçlarını gör",
      continue: "Çalışmaya devam et",
      start: "Çalışmaya başla",
    },
    overview: {
      coreThesis: "Ana tez",
      researchQuestion: "Araştırma sorusu",
      plainSummary: "Sade dille özet",
      keyFindings: "Temel bulgular",
    },
    study: {
      focusHint: "Yolu bir odak turunda çalış, ardından mola ver: süre bu makaleye sayılır.",
      loading: "Çalışma ilerlemen yükleniyor…",
      nothingChanged: "Hiçbir şey değişmedi; tekrar denemek için sayfayı yenile.",
      note: "İlerlemen kütüphanende, bu makalenin yanında saklanıyor. Proje dosyasının parçası değil; dışa aktarılan dosyalar ve yayımlanan sayfalar yanıtlarını hiçbir zaman taşımaz.",
      notSaved: (error) => `İlerleme kaydedilmedi: ${error}`,
    },
    report: {
      kicker: (readingTime) => `Ayrıntılı rapor · ${readingTime}`,
      kinds: {
        contribution: "Katkı",
        mechanism: "Mekanizma",
        experiment: "Deney",
        critique: "Eleştiri",
        reproduction: "Tekrarlanabilirlik",
        implication: "Çıkarım",
      },
      openQuestions: "Açık sorular",
      openQuestionsHeading: "Makalenin henüz yanıtlamadığı sorular",
    },
    claims: {
      heading: "Kanıt defteri",
      verifiedCount: (verified, total) => `${verified}/${total} doğrulandı`,
      noted: "Bu iddiaya not aldın",
      review: "İncelenmeli",
    },
    notes: { heading: "Notların ve vurguların" },
    ask: {
      heading: "Kanıta sor",
      intro:
        "Burada yanıt veren model makaleyi okumadı. Yalnızca bu projede toplanan iddiaları, metrikleri ve sözlüğü görüyor; kullandığı iddiaları belirtmek zorunda ve sorunu karşılamadıklarında bunu söylüyor. Hiçbir şey kaydedilmiyor.",
    },
    review: {
      heading: "İddia incelemesi",
      intro:
        "Bir model ne kadar emin olduğunu söyler, bir program da alıntının sayfasında olup olmadığını denetleyebilir. İkisi de alıntının iddiayı gerçekten desteklediğini söyleyemez. Bunun için bir insan gerekir: iddiayı aç, sayfaya bak, karar ver.",
    },
    concepts: {
      heading: "Makalelerindeki kavramlar",
      intro:
        "Bu makalenin varsaydığı kavramlar ve kütüphanende başka nerede açıklandıkları. Hiçbir şey üretilmiyor: kavramlar makalelerin arasında adlarıyla eşleştiriliyor ve her makalenin çalışma ilerlemesi neyi zaten çalıştığını gösteriyor.",
    },
    learning: {
      heading: "Öğrenme sağlığı",
      intro:
        "Kanıt sağlığı her cümlenin bir sayfaya bağlı olup olmadığını sorar. Bu ise okuyucunun sonuçtan öğrenip öğrenemeyeceğini sorar: her bölümü bir soru yokluyor mu, test sonuçları, yorumları ve sınırlılıkları soruyor mu, oyun alanları tepki veriyor mu, türetimler açıklıyor mu. Projeden hesaplanır; hiçbir modele sorulmaz.",
    },
    method: { heading: "Yöntem akışı" },
    technical: {
      kicker: "Teknik ek",
      equations: "Denklemler ve mekanizmalar",
      algorithm: "Algoritma akışı",
      codeSketches: "Açıklayıcı kod taslakları",
      complexity: "Karmaşıklık",
      implementationNotes: "Uygulama notları",
    },
    metrics: {
      heading: "Çıkarılan metrikler",
      page: (page) => `s. ${page ?? "—"}`,
    },
    limits: {
      heading: "Makalenin sınırlılıkları",
      intro: "İyi bir anlatım sınırlarını da bulguları kadar görünür tutar.",
    },
    search: {
      heading: "Bu makalede ara",
      placeholder: "İddialar, bölümler, kavramlar, terimler ve notların",
      hint: "Bir iki kelime yaz. Buraya dönmek için Lab'in herhangi bir yerinde / tuşuna, stüdyoda istediğin yere gitmek için Ctrl+K'ye bas.",
      summary: (total, parts) => `${total} sonuç: ${parts.map(({ kind, count }) => `${count} ${trHitCounts[kind]}`).join(", ")}.`,
      nothing: "Bu makalede yazdığın kelimelerin hepsini içeren bir yer yok.",
      showingFirst: (shown) => `İlk ${shown} sonuç gösteriliyor. Aramayı daraltmak için bir kelime ekle.`,
      hitLabels: trHitLabels,
    },
    glossary: { heading: "Sözlük" },
  },
  story: {
    mark: "Trace hikâyesi",
    etAl: " vd.",
    start: "Hikâyeye başla",
    source: (page) => `Kaynak ${page ? `· s. ${page}` : ""}`,
    sectionsAria: "Hikâye bölümleri",
    closing: "Kapanış",
    primarySource: "Birincil kaynak",
  },
  storyEditor: {
    outline: "Hikâye taslağı",
    sections: (count) => `${count} bölüm`,
    preview: "Tam ekran önizleme",
    saveTemplate: "Şablon olarak kaydet",
    section: (label) => `Bölüm ${label}`,
    visual: (type) => `Görsel: ${type}`,
    kicker: "Üst başlık",
    title: "Başlık",
    narrative: "Anlatı",
    linkedClaims: "Bağlı iddialar",
    rendererOutput: "Çizim çıktısı",
    rendererNote: "Görsel, doğrulanmış StorySpec verisinden üretiliyor; burada modelin yazdığı serbest kod çalışmıyor.",
  },
};

const lab = { en, tr };

export default lab;
