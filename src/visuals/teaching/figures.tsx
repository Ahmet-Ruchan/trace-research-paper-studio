import { useState } from "react";
import { useStrings } from "../language-context";
import type { Figure } from "@/lib/schema";

/**
 * Makalenin kendi şekilleri.
 *
 * Trace'in geri kalanı makaleyi YENİDEN çiziyor — architecture, matrix,
 * equation dilbilgileri yazarların anlattığını Trace'in diliyle anlatıyor.
 * Bu bileşen tersini yapıyor: bazı şekiller yeniden çizilemez, çünkü ikonik
 * olan şeklin ta kendisidir.
 *
 * Görsel her zaman gömülü bir data URI. Uzak adres yok: bağımsız görüntüleyici
 * `default-src 'none'` ile çalışıyor, yani uzaktaki bir görsel zaten yüklenmez
 * — ve dosya paylaşıldığında kaynağına bağımlı kalmamalı.
 */
export function FiguresView({ figures }: { figures: readonly Figure[] }) {
  const t = useStrings();
  if (!figures.length) return null;

  return (
    <section className="figures" aria-label={t.figuresHeading}>
      {figures.map((figure) => (
        <FigureCard key={figure.id} figure={figure} />
      ))}
    </section>
  );
}

/**
 * Şekilleri hikâye bölümlerine dağıtır.
 *
 * Birleştirme anahtarı zaten veride: şekiller de bölümler de `claimIds`
 * taşıyor. Yani bir şeklin hangi paragrafa ait olduğunu tahmin etmiyoruz —
 * ikisi de aynı iddiaya dayanıyorsa aynı yere aittirler.
 *
 * Bir şekil EN FAZLA bir kez yerleşir: iddiaların birden çok bölümde geçmesi
 * olağan ve aynı diyagramı üç kez basmak okumayı bozar. İlk eşleşen bölüm
 * kazanır, çünkü bölümler anlatı sırasında ve şekil ilk anlatıldığı yerde
 * en çok işe yarar.
 */
export function figuresBySection(
  figures: readonly Figure[] | undefined,
  sections: readonly { id: string; claimIds: readonly string[] }[],
): Map<string, Figure[]> {
  const placed = new Map<string, Figure[]>();
  if (!figures?.length) return placed;
  const taken = new Set<string>();

  for (const section of sections) {
    const claims = new Set(section.claimIds);
    const mine = figures.filter(
      (figure) => !taken.has(figure.id) && figure.claimIds.some((id) => claims.has(id)),
    );
    if (!mine.length) continue;
    for (const figure of mine) taken.add(figure.id);
    placed.set(section.id, mine);
  }

  return placed;
}

function FigureCard({ figure }: { figure: Figure }) {
  const t = useStrings();
  // Şekiller uzun olabiliyor (ResNet'in ağ diyagramı sayfa boyu). Varsayılan
  // yükseklik sınırlı; okuyucu isterse tam boyuta açıyor.
  const [expanded, setExpanded] = useState(false);

  return (
    <figure className={expanded ? "figure-card is-expanded" : "figure-card"}>
      <div className="figure-frame">
        {/*
          `loading="lazy"` YOK, bilerek. Görsel gömülü bir data URI — baytlar
          sayfayla birlikte zaten indirildi, yani ertelemenin kazandıracağı
          hiçbir istek yok. Üstelik zararlı: boyut bilgisi olmayan bir img
          yüklenene kadar 0×0 oluyor, 0×0 kutu da görüş alanına hiç girmiyor,
          dolayısıyla görsel hiç yüklenmiyordu.
        */}
        <img src={figure.image} alt={figure.caption} onClick={() => setExpanded(!expanded)} />
        <button type="button" className="figure-zoom" onClick={() => setExpanded(!expanded)}>
          {expanded ? t.figureCollapse : t.figureExpand}
        </button>
      </div>
      <figcaption>
        <p className="figure-why">{figure.whyItMatters}</p>
        <p className="figure-caption">
          <span className="figure-label">{figure.label}</span>
          {figure.caption}
        </p>
        <span className="figure-source">{t.figureFromPaper(figure.page)}</span>
      </figcaption>
    </figure>
  );
}
