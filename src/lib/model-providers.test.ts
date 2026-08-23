import { describe, expect, it } from "vitest";
import {
  defaultModelByProvider,
  documentTaskRoles,
  generationTaskRoles,
  getProviderForModel,
  providerCatalog,
  providerReadsDocuments,
  recommendedModelTeam,
  resolveProviderModel,
} from "./model-providers";

describe("model provider catalog", () => {
  it("keeps every model id unique", () => {
    const ids = providerCatalog.flatMap((provider) =>
      provider.models.map((model) => model.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps provider defaults selectable", () => {
    providerCatalog.forEach((provider) => {
      expect(resolveProviderModel(provider.id, defaultModelByProvider[provider.id])).toEqual({
        provider: provider.id,
        model: defaultModelByProvider[provider.id],
      });
    });
  });

  it("does not accept a model under the wrong provider", () => {
    expect(resolveProviderModel("openai", "gemini-3.7-flash")).toBeUndefined();
    expect(getProviderForModel("gpt-5.6-sol")?.id).toBe("openai");
  });

  it("accepts a safe dynamic OpenRouter slug", () => {
    expect(resolveProviderModel("openrouter", "anthropic/claude-sonnet-4.5")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.5",
    });
    expect(resolveProviderModel("openrouter", "not-a-model")).toBeUndefined();
  });

  it("accepts a local model name that is not in any catalogue", () => {
    // Kullanıcının makinesinde hangi modellerin yüklü olduğunu bilemeyiz.
    expect(resolveProviderModel("local", "qwen3.5:9b")).toEqual({ provider: "local", model: "qwen3.5:9b" });
    expect(resolveProviderModel("local", "hf.co/bartowski/Model-GGUF:Q4_K_M")).toEqual({
      provider: "local",
      model: "hf.co/bartowski/Model-GGUF:Q4_K_M",
    });
  });

  it("still bounds what a free-form model name may contain", () => {
    // Değer doğrudan bir HTTP gövdesine giriyor.
    expect(resolveProviderModel("local", "model name with spaces")).toBeUndefined();
    expect(resolveProviderModel("local", "")).toBeUndefined();
    expect(resolveProviderModel("local", "x".repeat(200))).toBeUndefined();
  });

  it("does not attribute a free-form model name to a provider", () => {
    // "qwen3:8b" yerel katalogda öneri olarak duruyor, ama bir model adının
    // hangi sağlayıcıya ait olduğu serbest isimlerde çıkarsanamaz.
    expect(getProviderForModel("qwen3:8b")).toBeUndefined();
    expect(getProviderForModel("openrouter/auto")).toBeUndefined();
  });

  it("marks the local provider as unable to read documents", () => {
    expect(providerReadsDocuments("local")).toBe(false);
    expect(providerReadsDocuments("gemini")).toBe(true);
    expect(providerReadsDocuments("openrouter")).toBe(true);
    // Bilinmeyen bir sağlayıcı kimliği okuyabilir sayılır: bu bayrak bir
    // güvenlik kontrolü değil, yetenek beyanı.
    expect(providerReadsDocuments("nonexistent")).toBe(true);
  });

  it("keeps the document stages exactly the ones that receive the PDF", () => {
    expect([...documentTaskRoles]).toEqual(["evidence", "technical"]);
    documentTaskRoles.forEach((role) => expect(generationTaskRoles).toContain(role));
  });

  it("never puts a provider that cannot read the PDF on a document stage by default", () => {
    documentTaskRoles.forEach((role) => {
      expect(providerReadsDocuments(recommendedModelTeam[role].provider)).toBe(true);
    });
  });

  it("ships a valid four-provider expert team preset", () => {
    expect(new Set(generationTaskRoles.map((role) => recommendedModelTeam[role].provider)).size).toBe(4);
    generationTaskRoles.forEach((role) => {
      const assignment = recommendedModelTeam[role];
      expect(resolveProviderModel(assignment.provider, assignment.model)).toEqual(assignment);
    });
  });
});
