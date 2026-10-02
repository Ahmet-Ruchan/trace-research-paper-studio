import { cookies, headers } from "next/headers";
import { UI_LANGUAGE_COOKIE, uiLanguageForHeaders, uiLanguageForRequest, type UiLanguage } from "./languages";
import { messagesFor, type Messages } from "./messages";

/**
 * Sunucuda arayüzün dili. Yerleşim ve meta veriler `next/headers` ile
 * okuyor; rota işleyicileri ellerindeki isteği veriyor
 * (`requestMessages(request)`), böylece kütüphane kodu istek bağlamına
 * bağlanmıyor ve birim testlerinde de çalışıyor.
 */
export async function serverUiLanguage(): Promise<UiLanguage> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const chosen = cookieStore.get(UI_LANGUAGE_COOKIE)?.value;
  return uiLanguageForHeaders(chosen ? `${UI_LANGUAGE_COOKIE}=${chosen}` : undefined, headerList.get("accept-language"));
}

/** Bir API isteğine verilecek yanıtın metinleri, isteği yapanın dilinde. */
export function requestMessages(request: Request): Messages {
  return messagesFor(uiLanguageForRequest(request));
}
