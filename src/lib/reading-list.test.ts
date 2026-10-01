import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "@/app/api/library/reading-list/route";
import { loadExampleProject } from "./example-fixture";
import {
  addToReadingList,
  MAX_READING_ITEMS,
  mergeReadingOrder,
  parseReadingList,
  readingItemSchema,
  removeFromReadingList,
  savedFrom,
  savedReason,
  workKey,
  type ReadingItem,
} from "./reading-list";
import type { ReadingOrder } from "./reading-order";
import type { ResearchProject } from "./schema";
import { readReadingList, updateReadingList } from "./trace-storage";

const at = "2026-09-30T10:00:00.000Z";
const paper = (id: string, title: string, year = "2020"): ResearchProject => {
  const project = loadExampleProject("attention-is-all-you-need.en.trace.json");
  return { ...project, id, evidence: { ...project.evidence, paper: { ...project.evidence.paper, title, year, doi: undefined } } };
};
const item = (title: string, from: ReadingItem["from"], patch: Partial<ReadingItem> = {}): ReadingItem =>
  readingItemSchema.parse({ id: workKey({ title, identifier: patch.identifier }), title, from, addedAt: at, ...patch });

describe("the reading list", () => {
  it("knows one work by its arXiv number, its DOI or its title, however it is written", () => {
    expect(workKey({ title: "X", identifier: "arXiv:1706.03762v5" })).toBe("arxiv:1706.03762");
    expect(workKey({ title: "X", identifier: "https://doi.org/10.1162/NECO.1997.9.8.1735" })).toBe("doi:10.1162/neco.1997.9.8.1735");
    expect(workKey({ title: "X", doi: "10.1162/neco.1997.9.8.1735" })).toBe("doi:10.1162/neco.1997.9.8.1735");
    // Atıf grafiğinde DOI de olsa arXiv önce: kavram önerisi aynı çalışmayı yalnızca arXiv ile veriyor.
    expect(workKey({ title: "X", identifier: "arxiv:1409.0473", doi: "10.48550/arXiv.1409.0473" })).toBe(workKey({ title: "Other", identifier: "arxiv:1409.0473" }));
    expect(workKey({ title: "Long Short-Term Memory" })).toBe(workKey({ title: "long short term memory" }));
  });

  it("merges a work saved twice, keeps its place, and refuses a list past its limit", () => {
    const first = item("Neural Machine Translation", [{ projectId: "a", relation: "reference" }], { identifier: "arxiv:1409.0473" });
    const again = item("Neural Machine Translation by Jointly Learning to Align and Translate", [{ projectId: "a", relation: "reference" }, { projectId: "b", relation: "concept", concept: "Attention" }], { identifier: "arxiv:1409.0473", year: 2014 });
    const list = addToReadingList(addToReadingList([], first), item("Another", []));
    const merged = addToReadingList(list, { ...again, addedAt: "2027-01-01T00:00:00.000Z" });
    expect(merged.map((entry) => entry.title)).toEqual(["Neural Machine Translation by Jointly Learning to Align and Translate", "Another"]);
    expect(merged[0]).toMatchObject({ year: 2014, addedAt: at, from: [{ projectId: "a", relation: "reference" }, { projectId: "b", relation: "concept", concept: "Attention" }] });
    expect(removeFromReadingList(merged, merged[1].id)).toHaveLength(1);
    const full = Array.from({ length: MAX_READING_ITEMS }, (_, index) => item(`Paper ${index}`, []));
    expect(() => addToReadingList(full, item("One more", []))).toThrow("at most 500");
  });

  it("keeps only web addresses and drops a damaged entry", () => {
    expect(readingItemSchema.safeParse({ ...item("A", []), url: "javascript:alert(1)" }).success).toBe(false);
    expect(parseReadingList({ version: 1, items: [item("A", []), { id: "broken" }] }).map((entry) => entry.title)).toEqual(["A"]);
    expect(parseReadingList({ version: 2, items: [] })).toEqual([]);
  });

  it("places a saved work in the reading order: before the paper that builds on it or needs its concept, after the paper it cites", () => {
    const first = paper("first", "The first paper", "2014");
    const second = paper("second", "The second paper", "2017");
    const outside = paper("outside", "A paper outside the order");
    const owned = paper("owned", "Already analysed");
    const order: ReadingOrder = { steps: [first, second].map((project) => ({ project, status: "new", after: [], together: [] })), next: first, unconnected: 1 };
    const list = [
      item("Explains softmax", [{ projectId: "second", relation: "concept", concept: "Softmax" }, { projectId: "first", relation: "reference" }]),
      item("Cites the first", [{ projectId: "first", relation: "cited-by" }]),
      item("Builds the second", [{ projectId: "second", relation: "reference" }]),
      item("From outside", [{ projectId: "outside", relation: "reference" }]),
      item("Already analysed", [{ projectId: "first", relation: "reference" }]),
      item("From a removed paper", [{ projectId: "gone", relation: "reference" }]),
    ];
    const merged = mergeReadingOrder(order, list, [first, second, outside, owned]);
    expect(merged.entries.map((entry) => (entry.kind === "paper" ? entry.step.project.id : `+ ${entry.place.item.title}`))).toEqual([
      "+ Explains softmax",
      "first",
      "+ Cites the first",
      "+ Builds the second",
      "second",
    ]);
    expect(merged.others.map((place) => [place.item.title, place.owned?.id ?? null])).toEqual([["From outside", null], ["Already analysed", "owned"], ["From a removed paper", null]]);
    const reasons = merged.entries.flatMap((entry) => (entry.kind === "saved" && entry.place.why ? [savedReason(entry.place.why)] : []));
    expect(reasons).toEqual([
      "Before The first paper: that paper builds on it.",
      "After The first paper: it cites that paper.",
      "Before The second paper: that paper builds on it.",
    ]);
    expect(savedFrom(merged.others[0].why!)).toBe("A paper outside the order builds on it.");
    expect(savedReason({ relation: "concept", project: second, concept: "Softmax" })).toBe("Before The second paper: it explains Softmax, which that paper assumes.");
  });
});

