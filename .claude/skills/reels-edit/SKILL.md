---
name: reels-edit
description: Kanalın Instagram Reels video kuralları ve iş akışı (HyperFrames ile). Kullanıcı bir video editlemek, Reels hazırlamak, altyazı eklemek, kapak yapmak, storyboard çıkarmak veya HyperFrames ile herhangi bir video işi istediğinde ÖNCE bunu oku; /hyperframes skill'iyle birlikte kullanılır ve onunla çeliştiğinde bu kurallar kazanır. Use for any Instagram Reels / video editing request in this repo.
---

# Reels Edit — kanal kuralları

Kullanıcı içeriklerini **Instagram Reels** olarak paylaşıyor. Konular: araştırma ve bilim anlatımı,
makaleler, makine öğrenmesi, yapay zekâ, derin öğrenme, akademik konular, bilgisayar bilimi,
araçlar, kodlama, ürünler, teknoloji haberleri, öğretici/eğitici teknoloji içerikleri.

Teknik mekanik (kompozisyon, zaman çizelgesi, render, transkript) için `/hyperframes`,
`/hyperframes-cli`, `/hyperframes-registry` ve `/media-use` skill'lerini kullan. **Bu dosyadaki
kurallar o skill'lerdeki her varsayılanın önüne geçer.**

## 1. Değişmez kurallar

