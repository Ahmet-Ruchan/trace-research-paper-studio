# Trace: sıradaki işler

Bu dosya yapılacak işlerin listesi ve sırası. Bir madde ancak yapılıp birim testleri,
tarayıcı testleri (e2e), `npm run check` ve gerekiyorsa eklenti testi geçtikten ve
main'e gönderildikten sonra `[x]` ile işaretleniyor. İşaretlenen her maddenin altında ne
yapıldığı ve nasıl test edildiği yazıyor.

## Sıra

1. Veri güvenliği: **1 → 24**
2. Her gün kullanılacak hızlı işler: **18 → 21 → 16**
3. Öğrendiğini kalıcı yapanlar: **6 → 22**
4. Kalan açıklar: **2 → 5 → 7**
5. Kalan hızlı ve orta işler: **3 → 4 → 19 → 17 → 9 → 26 → 14 → 15 → 8 → 25 → 20 → 23**
6. Bakım ve kontrol: **27 → 28 → 29 → 30**
7. Büyük işler: **10 → 11 → 12**
8. Karar bekleyen: **13** (arayüz dili; başlamadan önce sorulacak)

## Veri güvenliği

- [x] **1. Tam yedek.** "Download my data" profil ve çalışma saatlerinin yanında çalışma
  ilerlemesini, tekrar kartlarını, notları ve vurguları, okuma listesini, etiketleri ve kavram
  eşlerini de tek dosyada indirir. Başka bilgisayarda içe aktarınca her şey mevcut veriyle
  birleşir, hiçbir şey silinmez.
  - *Yapıldı:* Dosya biçimi 2 (`src/lib/full-backup.ts`); makaleler de dahil (kutu işaretliyse).
    İçe aktarma: var olan makalenin üzerine yazmıyor, aynı notta yenisi kalıyor, çalışma
    ilerlemesi iki cihaz gibi birleşiyor, buradaki kavram kararı değişmiyor; makalesi olmayan
    kayıt yazılmıyor. Sürüm 1 dosyaları okunmaya devam ediyor. İçe aktarımdan sonra kütüphane
    ve okuma listesi sayfa yenilenmeden tazeleniyor.
  - *Test:* birleştirme kuralları ve iki bilgisayar arasında gidiş-dönüş (aynı dosya ikinci kez
    yüklenince hiçbir şey çoğalmıyor) birim testlerde; boş bir kütüphaneye arayüzden yükleme
    e2e'de.
- [x] **24. Otomatik tam yedek.** Aynı tam yedek haftada bir kendiliğinden
  `~/.trace/backups` içine alınır.
  - *Yapıldı:* Stüdyo açıldıktan birkaç saniye sonra sunucu son yedeğe bakıyor; bir haftadan
    eskiyse (ya da hiç yoksa) makaleler dahil tam yedeği `trace-data-<gün>.json` olarak
    yazıyor, en yeni dördü kalıyor (`src/lib/backup-storage.ts`, `/api/backup`). Hiçbir şey
    kaydedilmemiş bir kurulumda yazmıyor. Profildeki "Your data" kartı son yedeğin gününü ve
    boyutunu gösteriyor. "Download my data" ile aynı dosya: içe aktarılabiliyor.
  - *Test:* haftada en çok bir kez yazma, boş kurulumda yazmama, dört yedek sınırı ve yedeğin
    geri yüklenmesi birim testlerde; stüdyonun açılışta yedeği yazması ve profilde göstermesi
    e2e'de.

## Çalışma saati

- [ ] **2. Study süresi de çalışma sayılır.** Study yolunda geçen süre takvime ve makale
  başına süreye eklenir; bölüm başına bir üst sınırla.
- [ ] **3. Tur sonunda "ne yaptın?"** Odak turu bitince tek satırlık bir not istenir; not
  oturuma yazılır, takvimde ve haftalık raporda görünür.
- [ ] **9. Takvim dışa aktarımı ve haftalık özet.** Oturumlar takvim dosyası (.ics) olarak
  iner; hafta sonunda bir özet bildirimi gelir.
- [ ] **16. Haftalık öğrenme hedefi.** "Bu hafta 2 makale bitir, 40 kart tekrar et" gibi
  hedefler; haftalık raporda ne kadarının tamamlandığı görünür.

## Notlar ve vurgular

