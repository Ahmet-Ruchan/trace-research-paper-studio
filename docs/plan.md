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

- [x] **2. Study süresi de çalışma sayılır.** Study yolunda geçen süre takvime ve makale
  başına süreye eklenir; bölüm başına bir üst sınırla.
  - *Yapıldı:* Study yolunda her adımda geçen süre, yalnızca sekme öndeyken ve adım başına en
    çok 20 dakika, "Study" türünde bir oturum olarak o makaleye yazılıyor; adımlar arka arkaya
    geldikçe aynı oturum uzuyor, sınırı aşan adımdan sonra yeni oturum başlıyor. Profilde "Count
    study time as work" ile kapatılabiliyor; aynı anda süren odak turuyla bir kez sayılıyor.
    Ayrıca: çalışma kaydında bozuk ya da daha yeni bir sürümün bilinmeyen türdeki tek bir oturum
    artık bütün kaydı değil yalnızca kendisini düşürüyor; Study'de "Start over" haftalık hedefin
    gün gün tekrar sayılarını silmiyor. Eklenti 0.32.0.
  - *Test:* Study oturumu, bloğun uzaması, bozuk oturumun tek başına düşmesi, "Start over"ın
    sayıları koruması birim testlerde; Study'de saat ileri alınarak 3 + 20 (sınır) dakikanın
    makaleye iki oturum olarak yazılması ve profilde makale süresinde görünmesi e2e'de.
- [x] **3. Tur sonunda "ne yaptın?"** Odak turu bitince tek satırlık bir not istenir; not
  oturuma yazılır, takvimde ve haftalık raporda görünür.
  - *Yapıldı:* Tur bitince çıkan bildirimde (her ekranda) isteğe bağlı "What did you do?"
    kutusu; yazılan satır (en çok 200 karakter) o turun oturumuna `note` olarak gidiyor
    (duraklatılıp sürdürülen turda son parçaya). Bugünün oturumlarında, profilde günün
    oturumlarında ve haftalık raporda **What you did** altında görünüyor; ajanın `work`
    komutu da veriyor. Aynı oturum notsuz yeniden gelince (iki sekme) not kalıyor, uzayan
    oturum notu taşıyor, boş not siliyor. Eklenti 0.34.0.
  - *Test:* notun oturumla birleşmesi, uzayan oturum, silme, sınır ve turun oturumunu bulma
    birim testlerde; bir tur bitince bildirimden not yazıp Focus ekranında, profilde ve
    haftalık raporda görmek e2e'de (boşluk tuşu zamanlayıcıyı durdurmuyor).
- [x] **9. Takvim dışa aktarımı ve haftalık özet.** Oturumlar takvim dosyası (.ics) olarak
  iner; hafta sonunda bir özet bildirimi gelir.
  - *Yapıldı:* Profilin takviminde **Calendar file**: gösterilen aralığın oturumları RFC 5545
    `.ics` olarak (`src/lib/work-export.ts`), her oturum bir etkinlik, makalesi ve tur notuyla;
    kimlik oturumdan, yeniden içe aktarmak çoğaltmıyor; satırlar 75 baytta katlanıyor. Ajan da
    `work --ics <dosya> [--days N]` ile yazıyor. Yeni hafta başlayınca geçen haftanın özeti bir
    kez bildirim olarak geliyor (süre, gün sayısı, önceki haftaya göre, en iyi gün; masaüstü
    bildirimi açıksa orada da), "See the weekly report" profile götürüyor; profilde
    "Weekly summary" ile kapatılıyor. Eklenti 0.35.0.
  - *Test:* takvim dosyasının biçimi (UTC, kaçışlar, katlama, özet adları), hafta özeti (pazartesi
    ve pazar başlayan hafta, boş hafta, metin) ve köprünün dosya yazması birim testlerde;
    özetin bir kez çıkması, rapora götürmesi ve takvim dosyasının indirilmesi e2e'de; eklenti
    smoke testi üç CLI'da `bridge work --ics`.