1. **Font her zaman Newsreader.** Başlık, gövde, altyazı, etiket, grafik yazısı, kapak — hepsi.
   Başka font yok (kod parçası gösterilirken bile; kod için Newsreader'ın düz hâli + `font-variant-numeric: tabular-nums`).
   Newsreader HyperFrames'e gömülü değil: `assets/fonts/` klasörünü projeye kopyala ve
   `@font-face` kurallarını ekle (bkz. §4). Türkçe karakterler (ğ ş ı İ ç ö ü) `latin-ext` dosyasında.
2. **Yüze ve videoya hiçbir filtre yok.** Renk düzeltme/grade, LUT, "look", güzelleştirme, cilt
   yumuşatma, blur, vinyet, grain, keskinleştirme, glow, `filter:`/`backdrop-filter:` uygulanmış
   footage, `/media-use` media-treatment'ları, `hyperframes media-treatment apply` — **hiçbiri**.
   Ham görüntü olduğu gibi kalır. `/hyperframes` veya `/media-use` "footage karanlık/düz görünüyor,
   tedavi uygula" dese bile uygulama; gerekirse kullanıcıya söyle, o karar versin.
   Kırpma / punch-in zoom filtre değildir ama sadece storyboard'da gösterilip onaylanırsa yapılır.
3. **AI slop yok, AI yapımı olduğu anlaşılmayacak.** Ayrıntı §2.
4. **Altyazı her videoda var**, Newsreader, *sade cümle* stili (§5).
5. **İçeriğe göre tasarım:** anlatılan şeye göre görseller, ikonlar, diyagramlar ve animasyonlar
   tasarla (§6). Süs için değil, anlatılanı açıklamak için.
6. **Renk paleti her videoda değişir** ama her zaman `references/palettes.md` ruhunda: sade,
   uyumlu, editoryal. Önceki videonun paletini tekrar etme (§3).
7. **Kapak her videoda kullanıcıya sorulur** (§7).
8. **Final render'dan önce storyboard** çıkar, kullanıcı onaylamadan bitirme (§8).

## 2. AI slop yasakları — referans: Apple, Anthropic, OpenAI videoları

Hedef his: bol boşluk, ekranda tek fikir, büyük ve kendinden emin tipografi, yavaş ve net
easing, az ama anlamlı hareket, gerçek ürün/kod/makale görüntüleri, hassas diyagramlar.

Asla:
- Mor-mavi/neon gradyanlar, parlayan küreler, lens flare, bokeh/parçacık yağmuru, glassmorphism,
  "hologram", glitch + daktilo klişeleri, her şeyin zıpladığı aşırı animasyon.
- Emoji ve ✨ 🚀 🔥 🤖 gibi semboller ikon yerine; devre kartlı beyin, robot eli, mavi dijital
  kafa, "matrix" yağmuru gibi yapay zekâ klişe görselleri.
- AI ile üretilmiş görsel, video, avatar, seslendirme veya müzik — kullanıcı açıkça istemedikçe.
  (`/media-use` HeyGen üretimleri dahil.) Görsel gerekiyorsa: gerçek ekran görüntüsü, makale
  figürü (kaynağıyla), kendi çizdiğin vektör diyagram/ikon, ya da kullanıcıdan iste.
- Şablon metin: "Merak ettiniz mi?", "Hadi gelin…", "oyunun kurallarını değiştiren", "devrim
  niteliğinde", "bu her şeyi değiştirecek", "inanılmaz", "game-changer", "unlock", "delve",
  arka arkaya üçlü sıralamalar, gereksiz uzun tire. Ekrandaki metin kullanıcının **kendi
  söylediklerinden** gelir; ekleme yaparsan kısa, düz, kullanıcının ağzından çıkabilecek gibi olsun.
- Ekranı dolduran stok "teknoloji" arka planları, rastgele kod akışları, anlamsız grafikler.
- Ses efektlerini her geçişe koymak. Ses efekti az ve yerinde; whoosh spam yok.

## 3. Renk paleti

- `references/palettes.md` içindeki paletlerden seç veya aynı kurallarla yenisini üret
  (kurallar dosyada). Kontrast: yazı/zemin ≥ 7:1, vurgu/zemin ≥ 3:1.
- Son kullanılan paletler `reels/PALETTE_LOG.md`'de. Son 2 videonun paletini önerme.
- Her video için konuya uyan **3 palet adayı** göster (AskUserQuestion, preview'da renk kodları
  ve "his"), kullanıcı seçsin. Seçileni `reels/PALETTE_LOG.md`'ye ekle.
- Palet sadece **grafiklere** uygulanır (zemin kartları, ikonlar, başlıklar, diyagramlar,
  altyazı rengi). Kullanıcının görüntüsüne asla renk binmez.
- CSS değişkenleri olarak tanımla: `--bg --surface --text --muted --accent --accent2`.

## 4. Proje kurulumu (her video)

```bash
cd /home/user/trace-research-paper-studio/reels   # repo kökündeki reels/
npx hyperframes init <YYYY-MM-DD-konu> --resolution portrait --non-interactive --skip-skills
mkdir -p <YYYY-MM-DD-konu>/assets
cp -r ../.claude/skills/reels-edit/assets/fonts <YYYY-MM-DD-konu>/assets/fonts
```

- `../.claude/skills/reels-edit/assets/newsreader-fontface.css` içindeki `@font-face`
  kurallarını, fontu kullanan **her HTML dosyasının `<style>` bloğuna yapıştır** (lint,
  `<link>` ile bağlanan CSS'teki `@font-face`'i görmez ve `font_family_without_font_face`
  hatası verir). Yollar proje köküne göre `assets/fonts/...`. Sonra
  `font-family: 'Newsreader', serif;`. `npx hyperframes lint` 0 hata vermeli.
  Newsreader değişken font: `font-weight: 200–800`, `font-optical-sizing: auto` (büyük
  başlıklarda opsz otomatik display kesimine geçer).
- Format: **1080×1920, 9:16, 30 fps**, H.264 MP4. Kullanıcı videosu dikey değilse sor.
- **Güvenli alan (Instagram arayüzü):** üst 250 px, alt 420 px (açıklama, ses, butonlar),
  sağ 140 px (beğeni/yorum butonları) boş kalır; önemli metin/grafik bu alanlara girmez.
- Kullanıcı footage'ını `--keep-original` olmadan init ile ya da `assets/`a koyarak ekle;
  footage'ı yeniden renklendiren hiçbir dönüştürme yapma.
- Ham footage, render'lar ve `.hyperframes/` git'e girmez (`reels/.gitignore`).

## 5. Altyazı — sade cümle

- Transkript: Türkçe için `npx hyperframes transcribe <video> --model small --language tr --json`
  (teknik terim çoksa `--model medium --language tr`). whisper-cpp yoksa önce kur
  (`hyperframes doctor` ipucunu verir). **Asla varsayılan `small.en` kullanma** — Türkçeyi
  İngilizceye çevirir.
- Transkripti oku; teknik terimleri (transformer, gradient descent, LLM, PyTorch, makale ve
  kişi adları) düzelt. Emin olmadığın kelimeleri storyboard'da işaretle.
- Stil: 1–2 satır, satır başına en fazla ~32 karakter, cümle/duraklama sınırından böl, kelime
  vurgusu yok, zıplama yok; sadece kısa fade (0.12 s). Newsreader 500–600, ~56–64 px
  (`fitTextFontSize` ile, `maxWidth` 860). Renk `--text` veya beyaz; görüntü açıksa metnin
  boyutunda %30–40 scrim (tam genişlik bant değil). Blend modu kullanma.
- Konum: alttan ~600–700 px, güvenli alanın içinde, yüzün üstüne asla gelmez.
- Ekranda o an büyük bir başlık/grafik metni varsa ve aynı şeyi söylüyorsa altyazıyla
  çakıştırma; altyazıyı kısa süre kaldırmak yerine grafiği konumlandır.

## 6. Görsel tasarım

- Anlatılan her ana fikir için bir görsel karar: diyagram (model mimarisi, veri akışı,
  grafik), gerçek ekran görüntüsü (makale başlığı, arayüz, kod), ya da tek bir büyük tipografik
  vurgu. Her sahnede tek fikir.
- İkonlar: tek bir çizgi ikon ailesi (Lucide tercih), sabit çizgi kalınlığı 1.5–2 px, palet
  renklerinde. Emoji yok. `/media-use` ve `/hyperframes-registry` ile bul; registry bloklarını
  kullanırsan fontu Newsreader'a, renkleri palete çevir ve slop öğelerini (glow, gradyan,
  parçacık) çıkar.
