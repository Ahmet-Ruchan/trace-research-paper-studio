"use client";

import { useUiLanguage } from "@/i18n/client";

/**
 * Arayüzün dilini tek tuşla değiştiren düğme: üzerinde geçilecek dilin
 * kısaltması (İngilizcedeyken "TR", Türkçedeyken "EN"). Yeniden yükleme yok;
 * seçim bu cihazda hatırlanıyor.
 */
export function LanguageToggle({ className = "studio-nav-language" }: { className?: string }) {
  const { t, toggle } = useUiLanguage();
  return (
    <button type="button" className={className} aria-label={t.common.switchLanguageAction} title={t.common.switchLanguageAction} onClick={toggle}>
      <span aria-hidden="true">{t.common.switchToOtherShort}</span>
    </button>
  );
}