- [x] **16. Haftalık öğrenme hedefi.** "Bu hafta 2 makale bitir, 40 kart tekrar et" gibi
  hedefler; haftalık raporda ne kadarının tamamlandığı görünür.
  - *Yapıldı:* Profilde "Goals and preferences" altında haftalık makale ve kart hedefi (0: yok).
    Her tekrar o günün sayısına yazılıyor (`study.json`'da `reviewDays`, yerel gün; Review, Lab
    ve moladaki tekrar hepsi); iki cihaz birleşince aynı gün iki kez sayılmıyor. "This week
    against last" en üstte **Learning this week**: bitirilen makaleler ve tekrar edilen kartlar
    ilerleme çubuklarıyla, hatırlananlar ve "günde kaç kart kaldı". `today` komutu da hedefi
    veriyor (`learningThisWeek`). Eklenti 0.29.0.
  - *Test:* gün gün sayım (gece yarısı sınırı dahil), 400 gün sınırı, birleştirme, eski
    profilin okunması, pazartesi/pazar başlayan hafta birim testlerde; hedef koyup kart tekrar
    edince sayının artması e2e'de; `today` köprüsü hedefle; telefon genişliğinde taşma yok.

## Notlar ve vurgular

- [x] **4. Klavyeyle vurgu.** Metin seçiliyken H vurgular, N not kutusunu açar.
  - *Yapıldı:* Not alınabilen bir yerde (rapor, Story önizlemesi, Study, Primer) metin seçiliyken
    **H** araç çubuğunda en son seçilen renkle (ilk seferde sarı, bu cihazda hatırlanıyor)
    vurguluyor, **N** vurgulayıp not kutusunu açıyor. Seçim o anda okunuyor, araç çubuğunu
    beklemiyor. Yazı alanındayken, Ctrl/Cmd/Alt ile ya da seçim yokken harfler bir şey yapmıyor.
    Araç çubuğunda H'nin rengi ve N `aria-keyshortcuts` ve ipucuyla gösteriliyor.
  - *Test:* seçim yokken H'nin bir şey yapmaması, H ile sarı, çubukta pembe seçilince H'nin
    pembe vurgulaması, N ile not kutusunun açılıp odaklanması ve "n"nin kutuya düşmemesi e2e'de.
- [x] **5. Study ve Primer'de vurgu ve not.** Vurgu yalnızca Deep report ve Story
  önizlemesinde değil, Study yolunda ve kavram açıklamalarında da yapılabilir.
  - *Yapıldı:* Study yolundaki bölüm metni hikâyenin aynı bölümüyle aynı işareti taşıyor:
    orada yapılan vurgu Story önizlemesinde de görünüyor. Kavramlar için yeni yer `concept`
    (Primer'de ve Study'nin kavram adımında aynı işaret). Notes'ta "Primer" başlığıyla, hikâye ve
    rapordan sonra, iddialardan önce; "Show it" Primer'de o kavramı açıyor; elle not eklerken
    kavramlar da seçilebiliyor; Markdown/Obsidian ve ajanın `notes` komutu da aynı sırayla.
    Vurgudan tekrar kartı bu yerlerde de çalışıyor. Eklenti 0.33.0.
  - *Test:* kavram notunun şeması, sırası ve Markdown'ı birim testlerde; Study'de bir bölümde ve
    Primer'de bir kavramda vurgu, notlarda yer ve başlık, "Show it" ile kavrama dönüş, Story
    önizlemesinde boyanması e2e'de.
- [x] **6. Vurgudan tekrar kartı.** Vurgulanan cümle boşluk doldurmalı bir karta dönüşür;
  Review'a ve moladaki tekrara girer.
  - *Yapıldı:* Lab'in Notes bölümünde her vurgunun altında **Make a review card**: gizlenecek
    kelime öneriliyor (önce makalenin sözlüğündeki ya da Primer'deki terim, sonra sayı, sonra en
    uzun kelimeler; `src/lib/highlight-cards.ts`), okuyucu başkasını seçebiliyor. Kart çalışma
    kaydında `h:<not kimliği>` olarak, metniyle duruyor ve Review'a, Lab'deki tekrara, moladaki
    tekrara, istatistiklere ve `progress`/`today` komutlarına giriyor. Tekrarda kelime yazılıyor
    (büyük-küçük harf, aksan, noktalama önemsiz); tutmazsa yanıt açılıyor ve okuyucu "I had it" /
    "Not yet" diyor. Kelime değişince kart baştan başlıyor; vurgu silinince kart da gidiyor.
    Eklenti 0.30.0.
  - *Test:* öneri sırası, kısaltmalı terim, küçük kelimelerden kart çıkmaması, yazılan yanıtın
    eşleşmesi, kuyruk ve sonraki tekrar, kelime değişince baştan başlama, silme, bozuk kart,
    iki cihazın birleşmesi birim testlerde; vurgudan kart yapıp tekrar ekranında biri doğru biri
    yanlış yanıtlamak ve vurguyu silince kartın gitmesi e2e'de; telefon genişliği elle kontrol.