describe("the reading list file and its API", () => {
  let workspace: string;
  let previous: string | undefined;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-reading-"));
    previous = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TRACE_DATA_DIR;
    else process.env.TRACE_DATA_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1/api/library/reading-list";
  const post = (body: unknown) => POST(new Request(base, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("adds, merges and removes works, next to the library", async () => {
    const saved = item("Long Short-Term Memory", [{ projectId: "a", relation: "concept", concept: "LSTM" }], { url: "https://doi.org/10.1162/neco.1997.9.8.1735" });
    expect((await post({ item: saved })).status).toBe(200);
    const again = await post({ item: { ...saved, from: [{ projectId: "b", relation: "reference" }] } });
    expect(((await again.json()) as { items: ReadingItem[] }).items[0].from).toHaveLength(2);
    expect(((await (await GET()).json()) as { items: ReadingItem[] }).items.map((entry) => entry.title)).toEqual(["Long Short-Term Memory"]);
    const removed = await DELETE(new Request(`${base}?id=${encodeURIComponent(saved.id)}`, { method: "DELETE" }));
    expect(((await removed.json()) as { items: ReadingItem[] }).items).toEqual([]);
    expect(readdirSync(join(workspace, "library"))).toContain("reading-list.json");
  });

  it("adds many works at once from an import, all or none", async () => {
    const many = Array.from({ length: 300 }, (_, index) => item(`Imported work number ${index} with a long enough title to fill the body`, []));
    const response = await post({ items: many });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { items: ReadingItem[] }).items).toHaveLength(300);
    // Bir kez daha: aynı çalışmalar birleşiyor, liste büyümüyor.
    expect(((await (await post({ items: many.slice(0, 10) })).json()) as { items: ReadingItem[] }).items).toHaveLength(300);
    // Sığmayan bir içe aktarma hiçbir şey eklemiyor.
    const tooMany = Array.from({ length: MAX_READING_ITEMS - 299 }, (_, index) => item(`Another ${index}`, []));
    const refused = await post({ items: tooMany });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe(`The reading list holds at most ${MAX_READING_ITEMS} papers; ${MAX_READING_ITEMS - 300} more fit.`);
    expect(await readReadingList()).toHaveLength(300);
    // Tek bir çalışmanın sınırı büyük bir gövdeye izin vermiyor.
    expect((await post({ item: { ...many[0], title: "x".repeat(40_000) } })).status).toBe(413);
  });

  it("explains a bad request and sets a damaged file aside", async () => {
    expect((await post("{")).status).toBe(400);
    expect((await post({ item: { title: "No id" } })).status).toBe(400);
    expect((await DELETE(new Request(base, { method: "DELETE" }))).status).toBe(400);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(workspace, "library"), { recursive: true });
    writeFileSync(join(workspace, "library", "reading-list.json"), "{ nope");
    expect(await readReadingList()).toEqual([]);
    await updateReadingList((items) => addToReadingList(items, item("A", [])));
    expect(readdirSync(join(workspace, "library")).some((name) => name.startsWith("reading-list.damaged-"))).toBe(true);
    expect((await readReadingList()).map((entry) => entry.title)).toEqual(["A"]);
  });
});
