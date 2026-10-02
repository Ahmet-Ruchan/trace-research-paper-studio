"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { stringsFor, type ChromeLanguage, type Strings } from "./i18n";

/**
 * Paylaşılan bileşenler projenin dilini (ve stüdyoda arayüzün dilini) prop
 * zinciriyle taşımak yerine buradan okur. Sağlayıcı yoksa İngilizce.
 *
 * `ui` verilmezse etiketler içeriğin dilinden çıkıyor (`stringsFor`):
 * bağımsız görüntüleyici ve yayımlanmış hikâye böyle. Stüdyo okuyucunun
 * seçtiği dili veriyor.
 */
const LanguageContext = createContext<Strings>(stringsFor(undefined, "en"));

export function LanguageProvider({
  language,
  ui,
  children,
}: {
  language: string | undefined;
  ui?: ChromeLanguage;
  children: ReactNode;
}) {
  const value = useMemo(() => stringsFor(language, ui), [language, ui]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useStrings(): Strings {
  return useContext(LanguageContext);
}
