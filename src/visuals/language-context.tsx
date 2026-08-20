"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { stringsFor, type Strings } from "./i18n";

/**
 * Paylaşılan bileşenler projenin dilini prop zinciriyle taşımak yerine
 * buradan okur. Sağlayıcı yoksa Türkçeye düşer, böylece bu bağlamı henüz
 * kurmamış bir çağrı yeri kırılmaz.
 */
const LanguageContext = createContext<Strings>(stringsFor("tr"));

export function LanguageProvider({
  language,
  children,
}: {
  language: string | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => stringsFor(language), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useStrings(): Strings {
  return useContext(LanguageContext);
}
