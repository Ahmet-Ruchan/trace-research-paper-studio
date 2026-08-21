import { preferredLanguage } from "./preferred-language";
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

/**
 * Örnek, kullanıcının diline en yakın sürümde açılır.
 *
 * Trace her dilde çıktı üretebiliyor ama PAKETLİ örnek yalnızca iki dilde
 * var — 150 KB'lık bir dosyayı her dil için taşımanın anlamı yok. Türkçe
 * konuşan Türkçe kopyayı, herkes İngilizce kopyayı görür.
 */
export function sampleProjectUrl(language?: string) {
  const tag = preferredLanguage(language).toLowerCase();
  return tag === "tr" || tag.startsWith("tr-") ? SAMPLE_PROJECT_FILES.tr : SAMPLE_PROJECT_FILES.en;
}

export async function loadSampleProject(language?: string): Promise<ResearchProject> {
  const response = await fetch(sampleProjectUrl(language), { cache: "force-cache" });
  if (!response.ok) throw new Error(`The example project could not be loaded (HTTP ${response.status}).`);
  return researchProjectSchema.parse(await response.json());
}
