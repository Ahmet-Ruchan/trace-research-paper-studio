/**
 * Stüdyonun yazı boyutu seçimi.
 *
 * Yazı ölçeği rem olduğu için (`tokens.css`) kökün yazı boyutunu değiştirmek
 * bütün metni birlikte büyütüyor. Değer yüzde: tarayıcının kendi yazı boyutu
 * tercihinin üstüne çarpılıyor, onun yerine geçmiyor.
 *
 * Seçim bu tarayıcıya ait bir kolaylık, projeye ya da kütüphaneye yazılmıyor.
 */
export const textSizes = [
  { id: "compact", label: "Compact", percent: 93.75 },
  { id: "default", label: "Default", percent: 100 },
  { id: "large", label: "Large", percent: 112.5 },
  { id: "larger", label: "Larger", percent: 125 },
] as const;

export type TextSize = (typeof textSizes)[number]["id"];

export const TEXT_SIZE_KEY = "trace-text-size";
export const TEXT_SIZE_ATTRIBUTE = "data-text-size";

/** Bilinmeyen ya da bozuk bir kayıt varsayılana döner. */
export function parseTextSize(value: unknown): TextSize {
  return textSizes.some((size) => size.id === value) ? (value as TextSize) : "default";
}

/**
 * Sayfa çizilmeden önce çalışan satır içi betik. Seçim React yüklenene kadar
 * beklerse sayfa önce varsayılan boyutta görünüp sonra büyüyordu. Betik
 * yalnızca bilinen değerleri yazıyor; depolama kapalıysa sessizce varsayılanda
 * kalıyor.
 */
export const textSizeBootScript = `try{var v=localStorage.getItem(${JSON.stringify(TEXT_SIZE_KEY)});if(${JSON.stringify(
  textSizes.filter((size) => size.id !== "default").map((size) => size.id),
)}.indexOf(v)>-1)document.documentElement.setAttribute(${JSON.stringify(TEXT_SIZE_ATTRIBUTE)},v)}catch(e){}`;

export function currentTextSize(): TextSize {
  if (typeof document === "undefined") return "default";
  return parseTextSize(document.documentElement.getAttribute(TEXT_SIZE_ATTRIBUTE) ?? "default");
}

export function applyTextSize(size: TextSize) {
  const root = document.documentElement;
  if (size === "default") root.removeAttribute(TEXT_SIZE_ATTRIBUTE);
  else root.setAttribute(TEXT_SIZE_ATTRIBUTE, size);
  try {
    if (size === "default") window.localStorage.removeItem(TEXT_SIZE_KEY);
    else window.localStorage.setItem(TEXT_SIZE_KEY, size);
  } catch {
    // Depolama kapalı (gizli pencere, engellenmiş site verisi): seçim bu sayfada kalır.
  }
}