- Makale/figür gösteriyorsan kaynak satırı (yazar, yıl, venue) küçük `--muted` Newsreader ile.
- Hareket: `power2/power3` ease-out, 0.4–0.8 s girişler; sahne başına en fazla 1–2 hareketli
  öğe. Grafik giriş/çıkışları konuşmanın ritmine (transkript zamanlarına) oturur.
- Grafikler kullanıcıyı kapatmaz: konuşan kafa varsa grafikler üst/yan alanda, kart hâlinde
  ya da kısa tam ekran ara sahne olarak.

## 7. Kapak (Reels cover)

Her videoda sor (AskUserQuestion), 2–3 seçenek sun, ör.:
- Videodan iyi bir kare + büyük Newsreader başlık,
- Sadece tipografi (palet zemini + başlık),
- Kare + alt bantta başlık.
Kapak 1080×1920 hazırlanır ama önemli içerik ortadaki **1080×1440 (3:4)** alanda kalır
(profil gridi bunu kırpar). Seçilen karede de filtre yok. Başlık 2–6 kelime, slop yok.
Onaydan sonra `hyperframes snapshot` veya ayrı bir kompozisyonla PNG olarak çıkar.

## 8. Storyboard ve onay (videoyu bitirmeden önce zorunlu)

1. Transkript + plan hazır olunca `STORYBOARD.md` yaz (`/hyperframes` →
   `references/storyboard-format.md` formatı; `format: 1080x1920`). Her sahne için:
   zaman aralığı, söylenen cümle, ekrandaki metin, görsel/ikon/animasyon, geçiş, palet rengi.
2. Kompozisyonu kur, `npx hyperframes check` temiz geçsin.
3. Her sahnenin poster karesini `npx hyperframes snapshot --at ...` ile al, tek bir contact
   sheet'te birleştir (sahne no + zaman + kısa açıklama). Instagram güvenli alanlarını ince
   çizgiyle göster.
4. Kullanıcıya gönder (`SendUserFile` ile PNG + storyboard; istenirse Artifact sayfası) ve
   değiştirmek istediği yerleri sor. Düzeltilen transkript kelimelerini de listele.
5. Revizyonları uygula, gerekiyorsa storyboard'u yenile. **Kullanıcı onaylamadan final render
   ve kapak çıkarma.**
6. Final: `npx hyperframes render` → MP4 + kapak PNG, ikisini de `SendUserFile` ile ilet.

## 9. Bitirmeden önce kontrol listesi

- [ ] Tüm metinler Newsreader (lint temiz, fallback serif görünmüyor, Türkçe karakterler doğru)
- [ ] Footage'a hiçbir filtre/treatment/grade uygulanmadı
- [ ] §2 yasak listesinden hiçbir şey yok; metin kullanıcının sözlerinden
- [ ] Altyazı tüm konuşmayı kapsıyor, senkron, güvenli alanda, yüzün üstünde değil
- [ ] Palet log'a yazıldı, önceki 2 videodan farklı
- [ ] Storyboard ve kapak kullanıcı tarafından onaylandı
