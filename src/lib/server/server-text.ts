import { messagesFor, type Messages } from "@/i18n/messages";
import { requestMessages } from "@/i18n/server";

/**
 * Rotanın kullanıcıya yazdığı metinler, isteği yapanın dilinde (çerez, yoksa
 * `Accept-Language`). İstek verilmezse İngilizce: bazı `GET` işleyicileri
 * testlerde isteksiz çağrılıyor.
 */
export function routeMessages(request?: Request): Messages {
  return request ? requestMessages(request) : messagesFor("en");
}

/** Yalnızca `server` bölümü: rotaların çoğu yalnızca onu kullanıyor. */
export function serverText(request?: Request): Messages["server"] {
  return routeMessages(request).server;
}
