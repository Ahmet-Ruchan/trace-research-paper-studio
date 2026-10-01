import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/reading-list/share/route";
import { GET as page } from "@/app/r/[id]/route";
import { loadExampleProject } from "./example-fixture";
import { readingItemSchema, workKey, type ReadingItem } from "./reading-list";
import { readingOrder } from "./reading-order";
import { readingShareHtml, readingShareState, readingShareWorks, workLink, type ReadingShare } from "./reading-share";
import type { ResearchProject } from "./schema";
import { saveStoredProject, updateReadingList } from "./trace-storage";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const project: ResearchProject = { ...example, id: "attention" };
const at = "2026-09-30T10:00:00.000Z";
const item = (title: string, patch: Partial<ReadingItem> = {}): ReadingItem => readingItemSchema.parse({ id: workKey({ title, identifier: patch.identifier }), title, addedAt: at, ...patch });
const bahdanau = item("Neural Machine Translation by Jointly Learning to Align and Translate", { identifier: "arxiv:1409.0473", authors: ["Dzmitry Bahdanau", "Kyunghyun Cho", "Yoshua Bengio"], year: 2014, from: [{ projectId: "attention", relation: "reference" }] });
const lstm = item("Long Short-Term Memory <b>", { identifier: "10.1162/neco.1997.9.8.1735" });

describe("sharing the reading list", () => {
  it("links each work to its own address, arXiv or DOI", () => {
    expect(workLink({ identifier: "arXiv:1409.0473" })).toBe("https://arxiv.org/abs/1409.0473");
    expect(workLink({ identifier: "doi:10.1162/neco.1997.9.8.1735" })).toBe("https://doi.org/10.1162/neco.1997.9.8.1735");
    expect(workLink({ identifier: "10.1162/neco.1997.9.8.1735" })).toBe("https://doi.org/10.1162/neco.1997.9.8.1735");
    expect(workLink({ url: "https://example.org/paper", identifier: "arxiv:1" })).toBe("https://example.org/paper");
    expect(workLink({ identifier: "Some title" })).toBeUndefined();
  });

  it("shares the works with their reasons, and the library papers only when asked", () => {
    const order = readingOrder([project], new Map());
    const without = readingShareWorks(order, [bahdanau, lstm], [project], false);
    expect(without.map((work) => [work.kind, work.title])).toEqual([["saved", bahdanau.title], ["saved", lstm.title]]);
    expect(without[0]).toMatchObject({ link: "https://arxiv.org/abs/1409.0473", year: "2014", why: `${example.evidence.paper.title} builds on it.` });
    const withPapers = readingShareWorks(order, [bahdanau, item(example.evidence.paper.title, { identifier: "arxiv:1706.03762" })], [project], true);
    expect(withPapers.map((work) => work.kind)).toEqual(["saved", "paper"]);
    expect(withPapers[1]).toMatchObject({ title: example.evidence.paper.title, why: "On the list, and already analysed." });
  });

  it("writes a page without scripts, escaping what the list says", () => {
    const share: ReadingShare = { version: 1, id: "0123456789abcdef0123", title: "Seminar <list>", createdAt: at, updatedAt: at, status: "live", expiresAt: null, includePapers: false, works: readingShareWorks(readingOrder([], new Map()), [lstm, item("Bad link", { url: "https://x.org/a\"onmouseover=\"y" })], [], false) };
    const html = readingShareHtml(share);
    expect(html).toContain("<h1>Seminar &lt;list&gt;</h1>");
    expect(html).toContain("Long Short-Term Memory &lt;b&gt;");
    expect(html).toContain('href="https://doi.org/10.1162/neco.1997.9.8.1735"');
    expect(html).not.toMatch(/<script|onmouseover="/i);
    expect(html).toContain("no notes and no reading progress");
    expect(readingShareState({ status: "live", expiresAt: "2026-09-01T00:00:00.000Z" }, at)).toBe("expired");
    expect(readingShareState({ status: "unpublished", expiresAt: null }, at)).toBe("unpublished");
  });
});

describe("the shared list's link", () => {
  let workspace: string;
  let previous: string | undefined;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-share-"));
    previous = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TRACE_DATA_DIR;
    else process.env.TRACE_DATA_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  });
  const request = (method: string, query = "", body?: unknown) => new Request(`http://127.0.0.1/api/reading-list/share${query}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const open = async (id: string) => page(new Request(`http://127.0.0.1/r/${id}`), { params: Promise.resolve({ id }) });

  it("refuses an empty list, then shares a copy that stays as it was until updated, and can be taken down", async () => {
    expect((await POST(request("POST", "", {}))).status).toBe(400);
    await saveStoredProject(project);
    await updateReadingList(() => [bahdanau]);
    const created = (await (await POST(request("POST", "", { title: "Seminar reading", expiresInDays: 30 }))).json()) as { share: { id: string; path: string; count: number; state: string; expiresAt: string } };
    expect(created.share).toMatchObject({ path: `/r/${created.share.id}`, count: 1, state: "live" });
    expect(Date.parse(created.share.expiresAt)).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const shown = await open(created.share.id);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(await shown.text()).toContain(bahdanau.title);

    // Kopya: listeye eklenen çalışma güncellenene kadar sayfada yok.
    await updateReadingList((items) => [...items, lstm]);
    expect(await (await open(created.share.id)).text()).not.toContain("Long Short-Term Memory");
    await PATCH(request("PATCH", `?id=${created.share.id}`, { refresh: true }));
    expect(await (await open(created.share.id)).text()).toContain("Long Short-Term Memory");

    await PATCH(request("PATCH", `?id=${created.share.id}`, { status: "unpublished" }));
    expect((await open(created.share.id)).status).toBe(404);
    expect(((await (await GET()).json()) as { shares: Array<{ state: string }> }).shares.map((share) => share.state)).toEqual(["unpublished"]);
    expect((await DELETE(request("DELETE", `?id=${created.share.id}`))).status).toBe(200);
    expect((await DELETE(request("DELETE", `?id=${created.share.id}`))).status).toBe(404);
    expect((await open("not-an-id")).status).toBe(404);
  });
});
