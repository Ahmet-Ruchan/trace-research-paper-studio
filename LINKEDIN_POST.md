# LinkedIn paylaşım taslağı

Araştırma makalelerini kanıtlarıyla inceleyen, görselleştiren ve etkileşimli bir çalışma alanına dönüştüren Trace Research Paper Studio’yu geliştirdim.

Çözmek istediğim problem şuydu: Bir paper’ı özetlemek kolay, fakat önemli ifadelerin hangi sayfa ve alıntıya dayandığını görmek çoğu zaman mümkün değil.

Trace’i bu nedenle evidence-first tasarladım. Sistem PDF’den araştırma sorusunu, yöntemleri, bulguları, metrikleri, sınırlılıkları ve kavramları çıkarıyor. Her önemli iddiayı paper’daki sayfa ve kısa alıntıyla ilişkilendiriyor. Bütün aşamalar yapılandırılmış şemalar ve anlamsal kontrollerle doğrulanıyor.

Her paper için tek bir özet yerine şunlar üretiliyor:

- Sayfa ve kaynak bağlantılı evidence map
- Katkı, mekanizma, deney, eleştiri ve yeniden üretimi ele alan derin analiz raporu
- Denklemler, algoritma adımları, karmaşıklık notları ve açıklayıcı kod taslakları içeren teknik ek
- Mimari şemalar, akışlar, karşılaştırmalar, zaman çizelgeleri, matrisler ve infografikler
- İnteraktif scrollytelling deneyimi
- Düzenlenebilir Lab, Story ve Preview çalışma alanları
- Geçmiş çalışmalar için aranabilir yerel Library
- İçe aktarılabilir `.trace.json` ve bağımsız HTML çıktısı

Trace; Gemini, OpenAI, Claude ve OpenRouter ile çalışıyor. Kullanıcı tek model kullanabiliyor veya model team modunda evidence, matematik ve kod, rapor ve görsel anlatı görevlerine farklı modeller atayabiliyor.

Uzun üretimlerde streaming, heartbeat, retry, checkpoint ve kaldığı yerden devam etme mekanizmaları çalışmayı koruyor. API anahtarları proje çıktılarına kaydedilmiyor.

Native agent plugin’i Codex, Claude Code ve Gemini CLI ile çalışıyor. Ayrıca API anahtarı gerekmiyor; analiz kullanıcının aktif agent modeliyle yapılıyor.

Plugin kurulduktan sonra yalnızca şu tür bir istek yeterli:

> Şu paper’ı al ve Trace plugin kullanarak çıktıyı ver: `./paper.pdf`

Agent paper’ı okuyup bütün çıktıları hazırlıyor, `.trace.json` dosyasını doğruluyor ve tamamlanmış Trace deneyimini local web sitesi olarak tarayıcıda açıyor.

Taşınabilir JSON; Library’ye aktarılabiliyor, arşivlenebiliyor veya başka bir cihazda açılabiliyor. Local site yalnızca `127.0.0.1` üzerinde çalışıyor; paper otomatik olarak yayınlanmıyor.

MVP’ye API anahtarı olmadan incelenebilen Attention Is All You Need örneğini de ekledim.

Amacım klasik bir AI özet ekranı değil; sade bir arayüz içinde araştırmayı okumayı, doğrulamayı, öğrenmeyi, anlatmayı ve yeniden üretmeyi kolaylaştıran güvenilir bir ortam oluşturmaktı.

Proje açık kaynak:

https://github.com/Ahmet-Ruchan/trace-research-paper-studio

Geri bildirimlere ve geliştirme fikirlerine açığım.

#ArtificialIntelligence #ResearchTools #OpenSource #LLM #MachineLearning #DeveloperTools
