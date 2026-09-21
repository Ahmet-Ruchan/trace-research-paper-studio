import { describe, expect, it } from "vitest";
import { ankiCards, buildAnkiDeck } from "./anki-export";
import { loadExampleProject } from "./example-fixture";

describe("Anki export", () => {
  const project = loadExampleProject("attention-is-all-you-need.en.trace.json");

  it("her kavram, soru ve sözlük girdisi için bir kart üretir", () => {
    const cards = ankiCards(project);
    expect(cards).toHaveLength(
      (project.primer?.concepts.length ?? 0) + (project.quiz?.questions.length ?? 0) + project.evidence.glossary.length,
    );
    // Arka yüz kaynağı gösterir: alıntı ve sayfa.
    const quizCard = cards.find((card) => card.tags.includes("quiz"))!;
    expect(quizCard.back).toMatch(/<small>“.+” — p\. \d+<\/small>/);
  });

  it("Anki'nin içe aktardığı biçimi üretir: başlık satırları ve üç sütun", () => {
    const lines = buildAnkiDeck(project).trimEnd().split("\n");
    expect(lines.slice(0, 5)).toEqual(["#separator:tab", "#html:true", "#notetype:Basic", "#deck:Trace::Attention Is All You Need", "#tags column:3"]);
    const rows = lines.slice(5);
    expect(rows.length).toBe(ankiCards(project).length);
    rows.forEach((row) => expect(row.split("\t")).toHaveLength(3));
    expect(rows[0].split("\t")[2].split(" ")).toEqual(expect.arrayContaining(["trace", "Attention-Is-All-You-Need", "primer"]));
  });

  it("alan ayırıcılarını ve HTML'i metnin içinde bırakmaz", () => {
    const tricky = structuredClone(project);
    tricky.evidence.paper.title = "A::B\tC";
    tricky.evidence.glossary = [{ term: "<script>x</script>", definition: "line one\nline\ttwo & more" }];
    tricky.primer = undefined;
    tricky.quiz = undefined;
    const deck = buildAnkiDeck(tricky);
    expect(deck).toContain("#deck:Trace::A - B C");
    const row = deck.trimEnd().split("\n").pop()!;
    expect(row.split("\t")).toHaveLength(3);
    expect(row).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(row).toContain("line one<br>line two &amp; more");
  });
});
