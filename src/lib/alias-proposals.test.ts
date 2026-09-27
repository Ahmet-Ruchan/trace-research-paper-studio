import { describe, expect, it } from "vitest";
import { aliasBatches, MAX_ALIAS_NAMES, MAX_ALIAS_PROPOSALS_TOTAL, mergeAliasProposals, type ConceptName } from "./alias-proposals";

const name = (term: string, definition: string, papers = 1): ConceptName => ({ term, key: term.toLowerCase(), definition, paper: `Paper of ${term}`, kind: "glossary", papers });

/**
 * Büyük bir kütüphane: 480 birbirinden farklı kavram (beşer beşer aynı
 * konuda) ve on çift eş ad. Çiftin bir adı çok makalede geçiyor (listenin
 * başında), öteki tek makalede (sonunda): sırayla bölünseler ayrı düşerlerdi.
 */
function largeLibrary() {
  const letters = (value: number) => value.toString(26).replace(/./g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 26)));
  const fillers = Array.from({ length: 480 }, (_, index) =>
    name(`Filler ${letters(index + 1000)}`, `A model layer about topic${letters(Math.floor(index / 5))} with detail${letters(index + 5000)} for the network.`, 2),
  );
  const pairs = Array.from({ length: 10 }, (_, index) => [
    name(`Popular idea ${letters(index + 300)}`, `Turns the scores of pairword${letters(index)} into weights that sum to one.`, 3),
    name(`Rare synonym ${letters(index + 400)}`, `Maps pairword${letters(index)} scores to weights summing to one.`, 1),
  ] as const);
  const names = [...pairs.map(([popular]) => popular), ...fillers, ...pairs.map(([, rare]) => rare)];
  return { names, pairs };
}

describe("splitting a large library's names for the model", () => {
  it("sends a small library in one part, in its own order", () => {
    const names = [name("Softmax", "Turns scores into weights."), name("Dot product", "Multiplies and adds.")];
    expect(aliasBatches(names)).toEqual([names]);
    expect(aliasBatches([])).toEqual([]);
  });

  it("reads every name, keeps each part within the limit, and puts two names with the same definition in the same part", () => {
    const { names, pairs } = largeLibrary();
    const batches = aliasBatches(names);
    expect(batches.every((batch) => batch.length <= MAX_ALIAS_NAMES)).toBe(true);
    expect(new Set(batches.flat().map((item) => item.term)).size).toBe(names.length);
    // Kopyalar sınırlı: sınırda kesilen çiftlerin öteki ucu, parçanın onda biri kadar.
    expect(batches.length).toBeLessThanOrEqual(Math.ceil(names.length / (MAX_ALIAS_NAMES - MAX_ALIAS_NAMES / 10)));
    for (const [popular, rare] of pairs) {
      expect(batches.some((batch) => batch.includes(popular) && batch.includes(rare)), `${popular.term} and ${rare.term}`).toBe(true);
    }
    // Sırayla bölmek bu çiftleri ayırırdı: yöntemi sınayan da bu.
    const inOrder = Array.from({ length: Math.ceil(names.length / MAX_ALIAS_NAMES) }, (_, index) => names.slice(index * MAX_ALIAS_NAMES, (index + 1) * MAX_ALIAS_NAMES));
    expect(pairs.some(([popular, rare]) => !inOrder.some((batch) => batch.includes(popular) && batch.includes(rare)))).toBe(true);
  });

  it("keeps a part's same-topic names together", () => {
    const { names } = largeLibrary();
    const batches = aliasBatches(names);
    const topicOf = (item: ConceptName) => item.definition.match(/topic(\w+)/)?.[1];
    const topics = new Map<string, Set<number>>();
    batches.forEach((batch, index) => batch.forEach((item) => {
      const topic = topicOf(item);
      if (topic) topics.set(topic, (topics.get(topic) ?? new Set()).add(index));
    }));
    // Beşli konuların neredeyse hepsi tek bir parçada.
    const split = [...topics.values()].filter((parts) => parts.size > 1).length;
    expect(split).toBeLessThanOrEqual(batches.length * 2);
  });

  it("merges the parts' proposals, once per pair, up to the overall limit", () => {
    const [a, b, c] = [name("A one", "x"), name("B two", "x"), name("C three", "x")];
    const merged = mergeAliasProposals([[{ a, b, why: "first" }], [{ a: b, b: a, why: "again" }, { a, b: c, why: "other" }]]);
    expect(merged.map((item) => item.why)).toEqual(["first", "other"]);
    const many = Array.from({ length: 60 }, (_, index) => ({ a: name(`L${index}`, "x"), b: name(`R${index}`, "x"), why: String(index) }));
    expect(mergeAliasProposals([many.slice(0, 30), many.slice(30)])).toHaveLength(MAX_ALIAS_PROPOSALS_TOTAL);
  });
});
