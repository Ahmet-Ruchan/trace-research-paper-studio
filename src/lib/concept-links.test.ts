import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conceptKeys, conceptLinks, conceptPhrases, libraryPaperFor, normalizePhrase, paperKey, sharedConcepts, suggestReferences } from "./concept-links";
import { loadExampleProject } from "./example-fixture";
import type { ResearchProject } from "./schema";
import { completeStep, type StudyProgress } from "./study-path";

const english = loadExampleProject("attention-is-all-you-need.en.trace.json");
const T0 = "2026-09-01T00:00:00.000Z";

/**
 * İkinci bir makale: iki kavramı ön bilgide başka yazımla anlatıyor, üçüncüsü
 * yalnızca ona ait; katman normalizasyonu da yalnızca sözlüğünde.
 */
function secondPaper(): ResearchProject {
  const own = { ...english.primer!.concepts[0], id: "kl-divergence", term: "Kullback-Leibler divergence", claimIds: [], prerequisiteIds: [] };
  const concepts = [...english.primer!.concepts.filter((concept) => ["softmax", "dot-product"].includes(concept.id)), own];
  return {
    ...english,
    id: "second-paper",
    evidence: {
      ...english.evidence,
      paper: { ...english.evidence.paper, title: "A second paper" },
      glossary: [{ term: "Layer normalization (LayerNorm)", definition: "Normalises activations across features." }],
    },
    primer: {
      ...english.primer!,
      concepts: concepts.map((concept) => ({ ...concept, term: concept.id === "softmax" ? "softmax" : concept.id === "dot-product" ? "Dot products" : concept.term, prerequisiteIds: [] })),
    },
  };
}

