import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { addHighlightCard, clozeCandidates, clozeMatches, highlightCardOf, removeHighlightCard } from "./highlight-cards";
import { cardText, dueCards, recordReview, reviewCards } from "./review-queue";
import { addDays, clozeSchema } from "./review-schedule";
import { studyProgressSchema } from "./study-path";
import { mergeStudyProgress } from "./study-transfer";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const T0 = "2026-09-20T09:00:00.000Z";
const quote = "The Transformer relies entirely on self-attention and reaches 28.4 BLEU on English-to-German translation.";
const note = { id: "note-1", quote };

describe("cards from highlights", () => {
  it("hides a term of the paper first, then a number, then the longest words", () => {
    const candidates = clozeCandidates(quote, example);
    expect(candidates[0]).toEqual({ answer: "self-attention", at: quote.indexOf("self-attention"), kind: "term" });
    expect(candidates[1]).toEqual({ answer: "28.4", at: quote.indexOf("28.4"), kind: "number" });
    expect(candidates.slice(2).map((item) => item.answer)).toEqual(["English-to-German", "Transformer", "translation", "entirely", "reaches", "relies"]);
    // "Attention" sözlükte ama "self-attention"ın içinde: aynı yer iki kez önerilmiyor.
    expect(candidates.filter((item) => item.answer.toLowerCase() === "attention")).toEqual([]);
    expect(candidates.length).toBeLessThanOrEqual(8);
    for (const item of candidates) expect(quote.slice(item.at, item.at + item.answer.length)).toBe(item.answer);
  });

  it("finds a term written without its abbreviation, and offers nothing for a highlight of small words", () => {
    const withAbbreviation = { ...example, evidence: { ...example.evidence, glossary: [{ term: "Byte-pair encoding (BPE)", definition: "x" }] } };
    expect(clozeCandidates("Sentences were encoded using byte-pair encoding.", withAbbreviation)[0]).toMatchObject({ answer: "byte-pair encoding", kind: "term" });
    expect(clozeCandidates("it is in the", example)).toEqual([]);
  });

  it("accepts the missing word however it is typed", () => {
    expect(clozeMatches("Self Attention", "self-attention")).toBe(true);
    expect(clozeMatches(" softmax. ", "Softmax")).toBe(true);
    expect(clozeMatches("normalisation", "normalisation")).toBe(true);
    expect(clozeMatches("attention", "self-attention")).toBe(false);
    expect(clozeMatches("  ", "x")).toBe(false);
  });

  it("puts the card in the review queue tomorrow, with the highlight's own text", () => {
    const [term] = clozeCandidates(quote, example);
    const progress = addHighlightCard(undefined, note, term, "Why attention alone", T0);
    expect(studyProgressSchema.parse(progress)).toEqual(progress);
    const card = highlightCardOf(progress, "note-1")!;
    expect(card).toMatchObject({ id: "h:note-1", box: 0, due: addDays(T0, 1), cloze: { text: quote, answer: "self-attention", where: "Why attention alone" } });

    const cards = reviewCards([example], new Map([[example.id, progress]]));
    expect(cards).toEqual([expect.objectContaining({ kind: "highlight", projectId: example.id })]);
    expect(cardText(cards[0])).toBe("The Transformer relies entirely on _____ and reaches 28.4 BLEU on English-to-German translation.");
    expect(dueCards(cards, addDays(T0, 1))).toHaveLength(1);

    // Tekrar edilince öteki kartlar gibi ilerliyor ve günün sayısına giriyor.
    const reviewed = recordReview(progress, cards[0], true, addDays(T0, 1));
    expect(highlightCardOf(reviewed, "note-1")).toMatchObject({ box: 1, reviews: 1 });
    expect(reviewed.reviewDays).toHaveLength(1);
  });

  it("starts the card over when another word is hidden, and drops it when the highlight goes", () => {
    const [term, number] = clozeCandidates(quote, example);
    const first = addHighlightCard(undefined, note, term, "", T0);
    const remembered = recordReview(first, reviewCards([example], new Map([[example.id, first]]))[0], true, addDays(T0, 1));
    expect(addHighlightCard(remembered, note, term, "", addDays(T0, 2))).toBe(remembered);
    const changed = addHighlightCard(remembered, note, number, "", addDays(T0, 2));
    expect(highlightCardOf(changed, "note-1")).toMatchObject({ box: 0, reviews: 0, cloze: { answer: "28.4" } });

    const removed = removeHighlightCard(changed, "note-1", addDays(T0, 3))!;
    expect(highlightCardOf(removed, "note-1")).toBeUndefined();
    expect(reviewCards([example], new Map([[example.id, removed]]))).toEqual([]);
    expect(removeHighlightCard(removed, "note-1", addDays(T0, 3))).toBe(removed);
  });

  it("refuses a card whose hidden word is not where it says, and keeps cards when two devices merge", () => {
    expect(clozeSchema.safeParse({ text: quote, answer: "softmax", at: 4 }).success).toBe(false);
    const [term] = clozeCandidates(quote, example);
    const laptop = addHighlightCard(undefined, note, term, "", T0);
    const phone = addHighlightCard(undefined, { id: "note-2", quote }, term, "", T0);
    expect(mergeStudyProgress(laptop, phone, T0).reviews!.map((item) => item.id).sort()).toEqual(["h:note-1", "h:note-2"]);
  });
});
