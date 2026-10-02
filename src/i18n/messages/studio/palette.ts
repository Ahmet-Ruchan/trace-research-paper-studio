import { ENGLISH_PALETTE_WORDS, type PaletteWords } from "@/lib/command-palette";

/**
 * Komut paleti (Ctrl+K). `words` komutların kendisi: adlar, açıklamalar ve
 * aranan kelimeler. Türkçe arayüzde İngilizce adlar ve kelimeler de
 * aranabiliyor (`command-palette.ts`); burada yalnızca Türkçeleri yazılı.
 */
const en = {
  words: ENGLISH_PALETTE_WORDS as PaletteWords,
  dialog: "Go to a paper, section or action",
  input: "Go to",
  placeholder: "Go to a paper, a section or an action…",
  results: "Results",
  nothingMatches: (query: string) => `Nothing matches “${query}”.`,
  /** Tuşların ardından gelen parçalar: "↑↓ to choose · Enter to open · Ctrl K anywhere". */
  hintChoose: " to choose · ",
  hintOpen: " to open · ",
  hintAnywhere: " anywhere",
};

const tr: typeof en = {
  words: {
    groups: { "In this paper": "Bu makalede", Actions: "Eylemler", "Go to": "Git", Settings: "Ayarlar", Papers: "Makaleler" },
    screens: {
      library: { label: "Kütüphane", detail: "Makalelerin, etiketlerin ve notların", keywords: "makaleler koleksiyon arama notlar etiketler" },
      review: { label: "Tekrar", detail: "Bugün zamanı gelmiş kartlar", keywords: "kartlar aralıklı tekrar zamanı gelmiş bilgi kartları" },
      exam: { label: "Deneme sınavı", detail: "Bütün kütüphaneden süreli bir sınav", keywords: "test sınav süreli" },
      progress: { label: "İlerleme", detail: "Makale makale neler öğrendiğin", keywords: "öğrenme istatistikleri" },
      concepts: { label: "Kavramlar", detail: "Makalelerinin paylaştığı kavramlar", keywords: "kavram haritası grafik ortak terimler" },
      "reading-order": { label: "Okuma sırası", detail: "Önce ne okunmalı ve okuma listesi", keywords: "okuma listesi sonra oku sıra sıradaki" },
      models: { label: "Model karnesi", detail: "Her modelin alıntıları ne kadar doğru çıktı", keywords: "modeller sağlayıcılar alıntılar doğruluk" },
      focus: { label: "Odak zamanlayıcısı", detail: "Odak turları, zamanlayıcı, kronometre ve alarmlar", keywords: "pomodoro zamanlayıcı kronometre alarm çalışma" },
      profile: { label: "Profil", detail: "Çalışma takvimin ve haftalık raporun", keywords: "takvim saat hafta rapor yedek ayarlar" },
      home: { label: "Makale analiz et", detail: "PDF, başlık ya da DOI ile başla", keywords: "ana sayfa yeni yükle" },
    },
    labSections: {
      overview: { label: "Genel bakış", keywords: "özet tez" },
      study: { label: "Çalış", keywords: "çalışma yolu adımlar öğren" },
      primer: { label: "Ön bilgi", keywords: "kavramlar arka plan" },
      practice: { label: "Alıştırma", keywords: "test türetimler etkileşimli" },
      report: { label: "Ayrıntılı rapor", keywords: "rapor bölümler" },
      claims: { label: "İddialar", keywords: "kanıt alıntılar sayfalar" },
      notes: { label: "Notlar", keywords: "vurgular notlarım" },
      health: { label: "Sağlık", keywords: "kalite denetimleri kanıt sağlığı" },
      ask: { label: "Sor", keywords: "soru cevap yanıt" },
      method: { label: "Yöntem", keywords: "yöntembilim yaklaşım" },
      technical: { label: "Teknik ek", keywords: "teknik denklemler kod" },
      metrics: { label: "Metrikler", keywords: "sayılar sonuçlar değerler ölçümler" },
      limits: { label: "Sınırlılıklar", keywords: "sınırlar çekinceler" },
      glossary: { label: "Sözlük", keywords: "terimler tanımlar" },
    },
    actions: {
      lab: { label: "Lab", detail: "Kanıt, çalışma ve rapor", keywords: "çalışma alanı" },
      story: { label: "Hikâyeyi düzenle", detail: "Hikâye düzenleyicisi", keywords: "yaz düzenleyici bölümler" },
      preview: { label: "Hikâyeyi önizle", detail: "Okuyucuların gördüğü gibi", keywords: "oku görünüm" },
      search: { label: "Bu makalede ara", detail: "İddialar, bölümler, terimler ve notların", keywords: "bul" },
      publish: { label: "Bağlantı yayımla", detail: "Bu hikâyeyi paylaş", keywords: "paylaş adres herkese açık" },
      citations: { label: "Atıf grafiği", detail: "Neye dayandığı ve ona kimlerin atıf yaptığı", keywords: "kaynaklar atıf alan grafik" },
      history: { label: "Sürüm geçmişi", detail: "Bu projenin önceki sürümleri", keywords: "sürümler geri yükle geri al" },
      json: { label: "Proje JSON dosyasını indir", detail: ".trace.json dosyası", keywords: "dışa aktar kaydet dosya" },
      site: { label: "Etkileşimli siteyi dışa aktar", detail: "Bütün hikâye tek sayfada", keywords: "dışa aktar indir" },
    },
    lab: "Lab",
    storySection: (kicker) => `Hikâye · ${kicker}`,
    deepReport: "Ayrıntılı rapor",
    primerConcept: "Ön bilgi kavramı",
    glossary: "Sözlük",
    exportLabel: (label) => `Dışa aktar: ${label}`,
    exportKeywords: "dışa aktar indir",
    openNow: "şu an açık",
    etAl: "vd.",
    searchFor: (text) => `Bu makalede “${text}” ara`,
    searchDetail: "İddialar, bölümler, terimler ve notların",
  },
  dialog: "Bir makaleye, bölüme ya da eyleme git",
  input: "Git",
  placeholder: "Bir makaleye, bölüme ya da eyleme git…",
  results: "Sonuçlar",
  nothingMatches: (query) => `“${query}” ile eşleşen bir şey yok.`,
  hintChoose: " seç · ",
  hintOpen: " aç · ",
  hintAnywhere: " her yerde",
};

const palette = { en, tr };

export default palette;
