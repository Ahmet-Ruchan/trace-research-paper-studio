import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as PROPOSE } from "@/app/api/library/aliases/propose/route";
import { GET, PUT } from "@/app/api/library/aliases/route";
import { conceptNames, validateAliasProposals } from "./alias-proposals";
import { aliasMap, decideAlias, decisionFor, emptyAliasFile, forgetAlias, pairKey, type AliasFile } from "./concept-aliases";
import { conceptLinks, sharedConcepts } from "./concept-links";
import { loadExampleProject } from "./example-fixture";
import { IntegrityError } from "./generation-validation";
import { readFirst } from "./reading-order";
import type { ResearchProject } from "./schema";
import { saveStoredProject } from "./trace-storage";

const state = vi.hoisted(() => ({ answers: [] as unknown[], prompts: [] as string[] }));
vi.mock("@/lib/server/model-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/model-runtime")>();
  return {
    ...actual,
    prepareProviderRuntime: vi.fn(async (input: { model: string }) => ({
      label: "fake",
      effectiveModel: input.model,
      cleanup: async () => undefined,
      generateStructured: async (request: { prompt: string }) => {
        state.prompts.push(request.prompt);
        return JSON.stringify(state.answers.shift());
      },
    })),
  };
});

const english = loadExampleProject("attention-is-all-you-need.en.trace.json");
const T0 = "2026-09-01T00:00:00.000Z";

/** İkinci makale nokta çarpımına "Scalar product" diyor; sözlüğünde "Encoder-decoder architecture" tanımlıyor. */
function second(): ResearchProject {
  return {
    ...english,
    id: "second",
    evidence: {
      ...english.evidence,
      paper: { ...english.evidence.paper, title: "A second paper", year: "2014" },
      glossary: [{ term: "Encoder-decoder architecture", definition: "A network that encodes a sequence and decodes another from it." }],
    },
    primer: {
      ...english.primer!,
      concepts: english.primer!.concepts.map((concept) => (concept.id === "dot-product" ? { ...concept, term: "Scalar product" } : { ...concept, term: `${concept.term} in the second paper` })),
    },
  };
}

describe("the reader's concept aliases", () => {
  it("pairs two names regardless of order and spelling, and replaces an earlier decision", () => {
    expect(pairKey("Dot product", "Scalar products")).toBe(pairKey("scalar product", "Dot-product"));
    expect(pairKey("Dot product", "dot products")).toBeUndefined();
    let file = decideAlias(emptyAliasFile(), "Dot product", "Scalar product", "same", "reader", T0);
    file = decideAlias(file, "scalar product", "dot product", "different", "model", T0, "Different granularity.");
    expect(file.decisions).toHaveLength(1);
    expect(decisionFor(file, "Dot product", "Scalar product")).toMatchObject({ decision: "different", proposedBy: "model" });
    expect(forgetAlias(file, "Scalar product", "Dot product").decisions).toEqual([]);
    expect(() => decideAlias(file, "Softmax", "softmax", "same", "reader", T0)).toThrow(/same name/);
  });

  it("joins every name a chain of decisions links, with all of their spellings", () => {
    let file = decideAlias(emptyAliasFile(), "Layer normalization (LayerNorm)", "Layer norm", "same", "reader", T0);
    file = decideAlias(file, "Layer norm", "LNorm", "same", "reader", T0);
    file = decideAlias(file, "Softmax", "Normalized exponential", "different", "reader", T0);
    const map = aliasMap(file);
    const root = (key: string) => map.get(key) ?? key;
    expect(new Set(["layer normalization", "layernorm", "layer norm", "lnorm"].map(root)).size).toBe(1);
    expect(root("softmax")).toBe("softmax");
    expect(root("normalized exponential")).toBe("normalized exponential");
  });

  it("links concepts, the concept map and the reading order only once the reader says they are the same", () => {
    const library = [english, second()];
    const dot = (aliases?: Map<string, string>) => conceptLinks(english, library, new Map(), aliases).find((link) => link.conceptId === "dot-product")!;
    expect(dot().elsewhere).toEqual([]);
    const file = decideAlias(emptyAliasFile(), "Dot product", "Scalar product", "same", "reader", T0);
    expect(dot(aliasMap(file)).elsewhere.map((source) => [source.projectId, source.term])).toEqual([["second", "Scalar product"]]);
    expect(sharedConcepts(library, new Map(), aliasMap(file)).some((concept) => concept.sources.some((source) => source.term === "Scalar product"))).toBe(true);
    // Okuma sırası: ikinci makalenin sözlüğü, birinci makalenin varsaydığını başka adla tanımlıyor.
    expect(readFirst(english, library, new Map())).toEqual([]);
    const linked = decideAlias(file, "Encoder-decoder and auto-regression", "Encoder-decoder architecture", "same", "reader", T0);
    expect(readFirst(english, library, new Map(), aliasMap(linked)).map((item) => item.project.id)).toEqual(["second"]);
  });

  it("lists one name per concept for the model, and keeps only its proposals that name listed, undecided concepts", () => {
    const decided = decideAlias(emptyAliasFile(), "Dot product", "Embedding vector", "different", "reader", T0);
    const names = conceptNames([english, second()], decided);
    expect(names.filter((name) => name.term === "Softmax")).toHaveLength(1);
    expect(names.find((name) => name.term === "Softmax")!.kind).toBe("primer");
    expect(() => validateAliasProposals({ pairs: [{ a: "Dot product", b: "Scaler product", why: "typo" }] }, names, decided)).toThrow(IntegrityError);
    const kept = validateAliasProposals(
      {
        pairs: [
          { a: "Dot product", b: "Scalar product", why: "Both multiply matching entries and add them up." },
          { a: "Scalar product", b: "Dot product", why: "Again." },
          { a: "Dot product", b: "Embedding vector", why: "Already decided." },
        ],
      },
      names,
      decided,
    );
    expect(kept.map((item) => [item.a.term, item.b.term])).toEqual([["Dot product", "Scalar product"]]);
  });
});

