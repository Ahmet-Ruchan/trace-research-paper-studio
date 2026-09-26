import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { markTerms, sectionPrerequisites, termIndex, type TermEntry } from "./term-index";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const entry = (term: string, extra: Partial<TermEntry> = {}): TermEntry => ({ key: term.toLowerCase(), term, definition: `${term} means…`, claimIds: [], ...extra });
const marks = (paragraphs: string[], entries: TermEntry[], language = "en") =>
  markTerms(paragraphs, entries, language).map((segments) => segments.filter((segment) => segment.entry).map((segment) => segment.text));

describe("terms in the text", () => {
  it("brings the glossary and the primer into one index, the primer's reason kept", () => {
    const terms = termIndex(example);
    expect(terms).toHaveLength(example.evidence.glossary.length + example.primer!.concepts.length);
    const softmax = terms.find((term) => term.term === "Softmax")!;
    expect(softmax.whyItMatters).toBe(example.primer!.concepts.find((concept) => concept.term === "Softmax")!.whyItMatters);
    const merged = termIndex({ ...example, evidence: { ...example.evidence, glossary: [...example.evidence.glossary, { term: "softmax", definition: "Glossary wording." }] } });
    expect(merged.find((term) => term.key === "softmax")).toMatchObject({ definition: "Glossary wording.", whyItMatters: softmax.whyItMatters });
  });

  it("marks a term once per section, at its first mention", () => {
    expect(marks(["Attention is all.", "More attention here."], [entry("Attention")])).toEqual([["Attention"], []]);
  });

  it("prefers the longer term and respects word boundaries", () => {
    const terms = [entry("Attention"), entry("Multi-head attention"), entry("Self-attention")];
    expect(marks(["Multi-head attention splits attention; self-attention too."], terms)).toEqual([["Multi-head attention", "attention", "self-attention"]]);
    expect(marks(["Selfattention and attentional drift."], [entry("Attention")])).toEqual([[]]);
  });

  it("follows plurals and short inflections, in English and in Turkish", () => {
    expect(marks(["Two dot products."], [entry("Dot product")])).toEqual([["dot products"]]);
    expect(marks(["The model's attention."], [entry("Model")])).toEqual([["model's"]]);
    expect(marks(["Softmax'ın çıktısı ve dikkatin ağırlığı."], [entry("Softmax"), entry("Dikkat", { key: "dikkat" })], "tr")).toEqual([["Softmax'ın", "dikkatin"]]);
    expect(marks(["İŞLEM maliyeti"], [entry("işlem", { key: "işlem" })], "tr")).toEqual([["İŞLEM"]]);
  });

  it("lists what to know before a section: concepts it rests on, in primer order", () => {
    const terms = termIndex(example);
    const scaling = example.story.sections.find((section) => section.title === "Why the scaling was necessary")!;
    expect(sectionPrerequisites(scaling, terms, "en").map((term) => term.term)).toEqual(["Dot product", "Softmax", "Variance and scale"]);
    // Sözlük terimleri ön bilgi değil: "Before this section" yalnızca kavramları gösteriyor.
    for (const section of example.story.sections) {
      expect(sectionPrerequisites(section, terms, "en").every((term) => term.conceptId)).toBe(true);
    }
  });
});