- [x] **7. Notlarda arama.** Kütüphane araması iddiaların yanında notlarda ve vurgularda da
  arar.
  - *Yapıldı:* Kütüphane aramasında **Papers** ve **Claims**'in yanında **Your notes**: bütün
    makalelerin notları ve vurguları, her biri makalesi ve yeriyle (hikâye, rapor, Primer ya da
    iddia ve başlığı), eşleşen kelimeler işaretli (`src/lib/note-search.ts`). Her kelime notun
    metninde, vurgusunda ya da yerinin başlığında geçmeli; kendi yazdığın ve vurguladığın başlıktan
    ağır basıyor, eşit puanda en yeni not önce. İddia notu iddiayı, ötekiler makalenin Notes
    bölümünü açıyor. Etiketle seçilmiş koleksiyonda yalnızca onun notları. Notlar API'si
    kimliksiz istekte bütün kütüphanenin notlarını veriyor.
  - *Test:* dizin (işaretlerin ve kütüphanede olmayan makalenin dışarıda kalması), sıralama,
    birden çok kelime, sınır ve bütün notları veren API birim testlerde; arama, sayım, yer
    etiketleri, işaretli kelime, bölüm notundan Notes'a ve iddia notundan iddiaya gitmek e2e'de;
    telefon genişliğinde taşma yok.
- [ ] **8. Bütün kütüphaneyi Obsidian'a aktarmak.** Her makale bir not; notlar ve vurgular
  içinde; makaleler arasında kavram ve okuma sırası bağlantıları. Ajan tek komutla yapar.
- [ ] **25. Notları isteğe bağlı paylaşmak.** Yayın panelinde "seçtiğim notları dahil et";
  varsayılan kapalı.

## Okuma

- [x] **17. Sesli okuma.** Hikâye ve rapor bölümleri tarayıcının kendi sesiyle okunur.
  - *Yapıldı:* Story önizlemesinde ve Lab'in derin raporunda her bölümün başında **Listen**:
    o bölümden başlayıp sona kadar tarayıcının konuşma sentezi (Web Speech API) ile, makalenin
    diliyle okuyor. Metin cümle sınırında kısa parçalara bölünüyor (Chrome uzun konuşmayı kesiyor),
    LaTeX ve işaretler okunmuyor (`src/lib/read-aloud.ts`). Okunan bölüm çerçeveleniyor ve ekrana
    getiriliyor; alttaki çubuk duraklatıyor, sonraki bölüme geçiyor, durduruyor ve hızı (0.8–1.5×,
    bu cihazda hatırlanıyor) değiştiriyor. Sentez olmayan tarayıcıda düğme hiç çıkmıyor; ekrandan
    çıkınca okuma duruyor.
  - *Test:* bölüm metni, LaTeX'in temizlenmesi, parçaların sınırı ve sırası birim testlerde;
    sahte bir konuşma motoruyla bölümden başlama, dil, duraklat/sürdür, hız, bölüm atlama,
    kendiliğinden ilerleme, durdurma, raporun sonunda bitme ve sentez yokken düğmenin çıkmaması
    e2e'de.
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
- [x] **19. Makale içi arama.** Tek makalenin iddialarında, raporunda, kavramlarında ve
  notlarında birlikte arama.
  - *Yapıldı:* Lab'de **Search** bölümü (Lab'in her yerinde <kbd>/</kbd> açıp kutuya odaklıyor):
    iddialar ve alıntıları, hikâye ve derin rapor bölümleri, Primer kavramları, sözlük ve
    okuyucunun notları birlikte (`src/lib/paper-search.ts`). Başlıkta geçen kelime metindekinden,
    başlığı aranan şeyin kendisi olan sonuç hepsinden ağır basıyor; her kelime geçmeli. Sonuç
    türüyle ve işaretli kelimelerle; tıklayınca iddiaya, bölüme, Primer'de kavrama, sözlükte
    terime ya da notun olduğu yere gidiyor. Notlardaki "Show it" ile aynı yol.
  - *Test:* bütün türlerde bulma, sıralama, notun hedefi, metinsiz işaretin aranmaması, her
    kelimenin gerekmesi, sınır birim testlerde; "/" ile açılış, kavrama, notun rapor bölümüne,
    sözlük terimine ve iddiaya gitmek e2e'de; telefon genişliği elle kontrol.
