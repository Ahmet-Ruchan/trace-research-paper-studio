import { z } from "zod";

/**
 * Çalışma saatinin renkleri.
 *
 * Stüdyonun makale renk paletinden (`TRACE_ACCENT_PALETTE`) on bir ton:
 * zamanlayıcılar, alarmlar ve profildeki çalışma takvimi bunlardan birini
 * seçiyor. Renk dolgu olarak kullanılıyor (halka, takvim kareleri, düğme);
 * üstündeki yazının rengi kodla seçiliyor: beyaz ya da koyu, hangisi dolguyla
 * daha çok ayrışıyorsa. Rengin yazı olarak kullanılan tonu CSS'te temaya göre
 * türetiliyor (`--focus-ink`, bkz. `focus.css`).
 */

export const FOCUS_COLORS = [
  { id: "yellow", label: "Yellow", hex: "#FACC15" },
  { id: "blue", label: "Blue", hex: "#2563EB" },
  { id: "red", label: "Red", hex: "#EF4444" },
  { id: "green", label: "Green", hex: "#22C55E" },
  { id: "orange", label: "Orange", hex: "#F97316" },
  { id: "purple", label: "Purple", hex: "#7C3AED" },
  { id: "lilac", label: "Lilac", hex: "#A78BFA" },
  { id: "sky", label: "Light blue", hex: "#38BDF8" },
  { id: "navy", label: "Navy", hex: "#1E3A8A" },
  { id: "burgundy", label: "Burgundy", hex: "#9F1239" },
  { id: "pink", label: "Pink", hex: "#EC4899" },
] as const;

export type FocusColorId = (typeof FOCUS_COLORS)[number]["id"];
export const FOCUS_COLOR_IDS = FOCUS_COLORS.map((color) => color.id) as [FocusColorId, ...FocusColorId[]];
export const focusColorSchema = z.enum(FOCUS_COLOR_IDS);

/** Dolgu üstündeki iki aday yazı rengi: tokens.css'teki --on-ink değerleri. */
export const LIGHT_TEXT = "#ffffff";
export const DARK_TEXT = "#161714";

export function luminance(hex: string) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.replace(/./g, "$&$&") : value;
  return [0, 2, 4]
    .map((start) => Number.parseInt(full.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

export function contrast(one: string, other: string) {
  const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

/** Dolgunun üstünde okunan yazı: beyaz ya da koyu, hangisi daha çok ayrışıyorsa. */
export function textOn(hex: string) {
  return contrast(hex, LIGHT_TEXT) >= contrast(hex, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

const toHex = (channels: number[]) => `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * Üstünde yazı taşıyan dolgu. Kırmızı gibi orta tonlarda ne beyaz ne koyu
 * yazı 4,5:1'e ulaşıyor (#EF4444: 4,28:1); ton, beyaz yazı okunana kadar
 * adım adım koyulaştırılıyor. Rengin kendisi halkada ve takvimde olduğu gibi
 * kalıyor.
 */
export function textSafeFill(hex: string) {
  if (Math.max(contrast(hex, LIGHT_TEXT), contrast(hex, DARK_TEXT)) >= 4.5) return hex.toUpperCase();
  const channels = [0, 2, 4].map((start) => Number.parseInt(hex.replace("#", "").slice(start, start + 2), 16));
  for (let step = 1; step <= 20; step += 1) {
    const darker = toHex(channels.map((value) => value * (1 - step * 0.04)));
    if (contrast(darker, LIGHT_TEXT) >= 4.5) return darker;
  }
  return "#000000";
}

export type FocusColor = { id: FocusColorId; label: string; hex: string; fill: string; on: string };

export function focusColor(id: string | undefined, fallback: FocusColorId = "blue"): FocusColor {
  const color = FOCUS_COLORS.find((item) => item.id === id) ?? FOCUS_COLORS.find((item) => item.id === fallback)!;
  const fill = textSafeFill(color.hex);
  return { ...color, fill, on: textOn(fill) };
}

/**
 * Bir kapsayıcıya verilen CSS değişkenleri: `--focus` rengin kendisi (halka,
 * takvim), `--focus-fill` yazı taşıyan dolgu, `--on-focus` onun üstündeki yazı.
 */
export function focusColorStyle(id: string | undefined, fallback?: FocusColorId) {
  const color = focusColor(id, fallback);
  return { "--focus": color.hex, "--focus-fill": color.fill, "--on-focus": color.on } as Record<string, string>;
}
