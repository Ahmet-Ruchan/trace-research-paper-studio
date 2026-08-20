# LinkedIn paylaşımı

Bir makaleyi özetlemek saniyeler sürüyor. O özetin doğru olduğundan emin olmak saatler.

Son dönemde bu boşluğu kapatmak için çalıştığım projeyi açık kaynak olarak paylaşıyorum: Trace — Research Paper Studio.

Çıkış noktam şuydu: bir dil modeline makale verip özet istediğinizde elinize akıcı ama doğrulanamaz bir metin geçiyor. Hangi cümle hangi sayfaya dayanıyor? Bu, yazarların ölçtüğü bir sonuç mu, yoksa yorumu mu? Bunu anlamak için makaleye geri dönmek zorunda kalıyorsunuz. Yani özet aslında zaman kazandırmıyor, sadece erteliyor.

Trace bu ilişkiyi tersine çeviriyor. Üretilen her iddia, makaledeki sayfaya ve birebir alıntıya bağlı. Ölçülmüş sonuç, yazar yorumu ve arka plan bilgisi ayrı ayrı etiketleniyor. Alıntının doğrudan desteklemediği hiçbir ifade "doğrulanmış" sayılmıyor.

Asıl ayrıştığı nokta ise okumak değil, denemek.

Attention Is All You Need makalesi için sistemin ürettiği çıktıda bir kaydırma çubuğu var: anahtar boyutu d_k. Makale, iç çarpımların √d_k ile bölünmesi gerektiğini savunuyor ama bunun grafiğini hiç çizmiyor. Kaydırıcıyı hareket ettirdiğinizde ölçeklenmemiş dikkat ağırlığının 1'e yapıştığını, ölçeklenmiş olanın sabit kaldığını kendi gözünüzle görüyorsunuz. Kaydırıcı makalenin kullandığı değerde başlıyor, o nokta işaretli, ve o bölgeden ayrıldığınızda sistem sizi uyarıyor: burası makalenin doğruladığı alan değil.

Aynı çıktıda makalenin varsaydığı ama hiç açıklamadığı ön bilgiler, adım adım türetimler, mekanizma simülasyonları, kanıta bağlı bir anlama testi ve "bunu ne zaman kullanmamalısınız" bölümü içeren bir uygulama rehberi bulunuyor.

Kullanımı tek cümle. Elinizde PDF olması da gerekmiyor:

"Bana Attention Is All You Need makalesini Trace ile anlat."

Sistem makaleyi arXiv'de buluyor, indiriyor, sayfa sayfa okuyor, yayımlandığı yer ve atıf verisi gibi güncel bilgileri topluyor ve tarayıcınızda yerel bir site açıyor. Codex, Claude Code ve Gemini CLI ile çalışıyor; zaten kullandığınız modeli kullandığı için ayrı bir API anahtarı istemiyor.

Mühendislik tarafında en çok önemsediğim karar, yanlış veriyi göstermektense hiç göstermemek oldu. Geliştirme sırasında bir üstveri kaynağının LoRA makalesi için başka bir çalışmanın atıf sayısını döndürdüğünü fark ettim. O kaynağı düzeltmek yerine, güvenilir sonuç veremediği durumlarda tamamen devre dışı bıraktım. Benzer şekilde, aradığınız makaleyle ismi benzeşen farklı bir makale bulunduğunda sistem bunu kesin kabul etmiyor, size soruyor. Otoriter görünen yanlış bilgi, eksik bilgiden çok daha maliyetli.

Aynı ilke kod tarafında da geçerli: içe aktarılan proje dosyaları güvenilmeyen girdi kabul ediliyor, interaktif içeriklerdeki matematik hiçbir zaman çalıştırılabilir kod olarak değerlendirilmiyor. Doğrulama katmanı, bir etkileşimin gerçekten çalışacağını daha üretim anında kanıtlıyor.

Proje açık kaynak. Kod, kurulum adımları ve Attention Is All You Need için hazırlanmış tam örnek çıktı burada:

https://github.com/Ahmet-Ruchan/trace-research-paper-studio

Makale okumaya vakit ayıran herkesin geri bildirimine açığım. Özellikle şunu merak ediyorum: kendi alanınızda bir makaleyi gerçekten anladığınızı nasıl test ediyorsunuz?

#AçıkKaynak #YapayZeka #AraştırmaAraçları #MakineÖğrenmesi #GeliştiriciAraçları
