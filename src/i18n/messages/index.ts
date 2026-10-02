import type { UiLanguage } from "../languages";
import common from "./common";
import focus from "./focus";
import learning from "./learning";
import paper from "./paper";
import server from "./server";
import studio from "./studio";

/**
 * Arayüzün bütün metinleri, iki dilde. Her bölüm kendi dosyasında
 * `{ en, tr }` veriyor; `tr` `typeof en` ile yazıldığı için eksik ya da
 * fazla anahtar derlemede yakalanıyor.
 *
 * Bölümler:
 * - `common`: her yerde geçen kısa kelimeler.
 * - `studio`: kabuk, kütüphane, karşılama, komut paleti, ekip, çevrimdışı.
 * - `paper`: bir makalenin ekranları (Lab, Hikâye, inceleme, yayın, bölüm üretimi).
 * - `focus`: çalışma saati, odak turları, profil, haftalık rapor, çalışma takvimi.
 * - `learning`: tekrar, deneme sınavı, öğrenme sağlığı ve istatistikleri, kavramlar, notlar, okuma listesi.
 * - `server`: API'lerin kullanıcıya yazdığı hatalar ve sunucunun ürettiği sayfalar.
 *
 * Görsellerin metinleri (`src/visuals/i18n.ts`) ayrı: o paket eklentinin
 * bağımsız görüntüleyicisine de giriyor ve bu kaydı içine çekmemeli.
 */
const en = {
  common: common.en,
  studio: studio.en,
  paper: paper.en,
  focus: focus.en,
  learning: learning.en,
  server: server.en,
};

export type Messages = typeof en;

const tr: Messages = {
  common: common.tr,
  studio: studio.tr,
  paper: paper.tr,
  focus: focus.tr,
  learning: learning.tr,
  server: server.tr,
};

const MESSAGES: Record<UiLanguage, Messages> = { en, tr };

export function messagesFor(language: UiLanguage): Messages {
  return MESSAGES[language];
}
