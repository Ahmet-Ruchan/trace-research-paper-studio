import { describe, expect, it } from "vitest";
import { z } from "zod";
import { storySpecSchema } from "./schema";
import { omitNullObjectFields, openAiJsonSchema } from "./openai-structured";

function findKey(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => findKey(item, key));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([childKey, child]) => [
    ...(childKey === key ? [child] : []),
    ...findKey(child, key),
  ]);
}

describe("OpenAI structured output compatibility", () => {
  it("requires optional object fields while allowing an explicit null", () => {
    const schema = openAiJsonSchema(z.object({
      title: z.string(),
      doi: z.string().optional(),
      nested: z.object({ locator: z.string().optional() }),
    }));

    expect(schema.required).toEqual(["title", "doi", "nested"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).toMatchObject({
      doi: { anyOf: [{ type: "string" }, { type: "null" }] },
      nested: {
        type: "object",
        required: ["locator"],
        additionalProperties: false,
      },
    });
  });

  it("normalizes API null placeholders back to optional fields", () => {
    expect(omitNullObjectFields({ title: "Paper", doi: null, refs: [{ page: 2, locator: null }] }))
      .toEqual({ title: "Paper", refs: [{ page: 2 }] });
  });

  it("converts StorySpec discriminated unions to OpenAI-supported anyOf", () => {
    const schema = openAiJsonSchema(storySpecSchema);

    expect(findKey(schema, "oneOf")).toHaveLength(0);
    expect(findKey(schema, "anyOf").some(
      (branches) => Array.isArray(branches) && branches.length === 11,
    )).toBe(true);
  });
});
