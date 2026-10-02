import { describe, expect, it } from "vitest";
import {
  otherUiLanguage,
  uiLanguageForHeaders,
  uiLanguageForRequest,
  uiLanguageFromCookieHeader,
  uiLanguageFromPreferences,
  uiLanguageOf,
} from "./languages";
import { messagesFor } from "./messages";

describe("arayüz dilinin seçimi", () => {
  it("etiketi taban dile indiriyor, desteklenmeyeni bırakıyor", () => {
    expect(uiLanguageOf("tr-TR")).toBe("tr");
    expect(uiLanguageOf("TR")).toBe("tr");
    expect(uiLanguageOf("en_GB")).toBe("en");
    expect(uiLanguageOf("de")).toBeUndefined();
    expect(uiLanguageOf("")).toBeUndefined();
    expect(uiLanguageOf(undefined)).toBeUndefined();
  });

  it("tarayıcının sırasında desteklenen ilk dili alıyor", () => {
    expect(uiLanguageFromPreferences("tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("tr");
    expect(uiLanguageFromPreferences("en-US,en;q=0.9,tr;q=0.8")).toBe("en");
    // Almanca önde ama desteklenmiyor: sıradaki Türkçe.
    expect(uiLanguageFromPreferences("de-DE,de;q=0.9,tr;q=0.8,en;q=0.5")).toBe("tr");
    // Ağırlık yazılış sırasından önemli.
    expect(uiLanguageFromPreferences("en;q=0.4,tr;q=0.9")).toBe("tr");
    // q=0 "istemiyorum" demek.
    expect(uiLanguageFromPreferences("tr;q=0,en;q=0.1")).toBe("en");
    expect(uiLanguageFromPreferences(["fr-FR", "tr", "en"])).toBe("tr");
  });

  it("hiçbir işaret yoksa İngilizce", () => {
    expect(uiLanguageFromPreferences(undefined)).toBe("en");
    expect(uiLanguageFromPreferences("")).toBe("en");
    expect(uiLanguageFromPreferences("de,fr;q=0.8")).toBe("en");
    expect(uiLanguageFromPreferences("*")).toBe("en");
  });

  it("seçilmiş dil (çerez) tarayıcının dilinden önce geliyor", () => {
    expect(uiLanguageFromCookieHeader("a=1; trace_ui_language=tr; b=2")).toBe("tr");
    expect(uiLanguageFromCookieHeader("trace_ui_language=de")).toBeUndefined();
    expect(uiLanguageFromCookieHeader("trace_ui_languages=tr")).toBeUndefined();
    expect(uiLanguageForHeaders("trace_ui_language=en", "tr-TR,tr")).toBe("en");
    expect(uiLanguageForHeaders("trace_ui_language=tr", "en-US")).toBe("tr");
    expect(uiLanguageForHeaders(undefined, "tr-TR")).toBe("tr");
    expect(uiLanguageForHeaders("trace_ui_language=xx", "en-US")).toBe("en");
  });

  it("bir isteğin dilini başlıklarından okuyor", () => {
    expect(uiLanguageForRequest(new Request("http://localhost/api", { headers: { cookie: "trace_ui_language=tr" } }))).toBe("tr");
    expect(uiLanguageForRequest(new Request("http://localhost/api", { headers: { "accept-language": "tr" } }))).toBe("tr");
    expect(uiLanguageForRequest(new Request("http://localhost/api"))).toBe("en");
  });

  it("düğme tek tuşla diğer dile geçiyor", () => {
    expect(otherUiLanguage("en")).toBe("tr");
    expect(otherUiLanguage("tr")).toBe("en");
    expect(messagesFor("en").common.switchToOtherShort).toBe("TR");
    expect(messagesFor("tr").common.switchToOtherShort).toBe("EN");
  });
});
