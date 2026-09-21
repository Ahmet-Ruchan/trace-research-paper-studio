export type ProviderId = "gemini" | "openai" | "anthropic" | "openrouter" | "local";

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
  /** Kullanıcıdan istenen gizli değerin adı — yerel sağlayıcıda bu bir adres. */
  keyLabel: string;
  models: readonly ProviderModel[];
  dynamicModels?: boolean;
  /**
   * Model adı serbest metin: OpenRouter'ın kataloğu da yerel kurulumdaki
   * model listesi de bizim bilebileceğimiz bir şey değil.
   */
  freeformModel?: boolean;
  /** Uçnokta kullanıcının kendi makinesinde; anahtar değil adres istenir. */
  local?: boolean;
  /**
   * PDF'i modele veremeyen sağlayıcı. Yerel sunucular dosya yükleme
   * uçnoktası sunmuyor ve açık ağırlıklı modellerin çoğu görüntü bile
   * göremiyor, dolayısıyla makaleyi OKUYAN aşamalar onlara verilemez.
   */
  readsDocuments?: boolean;
  /**
   * PDF'in kendisini alamayan ama sayfa metnini okuyabilen sağlayıcı. Yerel
   * sunucular böyle: makale sunucuda metne çevrilip isteme ekleniyor, alıntılar
   * da o metne karşı denetleniyor (bkz. `paper-text.ts`).
   */
  readsPaperAsText?: boolean;
  hint?: string;
};

export const providerCatalog: readonly ProviderDefinition[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    keyLabel: "Gemini API key",
    models: [
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", note: "Fast" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", note: "Deepest" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Compatible" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    keyLabel: "OpenAI API key",
    models: [
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Recommended" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "Highest quality" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "Economical" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    keyLabel: "Claude API key",
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", note: "Recommended" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1", note: "Deepest" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fast" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyLabel: "OpenRouter API key",
    dynamicModels: true,
    freeformModel: true,
    readsDocuments: true,
    models: [
      { id: "openrouter/auto", label: "Auto Router", note: "Automatic selection" },
    ],
  },
  {
    id: "local",
    label: "Local model",
    keyLabel: "Local server address",
    local: true,
    freeformModel: true,
    readsDocuments: false,
    readsPaperAsText: true,
    hint: "Ollama, LM Studio or llama.cpp on this machine. Nothing leaves it, and no key is needed. A local model cannot open the PDF, so on the Evidence and Technical stages it reads the text extracted from it (needs pdftotext from Poppler): figures and layout are lost, and every quote is checked against the page text. Give the model a context window of 32K tokens or more.",
    models: [
      { id: "qwen3:8b", label: "qwen3:8b", note: "Ollama" },
      { id: "llama3.1:8b", label: "llama3.1:8b", note: "Ollama" },
      { id: "mistral-nemo:12b", label: "mistral-nemo:12b", note: "Ollama" },
    ],
  },
] as const;

export const defaultModelByProvider: Record<ProviderId, string> = {
  gemini: "gemini-3.7-flash",
  openai: "gpt-5.6-terra",
  anthropic: "claude-sonnet-4-5",
  openrouter: "openrouter/auto",
  local: "qwen3:8b",
};

/**
 * PDF'i modelin önüne koyabilen aşamalar. Bir sağlayıcı belge okuyamıyorsa
 * yalnızca bunların DIŞINDAKİ rollere atanabilir.
 */
export const documentTaskRoles: readonly GenerationTaskRole[] = ["evidence", "technical"];

export function providerReadsDocuments(providerId: string): boolean {
  const provider = getProvider(providerId);
  return provider?.readsDocuments !== false || provider?.readsPaperAsText === true;
}

/** Makaleyi dosya olarak değil, çıkarılmış sayfa metni olarak okuyan sağlayıcı. */
export function providerReadsPaperAsText(providerId: string): boolean {
  const provider = getProvider(providerId);
  return provider?.readsDocuments === false && provider?.readsPaperAsText === true;
}

export const generationTaskCatalog: ReadonlyArray<{
  id: GenerationTaskRole;
  label: string;
  shortLabel: string;
  description: string;
  recommendation: string;
}> = [
  {
    id: "evidence",
    label: "Evidence and source reading",
    shortLabel: "Evidence",
    description: "Paper summary, source map, limitations and verifiable claims.",
    recommendation: "Large context and strong PDF reading",
  },
  {
    id: "technical",
    label: "Technical and mathematical analysis",
    shortLabel: "Technical",
    description: "Method, equations, architecture, experimental setup, results and coding logic.",
    recommendation: "Deep reasoning and coding ability",
  },
  {
    id: "report",
    label: "Report and explanatory writing",
    shortLabel: "Report",
    description: "Deep report, critique, reproduction notes and clear explanations.",
    recommendation: "Strong writing and synthesis",
  },
  {
    id: "visual",
    label: "Canvas and visual direction",
    shortLabel: "Visual",
    description: "Infographics, architecture maps, canvas layouts and the scrollytelling plan.",
    recommendation: "Design judgement and structured output",
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
    !provider.freeformModel && provider.models.some((model) => model.id === modelId),
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
  if (provider.freeformModel) {
    // Yerel kurulumdaki model adlarını bilemeyiz ("qwen3:8b", "hf.co/…:Q4").
    // Yine de doğrudan bir HTTP gövdesine giriyor: biçim sınırlanıyor.
    const normalized = modelId.trim();
    if (!/^[a-zA-Z0-9._:\/-]{1,120}$/.test(normalized)) return undefined;
    return { provider: provider.id, model: normalized };
  }
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (!model) return undefined;
  return { provider: provider.id, model: model.id };
}