- [ ] **20. Komut paleti (Ctrl+K).** Makaleye, bölüme ya da eyleme yazarak gitmek.
- [x] **26. Okuma listesini paylaşmak.** Okuma listesi bir bağlantıyla paylaşılır.
  - *Yapıldı:* Okuma sırasının altında **Share the list**: listenin o anki kopyası `/r/<kimlik>`
    adresinde, okuma sırasındaki yerleri ve nedenleri, arXiv/DOI bağlantılarıyla; istenirse
    kütüphanedeki makaleler de yerlerinde (`src/lib/reading-share.ts`). Notlar ve ilerleme
    girmiyor. Sayfa betiksiz, kaçışlı HTML ve yayınlarla aynı güvenlik başlıklarıyla; kimlik
    80 bit rastgele, liste ucu yok. **Update to the current list** kopyayı yeniliyor, **Take
    down** bağlantıyı hemen kapatıyor (bulunamayan, kaldırılan ve süresi dolan aynı 404), 7/30/90
    günlük süre seçilebiliyor. Parola korumalı sunucuda `/r/<kimlik>` açık kalıyor.
  - *Test:* bağlantılar, makalelerle ve makalesiz liste, HTML kaçışı ve betik olmaması, durumlar,
    boş listenin reddi, kopyanın güncellenene kadar değişmemesi, kaldırma ve silme birim
    testlerde; açık yollar parola testinde; paylaşmak, okuyucunun sayfayı görmesi, güncelleme ve
    kaldırınca 404 e2e'de.

## Öğrenme

- [ ] **14. Sınav modu.** Kütüphaneden karışık, süreli deneme; vadesi gelmemiş kartlar da.
- [ ] **15. Makaleler arası sorular.** İki makalenin kanıtından otomatik karşılaştırma
  soruları; model gerekmez.

## Ajanlar

- [x] **21. `today` komutu.** Günün özeti: vadesi gelen kartlar, okuma listesinde sıradaki,
  bu haftanın süresi, yarım kalan makale.
  - *Yapıldı:* `trace-agent.mjs today` (`src/lib/today.ts`) tek cevapta vadesi gelen kartları
    ve hangi makalelerden olduklarını, yarım kalan makaleleri ve kaç adımın bittiğini, sıradaki
    okumayı (okuma sırasındaki makale, okuma listesindeki çalışma ya da başlanmamış bir makale),
    bugünü ve bu haftayı hedefe göre, seriyi veriyor; `suggestions` bunları önem sırasıyla
    cümle olarak söylüyor. SKILL.md'de "Today", README'de komut ve örnek istem; eklenti 0.28.0.
  - *Test:* kartlar, yarım makale, okuma listesi, okuma sırası, hedef tutmuş ve boş kütüphane
    birim testlerde; köprü komutu gerçek bir `~/.trace` klasöründe çalıştırılıyor; eklenti smoke
    testi Codex, Claude Code ve Antigravity'de `bridge today`.
- [x] **22. Sohbette tekrar.** Ajan vadesi gelen kartları sohbette sorar ve sonucu
  stüdyonun kaydına yazar.
  - *Yapıldı:* `trace-agent.mjs review` vadesi gelen kartları yanıtsız listeliyor (makaleler
    karışık, `--limit`); `--answer` okuyucunun yanıtını stüdyonun kuralıyla denetleyip
    `study.json`'a aynı kilitle yazıyor (`src/lib/chat-review.ts`): soru harfle (yalnızca ilk
    yanıt sayılıyor), vurgu kartı yazılan kelimeyle (tutmazsa karar okuyucunun), kavram `--show`
    ile yanıt gösterildikten sonra okuyucunun "hatırladım/hatırlamadım"ıyla. Yalnızca vadesi
    gelmiş kart yazılıyor. SKILL.md'de "Review in the chat", README'de örnek istem; eklenti 0.31.0.
  - *Test:* liste yanıt içermiyor, harf biçimleri, yanlış/doğru soru, vadesi gelmemiş kartın
    reddi, yanlış yazılan kelime, kavramın yalnızca okuyucunun kararıyla yazılması birim
    testlerde; köprü gerçek bir `~/.trace` üzerinde listeleyip yazıyor; eklenti smoke testi
    Codex, Claude Code ve Antigravity'de `bridge review`.
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
