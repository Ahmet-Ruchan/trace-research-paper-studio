import library from "./studio/library";
import models from "./studio/models";
import onboarding from "./studio/onboarding";
import palette from "./studio/palette";
import shell from "./studio/shell";
import team from "./studio/team";
import templates from "./studio/templates";

/**
 * Stüdyonun kabuğu: kütüphane, karşılama, komut paleti, ekip, çevrimdışı,
 * şablonlar ve model ayarları. Gruplar `studio/` altındaki dosyalarda; her
 * biri `{ en, tr }` veriyor.
 */
const en = {
  documentTitle: "Trace — Evidence-first research studio",
  documentDescription: "Turn research papers into verifiable, interactive web narratives.",
  ...shell.en,
  library: library.en,
  onboarding: onboarding.en,
  commandPalette: palette.en,
  team: team.en,
  models: models.en,
  templates: templates.en,
};

const tr: typeof en = {
  documentTitle: "Trace — Kanıta dayalı araştırma stüdyosu",
  documentDescription: "Araştırma makalelerini doğrulanabilir, etkileşimli web anlatılarına dönüştür.",
  ...shell.tr,
  library: library.tr,
  onboarding: onboarding.tr,
  commandPalette: palette.tr,
  team: team.tr,
  models: models.tr,
  templates: templates.tr,
};

const studio = { en, tr };

export default studio;
