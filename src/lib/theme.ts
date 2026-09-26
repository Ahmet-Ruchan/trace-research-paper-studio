/**
 * Stüdyonun renk teması.
 *
 * Varsayılan açık tema: şimdiye kadarki görünüm ve kâğıda en yakın okuma
 * deneyimi. "Dark" her zaman karanlık, "System" işletim sisteminin tercihini
 * izliyor. Değerler `tokens.css` içinde; burada yalnızca kök öğedeki
 * `data-theme` yazılıyor.
 *
 * Bağımsız görüntüleyici ve yayımlanan sayfalar bu özniteliği taşımıyor:
 * paylaşılan bir hikâye, gönderenin tercihine göre değil, her okuyucuda aynı
 * görünüyor.
 */
export const themes = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
] as const;

export type Theme = (typeof themes)[number]["id"];

export const THEME_KEY = "trace-theme";
export const THEME_ATTRIBUTE = "data-theme";

export function parseTheme(value: unknown): Theme {
  return themes.some((theme) => theme.id === value) ? (value as Theme) : "light";
}

/** Sayfa çizilmeden önce: karanlık temada her açılışta beyaz bir parlama olmasın. */
export const themeBootScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(
  themes.filter((theme) => theme.id !== "light").map((theme) => theme.id),
)}.indexOf(t)>-1)document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t)}catch(e){}`;

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return parseTheme(document.documentElement.getAttribute(THEME_ATTRIBUTE) ?? "light");
}

function showTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") root.removeAttribute(THEME_ATTRIBUTE);
  else root.setAttribute(THEME_ATTRIBUTE, theme);
}

/** Kayıtlı temayı kök öğeye yeniden yazar; `restoreTextSize` ile aynı neden. */
export function restoreTheme() {
  try {
    showTheme(parseTheme(window.localStorage.getItem(THEME_KEY)));
  } catch {
    // Depolama kapalı: açık tema.
  }
}

export function applyTheme(theme: Theme) {
  showTheme(theme);
  try {
    if (theme === "light") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Depolama kapalı: seçim bu sayfada kalır.
  }
}