describe("concepts across the library", () => {
  it("matches names loosely but never by meaning", () => {
    expect(normalizePhrase("Layer Normalisation")).toBe(normalizePhrase("layer normalization"));
    expect(normalizePhrase("Encoder-Decoder")).toBe("encoder decoder");
    expect(normalizePhrase("Dot products")).toBe(normalizePhrase("Dot product"));
    expect(normalizePhrase("Loss")).toBe("loss");
    expect(conceptKeys("Layer normalization (LayerNorm)")).toEqual(["layer normalization", "layernorm"]);
    expect(conceptKeys("The sequential computation bottleneck")).toEqual(["sequential computation bottleneck"]);
  });

  it("says where else a concept is explained, and where the reader studied it", () => {
    const second = secondPaper();
    const study = new Map<string, StudyProgress>([["second-paper", completeStep(undefined, "concept:softmax", "x", T0)]]);
    const links = conceptLinks(english, [english, second], study);
    const softmax = links.find((link) => link.conceptId === "softmax")!;
    expect(softmax.studiedIn).toMatchObject({ projectId: "second-paper", paperTitle: "A second paper", kind: "primer" });
    expect(softmax.studiedIn!.knowledge).toEqual({ studied: true, box: 0 });
    const dot = links.find((link) => link.conceptId === "dot-product")!;
    expect(dot.studiedIn).toBeUndefined();
    expect(dot.elsewhere.map((source) => source.projectId)).toEqual(["second-paper"]);
    // Sözlükteki "Layer normalization (LayerNorm)" birleşik kavramla adla eşleşmiyor: yalnızca aynı ad eşleşiyor.
    expect(links.find((link) => link.conceptId === "residual-layernorm")!.elsewhere).toEqual([]);
    // Makalenin kendisi "başka yer" değil; kendi ilerlemesi "burada" sayılıyor.
    const here = conceptLinks(english, [english], new Map([[english.id, completeStep(undefined, "concept:softmax", "x", T0)]]));
    expect(here.find((link) => link.conceptId === "softmax")).toMatchObject({ here: { studied: true }, elsewhere: [] });
  });

  it("maps the concepts more than one paper explains, most-connected first", () => {
    const shared = sharedConcepts([english, secondPaper()], new Map());
    // Terim, adı ilk gelen makalenin yazımıyla gösteriliyor; eşleşme yazımdan bağımsız.
    expect(shared.map((concept) => concept.key)).toEqual(expect.arrayContaining(["softmax", "dot product"]));
    expect(shared.some((concept) => concept.key === "kullback leibler divergence")).toBe(false);
    for (const concept of shared) expect(concept.papers).toBe(2);
    expect(sharedConcepts([english], new Map())).toEqual([]);
  });

  it("counts a paper once, however many analyses of it the library holds", () => {
    const again = { ...english, id: "attention-again" };
    const second = secondPaper();
    // Aynı makalenin ikinci analizi "başka bir makale" değil.
    const links = conceptLinks(english, [english, again, second], new Map());
    expect(links.find((link) => link.conceptId === "softmax")!.elsewhere.map((source) => source.projectId)).toEqual(["second-paper"]);
    expect(links.find((link) => link.conceptId === "variance")!.elsewhere).toEqual([]);

    // Haritada da: her makale bir kez, ve çalışılmış analizi gösteriliyor.
    const shared = sharedConcepts([english, again, second], new Map([["attention-again", completeStep(undefined, "concept:softmax", "x", T0)]]));
    expect(shared.every((concept) => concept.papers === 2)).toBe(true);
    expect(shared.some((concept) => concept.key === "variance and scale")).toBe(false);
    const softmax = shared.find((concept) => concept.key === "softmax")!;
    expect(softmax.sources.map((source) => source.projectId).sort()).toEqual(["attention-again", "second-paper"]);
    expect(softmax.studied).toBe(true);

    // Başlık farklı olsa da DOI aynı makaleyi gösteriyor.
    const withDoi = (project: ResearchProject, title: string) => ({ ...project, evidence: { ...project.evidence, paper: { ...project.evidence.paper, title, doi: "https://doi.org/10.5555/X" } } });
    expect(paperKey(withDoi(english, "One title"))).toBe("doi:10.5555/x");
    expect(paperKey(withDoi(english, "One title"))).toBe(paperKey(withDoi(again, "Another title")));
  });

  it("suggests cited works whose titles name a concept not yet studied, and only whole phrases", () => {
    expect(conceptPhrases("Residual connections and layer normalisation")).toEqual(["residual connection", "layer normalization"]);
    expect(conceptPhrases("Variance and scale")).toEqual([]);
    expect(conceptPhrases("Softmax")).toEqual(["softmax"]);
    const references = [
      { title: "Layer Normalization", year: 2016, citationCount: 10_000, identifier: "arxiv:1607.06450" },
      { title: "Learning Phrase Representations using RNN Encoder-Decoder for Statistical Machine Translation", year: 2014, citationCount: 20_000 },
      { title: "Exploring the Limits of Large-Scale Language Modeling", year: 2016, citationCount: 1_000 },
      { title: "Deep Residual Learning for Image Recognition", year: 2016, citationCount: 200_000 },
    ];
    const suggestions = suggestReferences(conceptLinks(english, [english], new Map()), references);
    expect(suggestions.map((item) => [item.conceptId, item.reference.title])).toEqual([
      ["residual-layernorm", "Layer Normalization"],
      ["encoder-decoder", "Learning Phrase Representations using RNN Encoder-Decoder for Statistical Machine Translation"],
    ]);
    // Bir kavram başka bir makalede çalışıldıysa onun için öneri yok.
    const studied = new Map([["second-paper", completeStep(undefined, "concept:softmax", "x", T0)]]);
    const withSoftmax = [...references, { title: "On the Softmax Bottleneck", year: 2018, citationCount: 500 }];
    expect(suggestReferences(conceptLinks(english, [english, secondPaper()], studied), withSoftmax).some((item) => item.conceptId === "softmax")).toBe(false);
    expect(suggestReferences(conceptLinks(english, [english], new Map()), withSoftmax).some((item) => item.conceptId === "softmax")).toBe(true);
  });

  it("recognises a suggested work that is already in the library, by DOI or by title", () => {
    const base = secondPaper();
    const second = { ...base, evidence: { ...base.evidence, paper: { ...base.evidence.paper, title: "Layer Normalisation", doi: "https://doi.org/10.48550/arXiv.1607.06450" } } };
    expect(libraryPaperFor({ title: "Layer Normalization" }, [english, second])?.id).toBe("second-paper");
    expect(libraryPaperFor({ title: "Another record of it", identifier: "10.48550/arxiv.1607.06450" }, [english, second])?.id).toBe("second-paper");
    expect(libraryPaperFor({ title: "Layer Normalization in Practice" }, [english, second])).toBeUndefined();
    expect(libraryPaperFor({ title: "Something else", identifier: "arxiv:1607.06450" }, [english, base])).toBeUndefined();
  });
});

