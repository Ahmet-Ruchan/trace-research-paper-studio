"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  otherUiLanguage,
  UI_LANGUAGE_COOKIE,
  UI_LANGUAGE_COOKIE_MAX_AGE,
  uiLanguageFromCookieHeader,
  type UiLanguage,
} from "./languages";
import { messagesFor, type Messages } from "./messages";

/**
 * Arayüzün dili istemcide: `useT()` metinleri, `useUiLanguage()` dili ve
 * değiştirmeyi veriyor.
 *
 * Sunucu ilk çizimi çerezdeki (yoksa tarayıcının) dille yapıyor ve
 * `initial` olarak buraya veriyor; hidrasyon aynı dille başlıyor, ekranda
 * dil bir an bile değişmiyor. Çevrimdışıyken saklanan sayfa başka bir dilde
 * çizilmiş olabilir: hidrasyondan hemen sonra çerez okunup düzeltiliyor
 * (`useSyncExternalStore`, sunucu görüntüsü `initial`).
 *
 * Değiştirmek yeniden yükleme istemiyor: çerez yazılıyor, bütün ekran yeni
 * dille yeniden çiziliyor, açık olan diğer sekmeler de (`BroadcastChannel`)
 * kendiliğinden geçiyor.
 */

type UiLanguageValue = {
  language: UiLanguage;
  t: Messages;
  setLanguage: (language: UiLanguage) => void;
  toggle: () => void;
};

const UiLanguageContext = createContext<UiLanguageValue>({
  language: "en",
  t: messagesFor("en"),
  setLanguage: () => undefined,
  toggle: () => undefined,
});

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Diğer sekmelere haber; kanal kendi gönderdiğini almıyor. */
let channel: BroadcastChannel | undefined;
function tabs() {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("trace-ui-language");
    channel.onmessage = notify;
  }
  return channel;
}

function subscribe(listener: () => void) {
  tabs();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function chosenLanguage(): UiLanguage | undefined {
  return uiLanguageFromCookieHeader(document.cookie);
}

/** Seçimi bu cihaza yazıyor; proje dosyalarına değil. */
export function rememberUiLanguage(language: UiLanguage) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${UI_LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${UI_LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  notify();
  tabs()?.postMessage(language);
}

export function UiLanguageProvider({ initial, children }: { initial: UiLanguage; children: ReactNode }) {
  const language = useSyncExternalStore(subscribe, () => chosenLanguage() ?? initial, () => initial);
  const setLanguage = useCallback((next: UiLanguage) => rememberUiLanguage(next), []);
  const toggle = useCallback(() => rememberUiLanguage(otherUiLanguage(language)), [language]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(() => ({ language, t: messagesFor(language), setLanguage, toggle }), [language, setLanguage, toggle]);
  return <UiLanguageContext.Provider value={value}>{children}</UiLanguageContext.Provider>;
}

/** Arayüzün metinleri, seçili dilde: `const t = useT(); t.common.save`. */
export function useT(): Messages {
  return useContext(UiLanguageContext).t;
}

/** Seçili dil ve değiştirmek için. */
export function useUiLanguage(): UiLanguageValue {
  return useContext(UiLanguageContext);
}
