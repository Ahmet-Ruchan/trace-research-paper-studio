import type { ResearchProject } from "./schema";

const paperSource = {
  id: "paper",
  type: "paper" as const,
  title: "Attention Is All You Need",
  fileName: "attention-is-all-you-need.pdf",
};

export const sampleProject: ResearchProject = {
  version: 1,
  id: "sample-transformer",
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
  language: "tr",
  audience: "student",
  depth: "standard",
  generation: { provider: "sample", model: "curated-example" },
  evidence: {
    paper: {
      title: "Attention Is All You Need",
      authors: [
        "Ashish Vaswani",
        "Noam Shazeer",
        "Niki Parmar",
        "Jakob Uszkoreit",
        "Llion Jones",
        "Aidan N. Gomez",
        "Łukasz Kaiser",
        "Illia Polosukhin",
      ],
      year: "2017",
      venue: "NeurIPS",
      doi: "10.48550/arXiv.1706.03762",
    },
    sources: [paperSource],
    thesis:
      "Dizi dönüşümü, recurrent veya convolutional katmanlar olmadan yalnızca attention mekanizmalarıyla kurulabilir.",
    plainSummary:
      "Transformer, cümledeki kelimeleri sırayla işlemek yerine aralarındaki ilişkileri aynı anda hesaplayan bir encoder–decoder mimarisidir. Bu değişim hem eğitimi paralelleştirir hem de uzun mesafeli ilişkilerin öğrenilmesini kolaylaştırır.",
    researchQuestion:
      "Dizi dönüşümü görevleri recurrence ve convolution olmadan, yalnızca attention kullanılarak daha iyi ve daha verimli çözülebilir mi?",
    methods: [
      "Scaled dot-product attention",
      "Multi-head attention",
      "Positional encoding",
      "Encoder–decoder katman yığınları",
      "WMT 2014 makine çevirisi değerlendirmeleri",
    ],
    findings: [
      "Model, WMT 2014 İngilizce–Almanca görevinde 28.4 BLEU elde etti.",
      "İngilizce–Fransızca görevinde 41.8 BLEU sonucuna ulaştı.",
      "Büyük model sekiz P100 GPU üzerinde 3,5 günde eğitildi.",
    ],
    limitations: [
      "Deneylerin odağı ağırlıklı olarak makine çevirisi ve constituency parsing görevleridir.",
      "Attention maliyeti dizi uzunluğunun karesiyle büyür.",
      "Mimari sabit maksimum bağlam uzunluğu içinde değerlendirilmiştir.",
    ],
    claims: [
      {
        id: "claim-architecture",
        statement:
          "Transformer recurrence ve convolution yerine yalnızca attention mekanizmalarını kullanır.",
        kind: "method",
        confidence: "verified",
        sourceRefs: [
          {
            sourceId: "paper",
            page: 1,
            excerpt:
              "The proposed architecture dispenses with recurrence and convolutions.",
          },
        ],
      },
      {
        id: "claim-parallel",
        statement:
          "Self-attention, dizideki konumların temsilini paralel biçimde hesaplamaya izin verir.",
        kind: "author-interpretation",
        confidence: "verified",
        sourceRefs: [
          {
            sourceId: "paper",
            page: 2,
            excerpt:
              "The model connects positions using attention rather than sequential operations.",
          },
        ],
      },
      {
        id: "claim-attention",
        statement:
          "Scaled dot-product attention, query ve key benzerliklerini ölçekleyip value vektörlerini ağırlıklandırır.",
        kind: "method",
        confidence: "verified",
        sourceRefs: [
          {
            sourceId: "paper",
            page: 4,
            excerpt:
              "Attention weights are obtained from scaled query-key products and softmax.",
          },
        ],
      },
      {
        id: "claim-heads",
        statement:
          "Multi-head attention modelin farklı temsil alt uzaylarındaki ilişkileri birlikte izlemesini sağlar.",
        kind: "method",
        confidence: "verified",
        sourceRefs: [
          {
            sourceId: "paper",
            page: 5,
            excerpt:
              "Multiple heads attend to information from different representation subspaces.",
          },
        ],
      },
      {
        id: "claim-de",
        statement:
          "Büyük Transformer, WMT 2014 İngilizce–Almanca testinde 28.4 BLEU elde etti.",
        kind: "reported-result",
        confidence: "verified",
        sourceRefs: [
          {
            sourceId: "paper",
            page: 8,
            excerpt: "The big model reaches 28.4 BLEU on English-to-German.",
          },
        ],
      },
      {
        id: "claim-fr",
        statement:
          "İngilizce–Fransızca görevinde tek model 41.8 BLEU sonucuna ulaştı.",
        kind: "reported-result",
        confidence: "verified",
        sourceRefs: [
          {
            sourceId: "paper",
            page: 8,
            excerpt: "The model achieves 41.8 BLEU on English-to-French.",
          },
        ],
      },
      {
        id: "claim-limit",
        statement:
          "Tam self-attention katmanının hesaplama ve bellek maliyeti dizi uzunluğuna göre kuadratiktir.",
        kind: "limitation",
        confidence: "verified",
        sourceRefs: [
          {
            sourceId: "paper",
            page: 6,
            excerpt: "Self-attention complexity per layer is proportional to sequence length squared.",
          },
        ],
      },
    ],
    metrics: [
      {
        id: "metric-de",
        label: "İngilizce–Almanca",
        value: 28.4,
        displayValue: "28.4",
        unit: "BLEU",
        context: "WMT 2014 test seti, büyük Transformer",
        sourceRef: {
          sourceId: "paper",
          page: 8,
          excerpt: "The big model reaches 28.4 BLEU.",
        },
      },
      {
        id: "metric-fr",
        label: "İngilizce–Fransızca",
        value: 41.8,
        displayValue: "41.8",
        unit: "BLEU",
        context: "WMT 2014 test seti, tek model",
        sourceRef: {
          sourceId: "paper",
          page: 8,
          excerpt: "The model achieves 41.8 BLEU.",
        },
      },
      {
        id: "metric-days",
        label: "Büyük model eğitimi",
        value: 3.5,
        displayValue: "3,5 gün",
        unit: "gün",
        context: "8 × NVIDIA P100 GPU",
        sourceRef: {
          sourceId: "paper",
          page: 7,
          excerpt: "The big models were trained for 3.5 days on 8 P100 GPUs.",
        },
      },
    ],
    glossary: [
      {
        term: "Attention",
        definition:
          "Bir konumun diğer konumlardaki bilgiyi ne ölçüde kullanacağını hesaplayan ağırlıklandırma işlemi.",
      },
      {
        term: "Query / Key / Value",
        definition:
          "İlişkinin aranması, eşleştirilmesi ve taşınan içeriği temsil eden üç öğrenilmiş projeksiyon.",
      },
      {
        term: "Positional encoding",
        definition:
          "Sıralı işlem kullanmayan modele token konum bilgisini ekleyen sinüs ve kosinüs temsilleri.",
      },
      {
        term: "BLEU",
        definition:
          "Makine çevirisi çıktısını referans çevirilerle karşılaştıran otomatik değerlendirme ölçütü.",
      },
    ],
  },
  deepReport: {
    title: "Transformer’ı sonuçlarından önce mimarisiyle okumak",
    dek: "Bu rapor paper’ın temel katkısını, attention mekanizmasını, deneysel kanıtını ve yeniden üretim sınırlarını tek bir kanıt zincirinde inceler.",
    readingTime: "14 dakikalık derin okuma",
    sections: [
      { id: "report-contribution", kind: "contribution", title: "Katkı: sıralı hesaplama zorunluluğunu kaldırmak", summary: "Paper’ın ana yeniliği attention’ı yardımcı bir katmandan bütün encoder–decoder mimarisinin merkezine taşımaktır.", analysis: ["Model recurrent ve convolutional katmanları kaldırarak dizideki konumlar arasında daha kısa bir bilgi yolu kurar.", "Bu katkı yalnızca yeni bir blok önermek değil, eğitim sırasında daha fazla paralellik sağlayan farklı bir hesaplama düzeni tanımlamaktır."], claimIds: ["claim-architecture", "claim-parallel"] },
      { id: "report-mechanism", kind: "mechanism", title: "Mekanizma: query, key ve value üzerinden ilişki kurmak", summary: "Scaled dot-product attention her konumun hangi diğer konumlardan bilgi alacağını öğrenilmiş temsillerle hesaplar.", analysis: ["Query ve key çarpımı ilişkileri skorlar; ölçekleme büyük boyutlarda softmax davranışını kararlı tutmayı amaçlar.", "Value vektörlerinin ağırlıklı toplamı her token için bağlama duyarlı yeni bir temsil üretir."], claimIds: ["claim-attention"] },
      { id: "report-multi-head", kind: "mechanism", title: "Çoklu temsil uzaylarında eşzamanlı bakış", summary: "Multi-head attention tek bir ilişki haritası yerine farklı projeksiyonlarda birden çok attention işlemini bir araya getirir.", analysis: ["Base yapı sekiz head kullanarak farklı temsil altuzaylarındaki ilişkilerin aynı katmanda modellenmesini amaçlar.", "Head’lerin belirli dilbilimsel rolleri garanti edilmez; güvenli çıkarım, çoklu projeksiyonların mimarinin ifade kapasitesini genişlettiğidir."], claimIds: ["claim-heads"] },
      { id: "report-experiment", kind: "experiment", title: "Deney: iki çeviri görevinde raporlanan sonuçlar", summary: "Paper, mimari iddiasını WMT 2014 İngilizce–Almanca ve İngilizce–Fransızca sonuçlarıyla destekler.", analysis: ["Büyük model iki görevde sırasıyla 28.4 ve 41.8 BLEU raporlar; görevler farklı olduğu için skorlar birbirinin doğrudan karşılaştırması değildir.", "Sonuç iddiası kalite kadar eğitim maliyetini de vurgular; bu nedenle skor ve hesaplama bütçesi birlikte okunmalıdır."], claimIds: ["claim-de", "claim-fr"] },
      { id: "report-critique", kind: "critique", title: "Eleştiri: doğrudan bağlantının karesel maliyeti", summary: "Self-attention kısa bilgi yolları sağlarken standart biçimiyle dizi uzunluğuna göre karesel ilişki matrisi oluşturur.", analysis: ["Her token’ın her token ile karşılaştırılması uzun dizilerde bellek ve hesaplama baskısı yaratır.", "Paper’ın çeviri görevlerindeki başarısı, aynı maliyet profilinin sınırsız bağlamlarda da uygun olduğunu tek başına göstermez."], claimIds: ["claim-limit"] },
      { id: "report-reproduction", kind: "reproduction", title: "Reprodüksiyon: mimari ve eğitim bütçesini birlikte sabitlemek", summary: "Yeniden üretim için attention bloklarının yanında head sayısı, model boyutu ve raporlanan donanım süresi izlenmelidir.", analysis: ["Base modeldeki sekiz head ve projeksiyon yapısı, mekanizmanın beklenen kapasitesini belirleyen temel ayarlardır.", "Büyük model için raporlanan sekiz P100 GPU üzerinde 3.5 günlük eğitim, sonuçları değerlendirirken gözden kaçırılmaması gereken bütçe bilgisidir."], claimIds: ["claim-heads", "claim-parallel"] },
      { id: "report-implication", kind: "implication", title: "Çıkarım: ilişki kurmayı mimarinin ilk ilkesi yapmak", summary: "Paper’ın kanıtı, dizi modellemede recurrence’ın zorunlu olmadığını ve attention tabanlı bir alternatifin rekabetçi olabildiğini gösterir.", analysis: ["Paralel eğitim olanağı, model geliştirme döngüsünü ve ölçeklenebilirliği etkileyen pratik bir mimari sonuçtur.", "Bu çıkarım paper’ın değerlendirdiği makine çevirisi kapsamıyla sınırlı tutulmalıdır; başka alanlara genelleme ek kanıt gerektirir."], claimIds: ["claim-architecture", "claim-de", "claim-fr"] },
    ],
    openQuestions: ["Karesel attention maliyeti çok daha uzun dizilerde nasıl azaltılabilir?", "Aynı mimari avantaj farklı veri türlerinde ve görevlerde korunur mu?", "Head’lerin öğrendiği ilişkiler ne ölçüde kararlı ve yorumlanabilirdir?"],
  },
  technicalAppendix: {
    title: "Attention mekanizmasından uygulanabilir algoritmaya",
    overview: "Bu teknik ek, paper’ın kanıtlarına dayanarak scaled dot-product attention’ın hesabını, çoklu head akışını ve reprodüksiyon sırasında görünür tutulması gereken maliyetleri özetler.",
    equations: [{ id: "scaled-attention", label: "Scaled dot-product attention", expression: "Attention(Q, K, V) = softmax(QKᵀ / √dₖ)V", explanation: "Query ve key çarpımı ilişki skorlarını üretir; ölçeklenmiş softmax ağırlıkları value temsillerini birleştirir.", variables: [{ symbol: "Q", meaning: "Query matrisi" }, { symbol: "K", meaning: "Key matrisi" }, { symbol: "V", meaning: "Value matrisi" }, { symbol: "dₖ", meaning: "Key boyutu" }], claimIds: ["claim-attention"] }],
    algorithmSteps: [
      { label: "Girdileri projekte et", detail: "Her head için query, key ve value temsillerini öğrenilmiş doğrusal projeksiyonlarla oluştur.", claimIds: ["claim-heads"] },
      { label: "İlişkileri skorla", detail: "Query–key çarpımlarını key boyutunun kareköküyle ölçekle ve softmax uygula.", claimIds: ["claim-attention"] },
      { label: "Head çıktılarını birleştir", detail: "Her head’in value toplamını bir araya getirip çıkış projeksiyonundan geçir.", claimIds: ["claim-heads"] },
    ],
    codeSketches: [{ title: "Scaled attention iskeleti", language: "pseudocode", code: "scores = (Q @ transpose(K)) / sqrt(key_dim)\nweights = softmax(scores)\ncontext = weights @ V\nreturn context", explanation: "Bu kod paper’ın yayımlanmış kaynak kodu değil; denklemdeki hesaplama sırasını görünür kılan güvenli bir pseudocode taslağıdır.", claimIds: ["claim-attention"] }],
    complexity: [{ operation: "Self-attention ilişkileri", cost: "O(n² · d)", context: "Her konumun diğer bütün konumlarla karşılaştırılması dizi uzunluğunda karesel ilişki sayısı oluşturur.", claimIds: ["claim-limit"] }],
    implementationNotes: ["Base modelde sekiz attention head kullanıldığını sabitle.", "Görevler farklı olduğu için EN→DE ve EN→FR BLEU skorlarını tek ölçekli bir karşılaştırma gibi yorumlama.", "Eğitim bütçesini raporlanan sekiz P100 GPU ve 3.5 günlük büyük-model koşuluyla birlikte kaydet."],
  },
  story: {
    title: "Sırayı ortadan kaldıran mimari",
    dek: "Transformer bir cümleyi kelime kelime takip etmek yerine, tüm ilişkileri aynı anda görmeyi önerdi. Modern yapay zekânın dönüm noktası böyle başladı.",
    readingTime: "7 dakikalık görsel okuma",
    accent: "#e75b37",
    sections: [
      {
        id: "old-bottleneck",
        indexLabel: "01",
        kicker: "Başlangıç noktası",
        title: "Önceki modeller cümleyi sırayla okumak zorundaydı.",
        body: "Recurrent modeller her adımda bir önceki durumun sonucunu bekliyordu. Bu düzen dilin doğal sırasını izlese de hesaplamayı zincire bağlıyor, uzun mesafeli ilişkilerin yolunu uzatıyordu.",
        claimIds: ["claim-architecture"],
        visual: {
          type: "flow",
          eyebrow: "Ardışık işlem",
          caption: "Her token bir önceki adımın bitmesini bekler.",
          items: [
            { label: "The", detail: "t₁" },
            { label: "model", detail: "t₂" },
            { label: "sees", detail: "t₃" },
            { label: "context", detail: "t₄" },
          ],
        },
      },
      {
        id: "parallel-view",
        indexLabel: "02",
        kicker: "Temel kırılma",
        title: "Transformer bütün konumları aynı anda masaya koydu.",
        body: "Makale recurrence ve convolution katmanlarını kaldırdı. Her token diğer bütün token’larla doğrudan ilişki kurabildiği için temsil hesapları paralel yürütülebilir hale geldi.",
        claimIds: ["claim-architecture", "claim-parallel"],
        visual: {
          type: "concept",
          eyebrow: "Paralel bağlam",
          caption: "Her konum, tek adımda diğer tüm konumlara erişebilir.",
          center: "context",
          items: [
            { label: "the", detail: "0.08" },
            { label: "river", detail: "0.46" },
            { label: "bank", detail: "0.31" },
            { label: "rose", detail: "0.15" },
          ],
        },
      },
      {
        id: "attention-machine",
        indexLabel: "03",
        kicker: "Mekanik",
        title: "Query sorar, key eşleşir, value bilgiyi taşır.",
        body: "Scaled dot-product attention önce query ve key vektörlerinin benzerliğini ölçer. Sonuçları ölçekler, softmax ile ağırlıklara dönüştürür ve value vektörlerini bu ağırlıklarla birleştirir.",
        claimIds: ["claim-attention"],
        visual: {
          type: "equation",
          eyebrow: "Attention(Q, K, V)",
          caption: "Karşılaştır → ölçekle → ağırlıklandır → birleştir.",
          formula: "Attention(Q, K, V) = softmax(QKᵀ / √dₖ)V",
          terms: [
            { symbol: "Q", label: "Query", detail: "Aranan ilişki" },
            { symbol: "K", label: "Key", detail: "Eşleşme anahtarı" },
            { symbol: "V", label: "Value", detail: "Taşınan içerik" },
          ],
          steps: ["Q ve K ile ilişki skorlarını hesapla", "Skorları √dₖ ile ölçekle", "Softmax ağırlıklarıyla V temsillerini birleştir"],
        },
      },
      {
        id: "many-heads",
        indexLabel: "04",
        kicker: "Çoklu bakış",
        title: "Tek bir ilişki haritası yerine sekiz farklı bakış.",
        body: "Multi-head attention aynı diziyi farklı öğrenilmiş projeksiyonlarla tekrar tekrar değerlendirir. Bir head yakın sözdizimsel ilişkilere, diğeri daha uzak anlamsal bağlara odaklanabilir.",
        claimIds: ["claim-heads"],
        visual: {
          type: "metric",
          eyebrow: "Multi-head attention",
          caption: "Paper’ın base modelinde sekiz attention head bulunur.",
          items: [
            { label: "Head 01", value: "yakın", note: "Yerel ilişki" },
            { label: "Head 04", value: "uzak", note: "Cümle çapı" },
            { label: "Head 08", value: "örtük", note: "Öğrenilen desen" },
          ],
        },
      },
      {
        id: "results",
        indexLabel: "05",
        kicker: "Sonuçlar",
        title: "Daha paralel bir model, çeviride de daha güçlü çıktı.",
        body: "Büyük Transformer İngilizce–Almanca görevinde 28.4, İngilizce–Fransızca görevinde 41.8 BLEU elde etti. Yazarlar bunu önceki sistemlerden daha düşük eğitim maliyetiyle raporladı.",
        claimIds: ["claim-de", "claim-fr"],
        visual: {
          type: "comparison",
          eyebrow: "WMT 2014",
          caption: "Görevlerin ölçekleri farklıdır; çubuklar yalnızca raporlanan sonuçları gösterir.",
          items: [
            {
              label: "EN → DE",
              value: 28.4,
              displayValue: "28.4 BLEU",
              highlight: false,
            },
            {
              label: "EN → FR",
              value: 41.8,
              displayValue: "41.8 BLEU",
              highlight: true,
            },
          ],
        },
      },
      {
        id: "tradeoff",
        indexLabel: "06",
        kicker: "Sınırlar",
        title: "Doğrudan bağlantının bir bedeli var.",
        body: "Her token’ın diğer bütün token’larla karşılaştırılması, standart self-attention maliyetini dizi uzunluğunun karesiyle büyütür. Paper’ın kazancı gerçek; fakat sonsuz bağlam ücretsiz değildir.",
        claimIds: ["claim-limit"],
        visual: {
          type: "quote",
          eyebrow: "Karmaşıklık",
          caption: "Bu ifade paper’daki katman başına karmaşıklık tablosuna dayanır.",
          quote: "n token → n² ilişki",
          attribution: "Self-attention hesaplama deseni",
        },
      },
    ],
    closing: {
      title: "Paper’ın kalıcı fikri",
      body: "Transformer’ın başarısı yalnızca yeni bir skor değildir. Asıl değişim, sıralı hesaplamayı zorunluluk olmaktan çıkarıp ilişki kurmayı mimarinin merkezine yerleştirmesidir.",
    },
  },
};
