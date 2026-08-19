import { describe, expect, it } from "vitest";
import {
  defaultModelByProvider,
  generationTaskRoles,
  getProviderForModel,
  providerCatalog,
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

  it("ships a valid four-provider expert team preset", () => {
    expect(new Set(generationTaskRoles.map((role) => recommendedModelTeam[role].provider)).size).toBe(4);
    generationTaskRoles.forEach((role) => {
      const assignment = recommendedModelTeam[role];
      expect(resolveProviderModel(assignment.provider, assignment.model)).toEqual(assignment);
    });
  });
});