describe("the concept alias endpoints", () => {
  let workspace: string;
  let previous: string | undefined;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-aliases-api-"));
    previous = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
    state.answers = [];
    state.prompts = [];
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TRACE_DATA_DIR;
    else process.env.TRACE_DATA_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  });

  const put = (body: unknown) => PUT(new Request("http://127.0.0.1/api/library/aliases", { method: "PUT", body: JSON.stringify(body) }));

  it("records the reader's decisions, only between names of the library, and survives a damaged file", async () => {
    await saveStoredProject(english);
    await saveStoredProject(second());
    expect((await put({ a: "Dot product", b: "Quantum gravity", decision: "same" })).status).toBe(404);
    const saved = await put({ a: "Dot product", b: "Scalar product", decision: "same" });
    expect(saved.status).toBe(200);
    const listed = (await (await GET()).json()) as AliasFile & { names: string[] };
    expect(listed.decisions).toMatchObject([{ terms: ["Dot product", "Scalar product"], decision: "same", proposedBy: "reader" }]);
    expect(listed.names).toContain("Scalar product");

    const library = join(workspace, "library");
    writeFileSync(join(library, "aliases.json"), "{ broken");
    expect((await put({ a: "Softmax", b: "Scalar product", decision: "different" })).status).toBe(200);
    expect(readdirSync(library).some((name) => name.startsWith("aliases.damaged-"))).toBe(true);
    expect(JSON.parse(readFileSync(join(library, "aliases.json"), "utf8")).decisions).toHaveLength(1);
    expect((await put({ a: "Softmax", b: "Scalar product", decision: "forget" })).status).toBe(200);
  });

  it("asks a model for pairs with the names and definitions only, and returns the checked ones", async () => {
    await saveStoredProject(english);
    await saveStoredProject(second());
    state.answers = [
      { pairs: [{ a: "Dot product", b: "Scalar produkt", why: "misspelt" }] },
      { pairs: [{ a: "Dot product", b: "Scalar product", why: "Both multiply matching entries and add them up." }] },
    ];
    const response = await PROPOSE(new Request("http://127.0.0.1/api/library/aliases/propose", {
      method: "POST",
      body: JSON.stringify({ assignment: { provider: "gemini", model: "gemini-3.7-flash" }, apiKey: "key" }),
    }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { proposals: Array<{ a: { term: string; paper: string }; b: { term: string } }> };
    expect(body.proposals.map((item) => [item.a.term, item.b.term])).toEqual([["Dot product", "Scalar product"]]);
    expect(state.prompts).toHaveLength(2);
    expect(state.prompts[0]).toContain('"Scalar product" (A second paper)');
    expect(state.prompts[1]).toContain("is not one of the listed names");
    // Hiçbir şey kaydedilmedi: onay okuyucunun.
    expect(existsSync(join(workspace, "library", "aliases.json"))).toBe(false);
  });
});

describe("concept aliases for agents", () => {
  it("lists the names and records a decision only when asked to", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const workspace = mkdtempSync(join(tmpdir(), "trace-aliases-bridge-"));
    try {
      const library = join(workspace, "data", "library");
      spawnSync("mkdir", ["-p", library]);
      writeFileSync(join(library, "english.trace.json"), JSON.stringify(english));
      writeFileSync(join(library, "second.trace.json"), JSON.stringify(second()));
      writeFileSync(join(workspace, "paper.trace.json"), JSON.stringify(english));
      const bridge = (...args: string[]) =>
        spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), ...args], {
          encoding: "utf8",
          env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data") },
        });
      const names = JSON.parse(bridge("concepts", "--names").stdout) as { names: Array<{ term: string }>; decided: unknown[] };
      expect(names.names.map((item) => item.term)).toContain("Scalar product");
      expect(names.decided).toEqual([]);

      const dotElsewhere = () =>
        (JSON.parse(bridge("concepts", "--project", join(workspace, "paper.trace.json")).stdout) as { concepts: Array<{ conceptId: string; alsoIn: unknown[] }> }).concepts.find(
          (item) => item.conceptId === "dot-product",
        )!.alsoIn.length;
      expect(dotElsewhere()).toBe(0);
      const linked = bridge("alias", "--a", "Dot product", "--b", "Scalar product", "--proposed-by", "model", "--reason", "Same operation.");
      expect(linked.status).toBe(0);
      expect(JSON.parse(linked.stdout)).toMatchObject({ ok: true, decision: "same", linked: [["Dot product", "Scalar product"]] });
      expect(dotElsewhere()).toBe(1);
      expect(bridge("alias", "--a", "Dot product", "--b", "Nothing like it").status).toBe(1);
      expect(bridge("alias", "--a", "Dot product", "--b", "Scalar product", "--forget").status).toBe(0);
      expect(dotElsewhere()).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
