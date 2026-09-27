import type { Misreading } from "./schema";

/**
 * Yanlış okuma türlerinin okuyucuya söylenişi. Arayüz, rapor ve Anki aynı
 * adları kullanıyor: bir tür, okuyucuya hangi ayrımı kaçırdığını söylüyor.
 */
export const misreadingTrapLabels: Record<Misreading["trap"], string> = {
  "interpretation-as-result": "An interpretation read as a result",
  "beyond-tested": "Beyond what was tested",
  number: "A misread number",
  mechanism: "How the method works",
};
