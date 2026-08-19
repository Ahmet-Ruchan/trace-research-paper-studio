export type ProviderId = "gemini" | "openai" | "anthropic" | "openrouter";

export type GenerationTaskRole = "evidence" | "technical" | "report" | "visual";

export type ModelAssignment = {
  provider: ProviderId;
  model: string;
};

export type ModelTeam = Record<GenerationTaskRole, ModelAssignment>;

export type ProviderModel = {
  id: string;
  label: string;
  note: string;
};

export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  keyLabel: string;
  models: readonly ProviderModel[];
  dynamicModels?: boolean;
};

export const providerCatalog: readonly ProviderDefinition[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    keyLabel: "Gemini API key",
    models: [
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", note: "Hızlı" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", note: "Derin" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Uyumlu" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    keyLabel: "OpenAI API key",
    models: [
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Önerilen" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "En yüksek kalite" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "Ekonomik" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    keyLabel: "Claude API key",
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", note: "Önerilen" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1", note: "Derin" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Hızlı" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyLabel: "OpenRouter API key",
    dynamicModels: true,
    models: [
      { id: "openrouter/auto", label: "Auto Router", note: "Otomatik seçim" },
    ],
  },
] as const;

export const defaultModelByProvider: Record<ProviderId, string> = {
  gemini: "gemini-3.7-flash",
  openai: "gpt-5.6-terra",
  anthropic: "claude-sonnet-4-5",
  openrouter: "openrouter/auto",
};

export const generationTaskCatalog: ReadonlyArray<{
  id: GenerationTaskRole;
  label: string;
  shortLabel: string;
  description: string;
  recommendation: string;
}> = [
  {
    id: "evidence",
    label: "Kanıt ve kaynak okuma",
    shortLabel: "Evidence",
    description: "Paper özeti, kaynak haritası, sınırlılıklar ve doğrulanabilir claim’ler.",
    recommendation: "Geniş bağlam ve güçlü PDF okuma",
  },
  {
    id: "technical",
    label: "Teknik ve matematiksel analiz",
    shortLabel: "Technical",
    description: "Yöntem, denklemler, mimari, deney düzeni, sonuçlar ve kodlama mantığı.",
    recommendation: "Derin reasoning ve kod yeteneği",
  },
  {
    id: "report",
    label: "Rapor ve açıklayıcı anlatım",
    shortLabel: "Report",
    description: "Derin rapor, eleştiri, reprodüksiyon notları ve anlaşılır açıklamalar.",
    recommendation: "Güçlü yazım ve sentez",
  },
  {
    id: "visual",
    label: "Canvas ve görsel yönetmenlik",
    shortLabel: "Visual",
    description: "İnfografikler, mimari haritalar, canvas düzenleri ve scrollytelling planı.",
    recommendation: "Tasarım yargısı ve structured output",
  },
];

export const generationTaskRoles = generationTaskCatalog.map((task) => task.id) as GenerationTaskRole[];

export function createSingleModelTeam(assignment: ModelAssignment): ModelTeam {
  return {
    evidence: { ...assignment },
    technical: { ...assignment },
    report: { ...assignment },
    visual: { ...assignment },
  };
}

export const recommendedModelTeam: ModelTeam = {
  evidence: { provider: "gemini", model: "gemini-3.7-flash" },
  technical: { provider: "anthropic", model: "claude-opus-4-1" },
  report: { provider: "openai", model: "gpt-5.6-sol" },
  visual: { provider: "openrouter", model: "openrouter/auto" },
};

export function getProvider(providerId: string) {
  return providerCatalog.find((provider) => provider.id === providerId);
}

export function getProviderForModel(modelId: string) {
  return providerCatalog.find((provider) =>
    provider.id !== "openrouter" && provider.models.some((model) => model.id === modelId),
  );
}

export function resolveProviderModel(providerId: string, modelId: string) {
  const provider = getProvider(providerId);
  if (!provider) return undefined;
  if (provider.id === "openrouter") {
    const normalized = modelId.trim();
    if (!/^[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:-]+$/.test(normalized)) return undefined;
    return { provider: provider.id, model: normalized };
  }
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (!model) return undefined;
  return { provider: provider.id, model: model.id };
}
