import { researchProjectSchema, type ResearchProject } from "./schema";

/**
 * Yerleşik örnek artık elle yazılmış bir kısaltma DEĞİL: plugin'in ürettiği
 * amiral gemisi projenin ta kendisi. Aynı dosya testlerde, README ekran
 * görüntülerinde ve bağımsız görüntüleyicide kullanılıyor; böylece "örneği aç"
 * diyen kullanıcı ürünün en güncel halini görüyor, minyatür bir taklidini değil.
 *
 * Statik `import` yerine `fetch`: dosya 150 KB ve kullanıcıların çoğu örneği
 * hiç açmıyor. Bu yolla ana paketten tamamen çıkıyor ve `public/` altındaki
 * kanonik kopya indirilebilir bir URL olarak da işe yarıyor.
 */
export const SAMPLE_PROJECT_FILES = {
  tr: "/examples/attention-is-all-you-need.trace.json",
  en: "/examples/attention-is-all-you-need.en.trace.json",
} as const;

/** Tarayıcı dili Türkçe değilse örnek İngilizce açılır. */
export function sampleProjectUrl(language?: string) {
  const preferred = (language ?? (typeof navigator === "undefined" ? "tr" : navigator.language)) || "tr";
  return preferred.toLowerCase().startsWith("tr") ? SAMPLE_PROJECT_FILES.tr : SAMPLE_PROJECT_FILES.en;
}

export async function loadSampleProject(language?: string): Promise<ResearchProject> {
  const response = await fetch(sampleProjectUrl(language), { cache: "force-cache" });
  if (!response.ok) throw new Error(`Örnek proje yüklenemedi (HTTP ${response.status}).`);
  return researchProjectSchema.parse(await response.json());
}