describe("the concepts bridge for agents", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const BRIDGE = join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs");
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-concepts-"));
    mkdirSync(join(workspace, "data", "library"), { recursive: true });
    writeFileSync(join(workspace, "data", "library", "second-paper.trace.json"), JSON.stringify(secondPaper()));
    writeFileSync(join(workspace, "data", "library", "attention.trace.json"), JSON.stringify(english));
    writeFileSync(join(workspace, "data", "library", "broken.trace.json"), "{");
    writeFileSync(join(workspace, "data", "library", "study.json"), JSON.stringify({ version: 1, projects: [{ id: "second-paper", progress: completeStep(undefined, "concept:softmax", "x", T0) }] }));
    writeFileSync(join(workspace, "paper.trace.json"), JSON.stringify(english));
  });
  afterEach(() => rmSync(workspace, { recursive: true, force: true }));

  const bridge = (...args: string[]) => {
    const run = spawnSync(process.execPath, [BRIDGE, ...args], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data") } });
    return { status: run.status, json: JSON.parse(run.status === 0 ? run.stdout : run.stderr) as Record<string, unknown> };
  };

  it("tells the agent which concepts the reader studied elsewhere, and maps the library", () => {
    const linked = bridge("concepts", "--project", join(workspace, "paper.trace.json"));
    expect(linked.status).toBe(0);
    expect(linked.json).toMatchObject({ papers: 2, unreadable: 1, summary: { concepts: english.primer!.concepts.length, studiedElsewhere: 1 } });
    const softmax = (linked.json.concepts as Array<{ conceptId: string; studiedIn: { paper: string } | null }>).find((item) => item.conceptId === "softmax")!;
    expect(softmax.studiedIn?.paper).toBe("A second paper");

    const map = bridge("concepts");
    expect(map.status).toBe(0);
    const terms = (map.json.shared as Array<{ term: string; studied: boolean }>).map((item) => [item.term.toLowerCase(), item.studied]);
    expect(terms).toEqual(expect.arrayContaining([["softmax", true], ["dot products", false]]));
  });

  it("suggests cited works from a reference list the agent gives it, and marks the ones already in the library", () => {
    const third = { ...english, id: "third-paper", evidence: { ...english.evidence, paper: { ...english.evidence.paper, title: "Embedding Vectors, Explained" } } };
    writeFileSync(join(workspace, "data", "library", "third-paper.trace.json"), JSON.stringify(third));
    const list = join(workspace, "references.json");
    writeFileSync(list, JSON.stringify(["Layer Normalization", { title: "Embedding vectors, explained", year: "2019" }, { title: "Deep Residual Learning for Image Recognition", year: 2016 }]));
    const run = bridge("concepts", "--project", join(workspace, "paper.trace.json"), "--references", list);
    expect(run.status).toBe(0);
    const suggestions = run.json.suggestions as { ok: boolean; source: string; references: number; items: Array<{ conceptId: string; title: string; year: number | null; inLibrary: { projectId: string } | null }> };
    expect(suggestions).toMatchObject({ ok: true, source: "file", references: 3 });
    expect(suggestions.items.map((item) => [item.conceptId, item.title, item.inLibrary?.projectId ?? null])).toEqual([
      ["embedding", "Embedding vectors, explained", "third-paper"],
      ["residual-layernorm", "Layer Normalization", null],
    ]);
    expect(suggestions.items[0].year).toBe(2019);

    // Satır başına bir başlık da olur; softmax başka bir makalede çalışıldığı için önerilmiyor.
    const lines = join(workspace, "references.txt");
    writeFileSync(lines, "On the Softmax Bottleneck\nLayer Normalization\n\n");
    const fromLines = bridge("concepts", "--project", join(workspace, "paper.trace.json"), "--references", lines);
    expect((fromLines.json.suggestions as { items: Array<{ title: string }> }).items.map((item) => item.title)).toEqual(["Layer Normalization"]);

    const refused = spawnSync(process.execPath, [BRIDGE, "concepts", "--suggest"], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data") } });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("--suggest and --references need --project");
  });
});
