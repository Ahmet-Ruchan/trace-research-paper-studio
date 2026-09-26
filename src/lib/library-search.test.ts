import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import {
  buildClaimIndex,
  excerptAround,
  highlightSegments,
  searchClaims,
  searchTerms,
} from "./library-search";
import type { Claim, ResearchProject } from "./schema";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");

type ClaimSketch = { id: string; statement: string; excerpt?: string; page?: number; kind?: Claim["kind"] };

/** Örnekten türeyen, iddiaları elle yazılmış bir proje; sıralama ve eşleşme burada tam denetlenebiliyor. */
function paper(id: string, claims: ClaimSketch[], extra: Partial<ResearchProject> = {}): ResearchProject {
  const base = structuredClone(example);
  return {
    ...base,
    id,
    evidence: {
      ...base.evidence,
      paper: { ...base.evidence.paper, title: `Paper ${id}` },
      claims: claims.map((claim) => ({
        id: claim.id,
        statement: claim.statement,
        kind: claim.kind ?? "method",
        confidence: "verified",
        sourceRefs: [{ sourceId: "paper", page: claim.page ?? 1, excerpt: claim.excerpt ?? claim.statement }],
      })),
    },
    ...extra,
  };
}

const ids = (search: ReturnType<typeof searchClaims>) => search.hits.map((hit) => `${hit.project.id}/${hit.claim.id}`);

describe("search terms", () => {
  it("drops punctuation around words but keeps it inside them", () => {
    expect(searchTerms("(BLEU), d_k 28.4 self-attention!")).toEqual(["bleu", "d_k", "28.4", "self-attention"]);
  });

  it("ignores single letters and repeated words", () => {
    expect(searchTerms("a layer, a LAYER k")).toEqual(["layer"]);
    expect(searchTerms("  a  ")).toEqual([]);
  });
});

describe("claim search across the library", () => {
  const library = [
    paper("one", [
      { id: "c1", statement: "Layer normalization follows every residual connection." },
      { id: "c2", statement: "The model has six layers.", excerpt: "Each layer ends in a residual connection." },
      { id: "c3", statement: "Dropout is 0.1." },
    ]),
    paper("two", [
      { id: "c1", statement: "We remove the residual connection entirely.", excerpt: "without any layer norm" },
    ]),
  ];

  it("needs every word, in the claim or in its quote, and searches every paper", () => {
    const search = searchClaims(buildClaimIndex(library), "residual layer");
    expect(ids(search)).toEqual(["one/c1", "one/c2", "two/c1"]);
    expect(search).toMatchObject({ total: 3, papers: 2 });
  });

  it("ranks a word the claim states above one only its quote mentions", () => {
    // "two/c1" iki kelimeyi de cümlesinde taşıyor; "one/c2" yalnızca alıntısında.
    // Defter sırası tersini söylese de cümlesinde taşıyan önce geliyor.
    const search = searchClaims(buildClaimIndex(library), "residual connection");
    expect(ids(search)).toEqual(["one/c1", "two/c1", "one/c2"]);
  });

  it("shows the quote that holds the most query words", () => {
    const project = paper("quotes", [{ id: "c1", statement: "Warmup matters." }]);
    project.evidence.claims[0].sourceRefs = [
      { sourceId: "paper", page: 3, excerpt: "We use warmup." },
      { sourceId: "paper", page: 7, excerpt: "Warmup of 4000 steps, then decay." },
    ];
    const [hit] = searchClaims(buildClaimIndex([project]), "warmup decay").hits;
    expect(hit.reference.page).toBe(7);
  });

  it("returns nothing for a query with no usable word", () => {
    expect(searchClaims(buildClaimIndex(library), " a ")).toMatchObject({ hits: [], total: 0, papers: 0 });
  });

  it("matches whatever the case and the Turkish dotted or dotless I", () => {
    const project = paper("turkish", [
      { id: "c1", statement: "IMAGE patches are embedded linearly." },
      { id: "c2", statement: "İlk katman görüntüyü parçalara böler." },
    ]);
    const index = buildClaimIndex([project]);
    expect(ids(searchClaims(index, "image"))).toEqual(["turkish/c1"]);
    expect(ids(searchClaims(index, "ilk katman"))).toEqual(["turkish/c2"]);
    expect(ids(searchClaims(index, "İMAGE"))).toEqual(["turkish/c1"]);
  });

  it("keeps a rejected claim but lists it last, and carries every trust mark", () => {
    const project = paper(
      "reviewed",
      [
        { id: "rejected", statement: "Attention alone explains the gain." },
        { id: "missing", statement: "Attention heads specialise." },
        { id: "plain", statement: "Attention is scaled." },
      ],
      {
        claimReviews: { rejected: { status: "rejected", by: "Ada", at: "2026-09-01T00:00:00.000Z" } },
        excerptCheck: {
          checkedAt: "2026-09-01T00:00:00.000Z",
          method: "pdftotext",
          pageCount: 10,
          checked: 3,
          unlocated: [{ owner: "claim", id: "missing", page: 1 }],
        },
      },
    );
    const search = searchClaims(buildClaimIndex([project]), "attention");
    expect(ids(search)).toEqual(["reviewed/missing", "reviewed/plain", "reviewed/rejected"]);
    expect(search.hits[0].quoteMissing).toBe(true);
    expect(search.hits[1].quoteMissing).toBe(false);
    expect(search.hits[2].review).toMatchObject({ status: "rejected", by: "Ada" });
  });

  it("does not read a review from the object prototype", () => {
    const project = paper("proto", [{ id: "constructor", statement: "Attention is scaled." }], { claimReviews: {} });
    expect(searchClaims(buildClaimIndex([project]), "attention").hits[0].review).toBeUndefined();
  });

  it("stops at the limit but reports how many claims and papers matched", () => {
    const many = [
      paper("a", Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, statement: `Softmax variant ${index}` }))),
      paper("b", [{ id: "c0", statement: "Softmax again" }]),
    ];
    const search = searchClaims(buildClaimIndex(many), "softmax", 4);
    expect(search.hits).toHaveLength(4);
    expect(search).toMatchObject({ total: 6, papers: 2 });
  });

  it("finds a reported number in the shipped example", () => {
    const search = searchClaims(buildClaimIndex([example]), "41.0 BLEU");
    expect(search.hits.map((hit) => hit.claim.id)).toContain("claim-limitation-03");
    for (const hit of search.hits) {
      const text = [hit.claim.statement, ...hit.claim.sourceRefs.map((reference) => reference.excerpt)].join(" ").toLowerCase();
      expect(text).toContain("41.0");
      expect(text).toContain("bleu");
    }
  });
});

