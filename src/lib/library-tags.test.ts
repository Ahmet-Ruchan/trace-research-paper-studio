import { describe, expect, it } from "vitest";
import {
  MAX_TAGS_PER_PROJECT,
  addTag,
  cleanTag,
  hasTag,
  libraryTagsToJson,
  parseLibraryTags,
  removeTag,
  tagCounts,
  tagListSchema,
} from "./library-tags";

describe("tag rules", () => {
  it("collapses whitespace and drops a leading hash", () => {
    expect(cleanTag("  #Deep \t  learning\n")).toBe("Deep learning");
    expect(cleanTag("## to read")).toBe("to read");
    expect(cleanTag("C#")).toBe("C#");
  });

  it("treats spellings that differ only in case, including the Turkish I, as one tag", () => {
    expect(tagListSchema.parse(["NLP", "nlp", " Nlp ", "Vision"])).toEqual(["NLP", "Vision"]);
    expect(tagListSchema.parse(["İlk okuma", "ilk okuma", "ILK OKUMA"])).toEqual(["İlk okuma"]);
    expect(hasTag(["Transformers"], "TRANSFORMERS")).toBe(true);
    expect(hasTag(undefined, "anything")).toBe(false);
  });

  it("refuses an empty tag, a tag over 40 characters and a thirteenth tag", () => {
    expect(tagListSchema.safeParse(["  "]).success).toBe(false);
    const long = tagListSchema.safeParse(["x".repeat(41)]);
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]?.message).toBe("A tag can be at most 40 characters.");
    const many = Array.from({ length: MAX_TAGS_PER_PROJECT + 1 }, (_, index) => `tag ${index}`);
    expect(tagListSchema.safeParse(many).error?.issues[0]?.message).toBe("A paper can carry at most 12 tags.");
  });
});

describe("editing a paper's tags", () => {
  it("joins an existing collection instead of opening a second spelling", () => {
    expect(addTag(["Vision"], "nlp", ["NLP", "Vision"])).toEqual({ ok: true, tags: ["Vision", "NLP"] });
  });

  it("ignores a blank entry and a tag the paper already has", () => {
    expect(addTag(["NLP"], "   ")).toEqual({ ok: true, tags: ["NLP"] });
    expect(addTag(["NLP"], "#nlp")).toEqual({ ok: true, tags: ["NLP"] });
  });

  it("explains why a tag cannot be added", () => {
    const full = Array.from({ length: MAX_TAGS_PER_PROJECT }, (_, index) => `tag ${index}`);
    expect(addTag(full, "one more")).toEqual({ ok: false, error: "A paper can carry at most 12 tags." });
    expect(addTag([], "y".repeat(41))).toEqual({ ok: false, error: "A tag can be at most 40 characters." });
  });

  it("removes a tag whatever its case", () => {
    expect(removeTag(["NLP", "Vision"], "nlp")).toEqual(["Vision"]);
  });
});

describe("collections", () => {
  const tags = new Map([
    ["a", ["NLP", "week 10"]],
    ["b", ["nlp", "week 2"]],
    ["c", ["Vision"]],
    ["deleted", ["Ghost"]],
  ]);

  it("counts papers per tag, largest first, and ignores projects no longer in the library", () => {
    expect(tagCounts(["a", "b", "c"], tags)).toEqual([
      { tag: "NLP", count: 2 },
      { tag: "Vision", count: 1 },
      { tag: "week 2", count: 1 },
      { tag: "week 10", count: 1 },
    ]);
  });

  it("counts a project once even if it is listed twice", () => {
    expect(tagCounts(["c", "c"], tags)).toEqual([{ tag: "Vision", count: 1 }]);
  });
});

describe("tags file", () => {
  it("round-trips through its JSON form", () => {
    const tags = new Map([["paper-1", ["NLP"]], ["paper-2", ["Vision", "to read"]]]);
    expect(parseLibraryTags(JSON.parse(JSON.stringify(libraryTagsToJson(tags))))).toEqual(tags);
  });

  it("drops only the entries it cannot read", () => {
    const parsed = parseLibraryTags({
      version: 1,
      projects: [
        { id: "good", tags: ["NLP"] },
        { id: "", tags: ["no id"] },
        { id: "bad", tags: ["x".repeat(80)] },
        { id: "empty", tags: [] },
        "not an entry",
      ],
    });
    expect([...parsed]).toEqual([["good", ["NLP"]]]);
  });

  it("reads nothing from a file it does not recognise", () => {
    expect(parseLibraryTags({ version: 2, projects: [{ id: "a", tags: ["NLP"] }] }).size).toBe(0);
    expect(parseLibraryTags(undefined).size).toBe(0);
    expect(parseLibraryTags([]).size).toBe(0);
  });

  it("keeps a project whose id is __proto__ as an ordinary key", () => {
    const parsed = parseLibraryTags(JSON.parse('{"version":1,"projects":[{"id":"__proto__","tags":["odd"]}]}'));
    expect(parsed.get("__proto__")).toEqual(["odd"]);
    expect(libraryTagsToJson(parsed).projects).toEqual([{ id: "__proto__", tags: ["odd"] }]);
  });
});
