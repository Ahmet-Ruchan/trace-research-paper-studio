import { uiLanguageOf } from "@/i18n/languages";
import { messagesFor, type Messages } from "@/i18n/messages";

/**
 * React dışındaki tarayıcı kodu (ör. `project-library.ts`) için arayüzün
 * metinleri: sağlayıcının `<html lang>`e yazdığı dil, yani ekranda görünen.
 * Sunucuda ve testlerde İngilizce.
 */
export function browserMessages(): Messages {
  const language = typeof document === "undefined" ? undefined : uiLanguageOf(document.documentElement.lang);
  return messagesFor(language ?? "en");
}
