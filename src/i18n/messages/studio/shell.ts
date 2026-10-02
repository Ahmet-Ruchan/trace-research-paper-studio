import { ENGLISH_GENERATION_WORDS, type GenerationEventWords } from "@/lib/generation-events";
import type { ProjectImportWords } from "@/lib/project-import";

/**
 * Stüdyonun kabuğu: marka satırı, ekran geçişleri, makale ekranının başlığı,
 * analiz ekranı, açılıştaki içe aktarma, çevrimdışı uyarısı ve görünüm menüsü.
 *
 * `project-import.ts` şemayı içe aktarıyor; sözlük kaydı hafif kalsın diye
 * oradan yalnızca tür alınıyor, İngilizcesi burada da yazılı (aynılığını
 * `project-import.test.ts` denetliyor).
 */
const en = {
  brand: {
    tagline: "research studio",
    home: "Trace home",
  },
  appShell: {
    errorTitles: {
      generation: "Generation failed",
      import: "Import failed",
      sample: "Could not open the example",
    },
    sampleFailed: "The example project could not be loaded.",
    /** Çalışma saati, profil, tekrar ve sınavdan dönülecek ekranın adı. */
    returnLabels: {
      home: "Home",
      library: "Library",
      workspace: "Back to the paper",
      progress: "Progress",
      concepts: "Concepts",
      models: "Model record",
      review: "Review",
      focus: "Focus",
      profile: "Profile",
    },
    languageDetail: "Only the interface; papers keep their language",
    /** Komut paletinde dil komutunu bulduran kelimeler; iki dilde de aranabilsin. */
    languageKeywords: "language interface English Turkish Türkçe İngilizce dil arayüz",
  },
  workspace: {
    currentPaper: "Current paper",
    modes: "Workspace mode",
    lab: "Lab",
    story: "Story",
    preview: "Preview",
    downloadJson: "Download the project JSON",
    citationsTitle: "Citation graph: what this paper builds on and what cites it",
    citations: "Citations",
    publishTitle: "Publish a shareable link",
    publish: "Publish",
    export: "Export",
    closeExportMenu: "Close the export menu",
    interactiveSite: "Interactive site",
    interactiveSiteDetail: "The whole story as one self-contained page.",
    newPaper: "New paper",
    versionHistory: "Version history",
    analysisNotes: (count: number, notes: string) => `${count} notes from the analysis: ${notes}`,
    dismiss: "Dismiss",
  },
  generation: {
    events: ENGLISH_GENERATION_WORDS as GenerationEventWords,
    running: "Evidence pipeline running",
    elapsed: (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`),
    modelActive: "model active",
    lastActivity: (seconds: number) => `last model activity ${seconds}s ago`,
    heartbeat: "10s heartbeat",
    complete: (percent: number, attempt?: number) => `${percent}% complete${attempt ? ` · attempt ${attempt}` : ""}`,
    notGenerated: "The paper could not be generated.",
    streamNotStarted: "The generation stream could not be started.",
    readyTitle: "Research workspace ready.",
    readyDetail: "Evidence map and StorySpec built successfully.",
    noProjectData: "Generation finished but no project data came back.",
    resumeNote: (saved: number) => ` ${saved}/4 evidence stages were saved; press Analyse paper again to resume from here.`,
    cancelled: "Generation cancelled; no API key or temporary file was kept.",
    unexpected: "Something unexpected went wrong.",
  },
  startup: {
    downloadFailed: (status: number) => `The project could not be downloaded (HTTP ${status}).`,
    importFailed: "The project could not be imported.",
    exampleFailed: (status: number) => `The example project could not be loaded (HTTP ${status}).`,
  },
  /** Sunucu kendi hatasını yazmadığında (`paper-lookup.ts`). */
  lookup: {
    lookupFailed: "The paper could not be looked up.",
    downloadFailed: "The PDF could not be downloaded.",
    graphFailed: "The citation graph could not be loaded.",
  },
  deletion: {
    failed: "Could not delete the Trace project.",
  },
  projectImport: {
    tooLarge: "The Trace JSON exceeds the 5 MB limit.",
    notJson: "The file is not valid JSON.",
    invalidSchema: (path: string, message: string) => `Invalid Trace project schema: ${path} · ${message}`,
    root: "root",
    unknownError: "unknown error",
    badAddress: "The import address is not valid.",
    notThisMachine: "Imports are only accepted from an address on this machine.",
  } as ProjectImportWords,
  offline: {
    notice: "You are offline. Your library is shown as it was when it was last opened here; changes are not saved until you are back online.",
    thisDevice: "This device",
    installed: "Trace is installed here as an app.",
    installable: "Trace can be installed as an app, on a computer or a phone: it opens in its own window, on your library.",
    workerOn: "This browser keeps a copy of your library as it was last opened, so the library and your papers open without a connection too. Changes need the connection.",
    workerOff: "Once installed (or after a reload), this browser keeps a copy of your library as it was last opened, so it opens without a connection too.",
    install: "Install Trace as an app",
    forget: "Delete the offline copy",
    forgotten: "The offline copy was deleted from this browser. It is kept again the next time the library opens here.",
    apple: "On an iPhone or iPad: Share, then Add to Home Screen.",
  },
  display: {
    button: "Text size and theme",
    close: "Close the display menu",
    textSize: "Text size",
    theme: "Theme",
    textSizes: { compact: "Compact", default: "Default", large: "Large", larger: "Larger" },
    themes: { light: "Light", dark: "Dark", system: "System" },
    followsDevice: "follows the device",
    /** Yazı boyutu örneği. */
    sample: "Aa",
    percent: (value: number) => `${value}%`,
  },
};

const tr: typeof en = {
  brand: {
    tagline: "araştırma stüdyosu",
    home: "Trace ana sayfası",
  },
  appShell: {
    errorTitles: {
      generation: "Analiz başarısız oldu",
      import: "İçe aktarma başarısız oldu",
      sample: "Örnek açılamadı",
    },
    sampleFailed: "Örnek proje yüklenemedi.",
    returnLabels: {
      home: "Ana sayfa",
      library: "Kütüphane",
      workspace: "Makaleye dön",
      progress: "İlerleme",
      concepts: "Kavramlar",
      models: "Model karnesi",
      review: "Tekrar",
      focus: "Odak",
      profile: "Profil",
    },
    languageDetail: "Yalnızca arayüz; makaleler kendi dilinde kalır",
    languageKeywords: "dil arayüz Türkçe İngilizce language interface Turkish English",
  },
  workspace: {
    currentPaper: "Açık makale",
    modes: "Makale görünümü",
    lab: "Lab",
    story: "Hikâye",
    preview: "Önizleme",
    downloadJson: "Proje JSON dosyasını indir",
    citationsTitle: "Atıf grafiği: bu makalenin dayandıkları ve ona atıf yapanlar",
    citations: "Atıflar",
    publishTitle: "Paylaşılabilir bir bağlantı yayımla",
    publish: "Yayımla",
    export: "Dışa aktar",
    closeExportMenu: "Dışa aktarma menüsünü kapat",
    interactiveSite: "Etkileşimli site",
    interactiveSiteDetail: "Bütün hikâye, kendi başına açılan tek bir sayfada.",
    newPaper: "Yeni makale",
    versionHistory: "Sürüm geçmişi",
    analysisNotes: (count, notes) => `Analizden ${count} not: ${notes}`,
    dismiss: "Kapat",
  },
  generation: {
    events: {
      stages: {
        document: { label: "Belgenin hazırlanması", description: "PDF ve destekleyici kaynaklar güvenle hazırlanıyor." },
        evidence: { label: "Kanıtların çıkarılması", description: "İddialar, ölçümler ve sayfa göndermeleri bulunuyor." },
        story: { label: "Uzman çıktıları", description: "Görsel hikâye, ayrıntılı rapor, teknik ek ve öğrenme materyali; atanan modeller hazırlıyor." },
        finalize: { label: "Son kontrol", description: "Her bağlantı ve veri şeması denetleniyor." },
      },
      sending: { title: "Makale gönderiliyor.", detail: "API anahtarı yalnızca bu istek süresince bellekte kalıyor." },
    },
    running: "Kanıt hattı çalışıyor",
    elapsed: (seconds) => (seconds < 60 ? `${seconds} sn` : `${Math.floor(seconds / 60)} dk ${seconds % 60} sn`),
    modelActive: "model etkin",
    lastActivity: (seconds) => `modelin son etkinliği ${seconds} sn önce`,
    heartbeat: "10 sn'de bir sinyal",
    complete: (percent, attempt) => `%${percent} tamamlandı${attempt ? ` · ${attempt}. deneme` : ""}`,
    notGenerated: "Makale analiz edilemedi.",
    streamNotStarted: "Analiz akışı başlatılamadı.",
    readyTitle: "Araştırma alanı hazır.",
    readyDetail: "Kanıt haritası ve hikâye şeması başarıyla oluşturuldu.",
    noProjectData: "Analiz bitti ama proje verisi gelmedi.",
    resumeNote: (saved) => ` Kanıt aşamalarından ${saved}/4 tanesi kaydedildi; buradan sürdürmek için “Makaleyi analiz et” düğmesine yeniden bas.`,
    cancelled: "Analiz iptal edildi; ne API anahtarı ne de geçici dosya saklandı.",
    unexpected: "Beklenmedik bir hata oluştu.",
  },
  startup: {
    downloadFailed: (status) => `Proje indirilemedi (HTTP ${status}).`,
    importFailed: "Proje içe aktarılamadı.",
    exampleFailed: (status) => `Örnek proje yüklenemedi (HTTP ${status}).`,
  },
  lookup: {
    lookupFailed: "Makale bulunamadı.",
    downloadFailed: "PDF indirilemedi.",
    graphFailed: "Atıf ağı yüklenemedi.",
  },
  deletion: {
    failed: "Trace projesi silinemedi.",
  },
  projectImport: {
    tooLarge: "Trace JSON dosyası 5 MB sınırını aşıyor.",
    notJson: "Dosya geçerli bir JSON değil.",
    invalidSchema: (path, message) => `Trace proje şeması geçersiz: ${path} · ${message}`,
    root: "kök",
    unknownError: "bilinmeyen hata",
    badAddress: "İçe aktarma adresi geçerli değil.",
    notThisMachine: "İçe aktarma yalnızca bu makinedeki bir adresten kabul ediliyor.",
  },
  offline: {
    notice: "Çevrimdışısın. Kütüphanen burada en son açıldığı hâliyle gösteriliyor; yeniden çevrimiçi olana kadar değişiklikler kaydedilmiyor.",
    thisDevice: "Bu cihaz",
    installed: "Trace burada uygulama olarak kurulu.",
    installable: "Trace bilgisayara ya da telefona uygulama olarak kurulabilir: kendi penceresinde, kütüphanenle açılır.",
    workerOn: "Bu tarayıcı kütüphanenin en son açıldığı hâlinin bir kopyasını saklıyor; böylece kütüphanen ve makalelerin bağlantı olmadan da açılıyor. Değişiklikler için bağlantı gerekiyor.",
    workerOff: "Kurulduktan sonra (ya da sayfa yenilenince) bu tarayıcı kütüphanenin en son açıldığı hâlinin bir kopyasını saklıyor; böylece bağlantı olmadan da açılıyor.",
    install: "Trace'i uygulama olarak kur",
    forget: "Çevrimdışı kopyayı sil",
    forgotten: "Çevrimdışı kopya bu tarayıcıdan silindi. Kütüphane burada bir dahaki açılışında yeniden saklanacak.",
    apple: "iPhone ya da iPad'de: Paylaş, ardından Ana Ekrana Ekle.",
  },
  display: {
    button: "Yazı boyutu ve tema",
    close: "Görünüm menüsünü kapat",
    textSize: "Yazı boyutu",
    theme: "Tema",
    textSizes: { compact: "Küçük", default: "Varsayılan", large: "Büyük", larger: "Daha büyük" },
    themes: { light: "Açık", dark: "Koyu", system: "Sistem" },
    followsDevice: "cihaza uyar",
    sample: "Aa",
    percent: (value) => `%${String(value).replace(".", ",")}`,
  },
};

const shell = { en, tr };

export default shell;