- [ ] **4. Klavyeyle vurgu.** Metin seçiliyken H vurgular, N not kutusunu açar.
- [ ] **5. Study ve Primer'de vurgu ve not.** Vurgu yalnızca Deep report ve Story
  önizlemesinde değil, Study yolunda ve kavram açıklamalarında da yapılabilir.
- [ ] **6. Vurgudan tekrar kartı.** Vurgulanan cümle boşluk doldurmalı bir karta dönüşür;
  Review'a ve moladaki tekrara girer.
- [ ] **7. Notlarda arama.** Kütüphane araması iddiaların yanında notlarda ve vurgularda da
  arar.
- [ ] **8. Bütün kütüphaneyi Obsidian'a aktarmak.** Her makale bir not; notlar ve vurgular
  içinde; makaleler arasında kavram ve okuma sırası bağlantıları. Ajan tek komutla yapar.
- [ ] **25. Notları isteğe bağlı paylaşmak.** Yayın panelinde "seçtiğim notları dahil et";
  varsayılan kapalı.

## Okuma

- [ ] **17. Sesli okuma.** Hikâye ve rapor bölümleri tarayıcının kendi sesiyle okunur.
- [x] **18. Kaldığın yeri hatırlama.** Story ve raporda en son okunan yer saklanır;
  kütüphane kartında "Continue reading".
  - *Yapıldı:* Ekranın üst yarısındaki bölüm, bir buçuk saniye kalınca "okunan" sayılıp bu
    tarayıcıda saklanıyor (makale başına bir konum, en yeni 200 makale;
    `src/lib/reading-position.ts`). Story önizlemesinin ve Deep report'un başında "You stopped
    at 4 of 8: …" şeridi ve **Continue reading**; kütüphane kartında **Continue 4/8**, makaleyi
    o bölümde açıyor (rapor için Lab'in Deep report bölümü, hikâye için önizleme). İlk bölümde
    kalındıysa devam önerilmiyor.
  - *Test:* konum saklama, 200 sınırı, bozuk değer, kapalı depolama birim testlerde; rapor ve
    hikâyede ilerleyip kütüphaneden ve şeritten geri dönmek e2e'de.
- [ ] **19. Makale içi arama.** Tek makalenin iddialarında, raporunda, kavramlarında ve
  notlarında birlikte arama.
- [ ] **20. Komut paleti (Ctrl+K).** Makaleye, bölüme ya da eyleme yazarak gitmek.
- [ ] **26. Okuma listesini paylaşmak.** Okuma listesi bir bağlantıyla paylaşılır.

## Öğrenme

- [ ] **14. Sınav modu.** Kütüphaneden karışık, süreli deneme; vadesi gelmemiş kartlar da.
- [ ] **15. Makaleler arası sorular.** İki makalenin kanıtından otomatik karşılaştırma
  soruları; model gerekmez.

## Ajanlar

- [ ] **21. `today` komutu.** Günün özeti: vadesi gelen kartlar, okuma listesinde sıradaki,
  bu haftanın süresi, yarım kalan makale.
- [ ] **22. Sohbette tekrar.** Ajan vadesi gelen kartları sohbette sorar ve sonucu
  stüdyonun kaydına yazar.
- [ ] **23. MCP sunucusu.** Kütüphane, iddia araması, notlar ve okuma listesi MCP araçları
  olarak sunulur.

## Bakım ve kontrol

- [ ] **27. Telefonda vurgu denemesi.** Gerçek dokunmatik seçimde telefonun kendi menüsüyle
  çakışma olup olmadığı.
- [ ] **28. Testleri hızlandırmak.** Her test işçisine ayrı veri klasörü; e2e paralel koşar.
- [ ] **29. Kod düzeni.** Ekran geçişlerini yöneten ana dosya bölünür.
- [ ] **30. Gerçek oturum testi.** Hangi ajanın gerçek bir model oturumuyla sınandığının
  kontrolü.

## Büyük işler

- [ ] **10. Zotero veya BibTeX içe aktarımı.** Mevcut kütüphane okuma listesine gelir.
- [ ] **11. Kurulabilir uygulama (PWA).** Masaüstüne ve telefona kurulur, kütüphane
  çevrimdışı açılır.
- [ ] **12. Hesaplar ve ekip incelemesi.** Birlikte onay, paylaşılan notlar.
- [ ] **13. Arayüz dili.** Arayüz şu an bilinçli olarak İngilizce; başlamadan önce karar
  gerekiyor.
