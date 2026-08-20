import { VIEWER_TEMPLATE } from "@/generated/viewer-template";
import type { ResearchProject } from "./schema";

/**
 * Bağımsız, tek dosyalık hikâye çıktısı.
 *
 * Eskiden burada 11 görsel gramerinin string-şablon kopyası vardı; React
 * bileşenleriyle ve viewer.html'in vanilla JS kopyasıyla birlikte üç ayrı
 * implementasyon demekti. Artık üçü de aynı derleme artefaktından beslenir
 * (`npm run build:viewer`), dolayısıyla burada yalnızca veri enjeksiyonu var.
 */
export function buildStandaloneStory(project: ResearchProject): string {
  // `<` kaçırılır: aksi hâlde proje metnindeki bir "</script>" dizisi veri
  // bloğunu erken kapatıp içeriği çalıştırılabilir HTML'e dönüştürebilir.
  const serialized = JSON.stringify(project).replaceAll("<", "\\u003c");

  // `replace`e fonksiyon verilir; string sürümü "$&" gibi dizileri desen
  // referansı sanıp projeyi bozardı.
  return VIEWER_TEMPLATE
    .replace("__TRACE_PROJECT_JSON__", () => serialized)
    .replace("__TRACE_VIEW_MODE__", () => "story")
    // Paylaşılabilir çıktı: yerel stüdyo bağlantısı GÖMÜLMEZ. Yazarın
    // localhost adresi başka bir makinede anlamsız, hatta yanıltıcıdır.
    .replace("__TRACE_STUDIO_JSON__", () => "{}");
}
