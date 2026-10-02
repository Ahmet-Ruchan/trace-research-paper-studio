import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/messages";
import { ENGLISH_GENERATION_WORDS, generationStages, initialGenerationProgress, initialProgressIn } from "./generation-events";

describe("the analysis screen's own words", () => {
  it("keeps English as it was", () => {
    expect(messagesFor("en").studio.generation.events).toBe(ENGLISH_GENERATION_WORDS);
    expect(initialProgressIn()).toEqual(initialGenerationProgress);
    for (const stage of generationStages) {
      expect(ENGLISH_GENERATION_WORDS.stages[stage.id]).toEqual({ label: stage.label, description: stage.description });
    }
  });

  it("names every stage in Turkish and starts the progress in Turkish", () => {
    const words = messagesFor("tr").studio.generation.events;
    for (const stage of generationStages) expect(words.stages[stage.id].label).not.toBe(stage.label);
    expect(initialProgressIn(words)).toMatchObject({ stage: "document", progress: initialGenerationProgress.progress, title: "Makale gönderiliyor." });
  });
});
