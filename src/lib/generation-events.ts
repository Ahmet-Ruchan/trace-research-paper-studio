export const generationStages = [
  {
    id: "document",
    label: "Belge hazırlama",
    description: "PDF ve yardımcı kaynaklar güvenle hazırlanıyor.",
  },
  {
    id: "evidence",
    label: "Kanıt çıkarma",
    description: "İddialar, metrikler ve sayfa referansları bulunuyor.",
  },
  {
    id: "story",
    label: "Story tasarımı",
    description: "Doğrulanmış kanıtlardan anlatı ve görseller kuruluyor.",
  },
  {
    id: "finalize",
    label: "Son denetim",
    description: "Bütün bağlantılar ve veri şeması kontrol ediliyor.",
  },
] as const;

export type GenerationStageId = (typeof generationStages)[number]["id"];

export type GenerationProgress = {
  stage: GenerationStageId;
  progress: number;
  title: string;
  detail: string;
  attempt?: number;
};

export type GenerationStreamEvent =
  | ({ type: "progress" } & GenerationProgress)
  | { type: "result"; project: unknown; warnings: string[] }
  | { type: "error"; error: string; detail?: unknown };

export const initialGenerationProgress: GenerationProgress = {
  stage: "document",
  progress: 4,
  title: "Paper gönderiliyor.",
  detail: "API key yalnızca bu istek boyunca bellekte tutuluyor.",
};

export function isGenerationStreamEvent(value: unknown): value is GenerationStreamEvent {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === "progress" || type === "result" || type === "error";
}
