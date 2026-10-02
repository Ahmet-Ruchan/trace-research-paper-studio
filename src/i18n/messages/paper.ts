import evidence from "./paper/evidence";
import lab from "./paper/lab";
import records from "./paper/records";
import regeneration from "./paper/regeneration";
import shared from "./paper/shared";
import sharing from "./paper/sharing";

/**
 * `paper` bölümü: bir makalenin ekranları (Lab, Hikâye, inceleme, yayın,
 * bölüm üretimi, karşılaştırma, model karnesi). Bölüm büyük olduğu için
 * `paper/` altındaki dosyalara bölündü; burada tek nesnede birleşiyor.
 *
 * Bazı İngilizce metinler bir `src/lib` modülünün kendi varsayılanı
 * (`REVISION_WORDS`, `EXPORT_MENU_WORDS` gibi): o modüller eklentinin
 * paketine de giriyor ve buraya bağlanamıyor; Türkçesi aynı tiple burada.
 */
const en = {
  ...shared.en,
  ...lab.en,
  ...regeneration.en,
  ...sharing.en,
  ...evidence.en,
  ...records.en,
};

const tr: typeof en = {
  ...shared.tr,
  ...lab.tr,
  ...regeneration.tr,
  ...sharing.tr,
  ...evidence.tr,
  ...records.tr,
};

const paper = { en, tr };

export default paper;
