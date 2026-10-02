/**
 * Arayüzün dili: İngilizce ya da Türkçe, tek tuşla değişiyor.
 *
 * Bu dosya bilerek sözlük içermiyor: vekil (`proxy.ts`), rota işleyicileri ve
 * yerleşim yalnızca hangi dilin seçildiğini soruyor; metinler
 * `messages/` altında.
 *
 * Seçim bu cihazda bir çerezde (`trace_ui_language`) duruyor, proje
 * dosyalarına hiç yazılmıyor: aynı stüdyoyu açan iki kişi kendi dilini
 * görüyor. Çerez yoksa tarayıcının dil sırası (`Accept-Language`,
 * `navigator.languages`) bakılıyor: Türkçe İngilizceden önce geliyorsa Türkçe,
 * yoksa İngilizce.
 *
 * Analizin dili ayrı: makale, ajana yazılan dilde geliyor
 * (`preferred-language.ts`); arayüzü değiştirmek onu çevirmiyor.
 */

export const UI_LANGUAGES = ["en", "tr"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";
export const UI_LANGUAGE_COOKIE = "trace_ui_language";
/** Bir yıl; seçim her değişimde tazeleniyor. */
export const UI_LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && (UI_LANGUAGES as readonly string[]).includes(value);
}

/** "tr", "tr-TR", "TR" → "tr"; desteklenmeyen ya da bozuk etiket `undefined`. */
export function uiLanguageOf(tag: string | null | undefined): UiLanguage | undefined {
  const base = tag?.trim().toLowerCase().split(/[-_]/)[0];
  return isUiLanguage(base) ? base : undefined;
}

/**
 * Tarayıcının dil sırasında desteklenen ilk dil. `q` ağırlıkları sıraya
 * çevriliyor; eşit ağırlıkta yazıldığı sıra korunuyor (`Array.sort` kararlı).
 */
export function uiLanguageFromPreferences(preferences: readonly string[] | string | null | undefined): UiLanguage {
  if (!preferences) return DEFAULT_UI_LANGUAGE;
  if (typeof preferences !== "string") {
    for (const tag of preferences) {
      const language = uiLanguageOf(tag);
      if (language) return language;
    }
    return DEFAULT_UI_LANGUAGE;
  }
  const ranked = preferences
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const q = parameters.map((parameter) => parameter.trim()).find((parameter) => parameter.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  return uiLanguageFromPreferences(ranked.map((entry) => entry.tag));
}

/** `Cookie` başlığından seçilmiş dil; seçim yoksa `undefined`. */
export function uiLanguageFromCookieHeader(header: string | null | undefined): UiLanguage | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === UI_LANGUAGE_COOKIE) {
      const chosen = value.join("=").trim();
      return isUiLanguage(chosen) ? chosen : undefined;
    }
  }
  return undefined;
}

/** Bir isteğin dili: önce seçilen (çerez), yoksa tarayıcının dil sırası. */
export function uiLanguageForHeaders(cookie: string | null | undefined, acceptLanguage: string | null | undefined): UiLanguage {
  return uiLanguageFromCookieHeader(cookie) ?? uiLanguageFromPreferences(acceptLanguage);
}

/** Rota işleyicilerinde: `uiLanguageForRequest(request)`. */
export function uiLanguageForRequest(request: Request): UiLanguage {
  return uiLanguageForHeaders(request.headers.get("cookie"), request.headers.get("accept-language"));
}

/** Tarih, saat ve sayı biçimlemesi için `Intl` etiketi ("en" ya da "tr"). */
export function uiLocale(language: UiLanguage): string {
  return language;
}

/** Diğer dil: düğme tek tuşla buna geçiyor. */
export function otherUiLanguage(language: UiLanguage): UiLanguage {
  return language === "tr" ? "en" : "tr";
}