describe("highlighting", () => {
  const marked = (text: string, terms: string[]) =>
    highlightSegments(text, terms).filter((segment) => segment.match).map((segment) => segment.text);

  it("marks every occurrence in the original casing", () => {
    expect(marked("BLEU and bleu", ["bleu"])).toEqual(["BLEU", "bleu"]);
  });

  it("joins overlapping and adjacent words into one mark", () => {
    expect(marked("self-attention", ["self", "self-att", "attention"])).toEqual(["self-attention"]);
  });

  it("marks the original letters when folding changes them", () => {
    // Arama "İ" harfini "i" olarak görüyor; vurgu yine özgün "İMGE" üzerinde.
    expect(marked("İlk İMGE modeli", ["imge"])).toEqual(["İMGE"]);
  });

  it("returns the text unchanged when nothing matches", () => {
    expect(highlightSegments("no match here", ["bleu"])).toEqual([{ text: "no match here", match: false }]);
    expect(highlightSegments("", ["bleu"])).toEqual([]);
  });
});

describe("long quotes", () => {
  const filler = "word ".repeat(120).trim();

  it("leaves a short quote as it is", () => {
    expect(excerptAround("A short quote.", ["quote"])).toBe("A short quote.");
  });

  it("cuts around the first match on word boundaries and marks both cuts", () => {
    const text = `${filler} the decisive BLEU gain ${filler}`;
    const window = excerptAround(text, ["bleu"]);
    expect(window.length).toBeLessThanOrEqual(282);
    expect(window).toContain("decisive BLEU gain");
    expect(window.startsWith("…word ")).toBe(true);
    expect(window.endsWith(" word…")).toBe(true);
  });

  it("keeps a match at the very end visible", () => {
    const window = excerptAround(`${filler} final BLEU`, ["bleu"]);
    expect(window.endsWith("final BLEU")).toBe(true);
    expect(window.startsWith("…")).toBe(true);
  });

  it("starts at the beginning when the quote holds no query word", () => {
    const window = excerptAround(filler, ["bleu"]);
    expect(window.startsWith("word")).toBe(true);
    expect(window.endsWith("…")).toBe(true);
  });
});
