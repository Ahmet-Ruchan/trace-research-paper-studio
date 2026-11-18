# Paletler

Ruh: gazete kâğıdı, gece mavisi, orman & toprak gibi — doğal, editoryal, sakin, birbiriyle
uyumlu. Apple / Anthropic / OpenAI videolarındaki gibi sade ve etkili. Her videoda farklı biri
seçilir (kullanılanlar: `reels/PALETTE_LOG.md`).

## Yeni palet üretme kuralları

- 6 renk: `bg`, `surface` (kart/zemin bloğu, bg'den bir ton farklı), `text`, `muted`,
  `accent` (tek ana vurgu), `accent2` (grafiklerde ikinci seri, az kullanılır).
- Doğadan / basılı malzemeden gelen tonlar: kâğıt, mürekkep, taş, toprak, bitki, gece göğü.
  Saf `#000`/`#FFF` yerine hafif kırık tonlar.
- Doygunluğu düşük-orta; neon, mor-pembe-mavi gradyan, "siber" turkuaz-magenta yok.
- Gradyan kullanılmaz; düz renk alanları.
- Kontrast: `text`/`bg` ≥ 7:1, `muted`/`bg` ≥ 4.5:1, `accent`/`bg` ≥ 3:1 (grafik ve büyük metin).
- Vurgu rengi ekranın küçük bir kısmında: bir kelime, bir çizgi, bir ikon.

## Hazır paletler

| Ad | bg | surface | text | muted | accent | accent2 | His |
|---|---|---|---|---|---|---|---|
| Gazete kâğıdı | `#F4EFE6` | `#E8E1D4` | `#1A1A1A` | `#6F675C` | `#B23A2B` | `#2F4A6B` | editoryal, dergi, sıcak-ciddi |
| Gece mavisi | `#0F1B2D` | `#18273D` | `#EDE6DA` | `#8C99AD` | `#D9A441` | `#7FA7C9` | sakin, güvenilir, belgesel |
| Orman & toprak | `#1F3A2E` | `#284838` | `#F2EDE3` | `#A9B79D` | `#D9774A` | `#E3C988` | doğal, samimi |
| Laboratuvar | `#F5F5F2` | `#E7E8E4` | `#16181B` | `#666B70` | `#2353C9` | `#C2412D` | bilimsel, temiz, makale |
| Grafit & kehribar | `#1C1C1E` | `#2A2A2D` | `#F2F0EB` | `#9A978F` | `#E0A43A` | `#8FB3A3` | ürün lansmanı, sinematik |
| Kum & zeytin | `#EDE4D3` | `#E0D4BE` | `#22201B` | `#6E6656` | `#5E6B2E` | `#A4532E` | sakin, düşünsel, tarih |
| Bordo arşiv | `#3A1418` | `#4A1E23` | `#F3E9DC` | `#C2A9A0` | `#D8B26E` | `#9FB8C4` | akademik, arşiv, klasik makale |
| Kâğıt & ultramarin | `#FBF8F1` | `#EFEAE0` | `#141414` | `#6B6760` | `#2A3FBF` | `#A86A0E` | öğretici, ders notu |
| Kömür & yosun | `#151915` | `#212721` | `#ECEDE6` | `#8E968A` | `#9DBF6A` | `#D9C8A0` | terminal, kodlama, sakin teknik |
| Arduvaz & mercan | `#2B3138` | `#363E47` | `#F1EEE9` | `#A3AAB2` | `#E8735A` | `#9CC5C0` | teknoloji haberi, modern |
| Keten & lacivert | `#EFE9DF` | `#E3DBCD` | `#1B2233` | `#676A72` | `#1F3A68` | `#B5562F` | kurumsal-sıcak, araştırma özeti |
| Gece yarısı & nane | `#101418` | `#1A2027` | `#E9EEF0` | `#8A949C` | `#6FCFB4` | `#E6B85C` | ML/derin öğrenme, veri |

Tümünün kontrastı kontrol edildi (yazı ≥ 10:1, muted ≥ 4.5:1, vurgu ≥ 3.9:1).
