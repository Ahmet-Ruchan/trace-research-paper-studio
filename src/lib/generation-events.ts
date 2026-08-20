export const generationStages = [
  {
    id: "document",
    label: "Document preparation",
    description: "Preparing the PDF and supporting sources safely.",
  },
  {
    id: "evidence",
    label: "Evidence extraction",
    description: "Locating claims, metrics and page references.",
  },
  {
    id: "story",
    label: "Specialist outputs",
    description: "Visual story, deep report and technical appendix built by the assigned models.",
  },
  {
    id: "finalize",
    label: "Son denetim",
    description: "Checking every link and the data schema.",
  },
] as const;

export type GenerationStageId = (typeof generationStages)[number]["id"];

export type GenerationProgress = {
  stage: GenerationStageId;
  progress: number;
  title: string;
  detail: string;
  attempt?: number;
  activityAt?: string;
  heartbeat?: boolean;
};

export type GenerationStreamEvent =
  | ({ type: "progress" } & GenerationProgress)
  | { type: "checkpoint"; checkpoint: unknown; completed: string[] }
  | { type: "result"; project: unknown; warnings: string[] }
  | { type: "error"; error: string; detail?: unknown };

export const initialGenerationProgress: GenerationProgress = {
  stage: "document",
  progress: 4,
  title: "Sending the paper.",
  detail: "The API key stays in memory for this request only.",
};

export function isGenerationStreamEvent(value: unknown): value is GenerationStreamEvent {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === "progress" || type === "checkpoint" || type === "result" || type === "error";
}
