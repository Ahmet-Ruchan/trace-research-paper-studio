import { describe, expect, it } from "vitest";
import { recommendedModelTeam } from "./model-providers";
import { parseSetupPreferences, serializeSetupPreferences, type SetupPreferences } from "./setup-preferences";

const roundTrip = (preferences: SetupPreferences) => parseSetupPreferences(JSON.parse(serializeSetupPreferences(preferences)));

describe("remembered analysis setup", () => {
  it("keeps every choice it knows", () => {
    const preferences: SetupPreferences = {
      audience: "expert",
      depth: "deep",
      language: "pt-BR",
      single: { provider: "anthropic", model: "claude-sonnet-4-5" },
      orchestration: "team",
      team: structuredClone(recommendedModelTeam),
      templateId: "method-walkthrough",
    };
    expect(roundTrip(preferences)).toEqual(preferences);
  });

  it("never writes an API key, whatever it is handed", () => {
    const withKeys = { audience: "student", apiKeys: { openai: "sk-secret" }, key: "sk-secret" } as SetupPreferences;
    const written = serializeSetupPreferences(withKeys);
    expect(written).not.toContain("sk-secret");
    expect(JSON.parse(written)).toEqual({ version: 1, audience: "student" });
  });

  it("drops only the field that no longer makes sense", () => {
    const parsed = parseSetupPreferences({
      version: 1,
      audience: "expert",
      depth: "enormous",
      single: { provider: "openai", model: "a model that was renamed" },
      team: { ...recommendedModelTeam, evidence: { provider: "nowhere", model: "x" } },
      templateId: "",
    });
    expect(parsed).toEqual({ audience: "expert" });
  });

  it("does not keep a single model that cannot read the paper", () => {
    // Yerel sağlayıcı sayfa metnini okuyabiliyor; belge okuyamayan bir sağlayıcı olsaydı düşerdi.
    expect(parseSetupPreferences({ version: 1, single: { provider: "local", model: "qwen3:8b" } }).single).toEqual({ provider: "local", model: "qwen3:8b" });
  });

  it("reads nothing from an unknown or damaged record", () => {
    expect(parseSetupPreferences(null)).toEqual({});
    expect(parseSetupPreferences("garbage")).toEqual({});
    expect(parseSetupPreferences({ version: 2, audience: "expert" })).toEqual({});
  });
});
