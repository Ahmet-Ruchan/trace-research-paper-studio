import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/publications/route";
import { GET as readPage } from "@/app/p/[id]/route";
import { loadExampleProject } from "./example-fixture";
import {
  defaultPublicationInclude,
  expiryFromDays,
  projectContentFingerprint,
  projectForPublication,
  publicationState,
} from "./publications";
import type { ResearchProject } from "./schema";
import { deleteStoredProject, saveStoredProject } from "./trace-storage";

const fresh = (): ResearchProject => ({ ...structuredClone(loadExampleProject()), id: "publish-test" });

describe("what a publication contains", () => {
  it("removes unchosen blocks from the copy itself, never the evidence", () => {
    const project = fresh();
    const copy = projectForPublication(project, { deepReport: false, technicalAppendix: false, learning: false, figures: false });
    expect(copy.deepReport).toBeUndefined();
    expect(copy.technicalAppendix).toBeUndefined();
    expect(copy.primer ?? copy.quiz ?? copy.interactives ?? copy.derivations ?? copy.applicationGuide).toBeUndefined();
    expect(copy.figures).toBeUndefined();
    expect(copy.generation).toBeUndefined();
    expect(copy.evidence).toEqual(project.evidence);
    const serialized = JSON.stringify(copy);
    expect(serialized).not.toContain(project.deepReport!.sections[0].analysis[0]);
    // Girdi projeye dokunulmaz.
    expect(project.deepReport).toBeDefined();
  });

  it("drops links to equations that are no longer published", () => {
    const project = fresh();
    expect(project.derivations?.some((derivation) => derivation.equationId)).toBe(true);
    const copy = projectForPublication(project, { ...defaultPublicationInclude, technicalAppendix: false });
    expect(copy.derivations?.length).toBe(project.derivations?.length);
    expect(copy.derivations?.some((derivation) => derivation.equationId)).toBe(false);
  });

  it("knows when a link stops working", () => {
    const now = "2026-09-16T08:00:00.000Z";
    const expiresAt = expiryFromDays(7, now);
    expect(expiresAt).toBe("2026-09-23T08:00:00.000Z");
    expect(publicationState({ status: "live", settings: { include: defaultPublicationInclude, expiresAt } }, now)).toBe("live");
    expect(publicationState({ status: "live", settings: { include: defaultPublicationInclude, expiresAt } }, expiresAt!)).toBe("expired");
    expect(publicationState({ status: "unpublished", settings: { include: defaultPublicationInclude, expiresAt: null } }, now)).toBe("unpublished");
  });
});

describe("publishing through the studio", () => {
  let workspace: string;
  let previousDataDirectory: string | undefined;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "trace-publications-"));
    previousDataDirectory = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
  });

  afterEach(() => {
    if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
    else process.env.TRACE_DATA_DIR = previousDataDirectory;
    rmSync(workspace, { recursive: true, force: true });
  });

  const api = "http://127.0.0.1/api/publications";
  const publish = (settings = { include: defaultPublicationInclude, expiresAt: null as string | null }) =>
    POST(new Request(api, { method: "POST", body: JSON.stringify({ projectId: "publish-test", settings }) }));
  const page = (id: string) => readPage(new Request(`http://127.0.0.1/p/${id}`), { params: Promise.resolve({ id }) });
  const patch = (id: string, body: unknown) => PATCH(new Request(`${api}?id=${id}`, { method: "PATCH", body: JSON.stringify(body) }));

  it("refuses to publish a project that is not in the library", async () => {
    expect((await publish()).status).toBe(404);
  });

  it("serves a live copy with safe headers, and nothing once unpublished", async () => {
    await saveStoredProject(fresh());
    const { publication } = await (await publish()).json();
    expect(publication.path).toBe(`/p/${publication.id}`);
    expect(publication.id).toMatch(/^[a-f0-9]{20}$/);

    const live = await page(publication.id);
    expect(live.status).toBe(200);
    expect(live.headers.get("x-robots-tag")).toContain("noindex");
    expect(live.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(await live.text()).toContain(fresh().story.title);

    const missing = await (await page("0123456789abcdef0123")).text();
    await patch(publication.id, { status: "unpublished" });
    const unpublished = await page(publication.id);
    expect(unpublished.status).toBe(404);
    // Kaldırılmış ve hiç var olmamış bağlantı ayırt edilemez.
    expect(await unpublished.text()).toBe(missing);

    await patch(publication.id, { status: "live" });
    expect((await page(publication.id)).status).toBe(200);
  });

  it("stops serving an expired link", async () => {
    await saveStoredProject(fresh());
    const { publication } = await (await publish({ include: defaultPublicationInclude, expiresAt: "2020-01-01T00:00:00.000Z" })).json();
    expect(publication.state).toBe("expired");
    expect((await page(publication.id)).status).toBe(404);
  });

  it("keeps later edits private until the author updates the link", async () => {
    await saveStoredProject(fresh());
    const { publication } = await (await publish()).json();
    // Yalnızca açmak (zaman damgası) içeriği değiştirmez.
    expect(publication.contentFingerprint).toBe(projectContentFingerprint({ ...fresh(), updatedAt: "2030-01-01T00:00:00.000Z" }));
    await saveStoredProject({ ...fresh(), story: { ...fresh().story, title: "Edited after publishing" } });

    expect(await (await page(publication.id)).text()).not.toContain("Edited after publishing");
    const listed = await (await GET(new Request(`${api}?projectId=publish-test`))).json();
    expect(listed.publications[0].publishedFrom).toBe(fresh().updatedAt);

    const refreshed = await (await patch(publication.id, { refresh: true })).json();
    expect(await (await page(publication.id)).text()).toContain("Edited after publishing");
    expect(refreshed.publication.contentFingerprint).not.toBe(publication.contentFingerprint);
  });

  it("applies narrower controls to the published copy", async () => {
    await saveStoredProject(fresh());
    const { publication } = await (await publish()).json();
    const analysis = fresh().deepReport!.sections[0].analysis[0];
    const escaped = JSON.stringify(analysis).slice(1, 40).replaceAll("<", "\\u003c");
    expect(await (await page(publication.id)).text()).toContain(escaped);

    await patch(publication.id, { settings: { include: { ...defaultPublicationInclude, deepReport: false }, expiresAt: null } });
    expect(await (await page(publication.id)).text()).not.toContain(escaped);
  });

  it("closes a project's links when the project is removed", async () => {
    await saveStoredProject(fresh());
    const { publication } = await (await publish()).json();
    await deleteStoredProject("publish-test");
    expect((await page(publication.id)).status).toBe(404);
    const listed = await (await GET(new Request(`${api}?projectId=publish-test`))).json();
    expect(listed.publications).toEqual([]);
  });

  it("rejects malformed ids and requests", async () => {
    expect((await patch("../../x", { status: "live" })).status).toBe(400);
    expect((await DELETE(new Request(`${api}?id=nope`, { method: "DELETE" }))).status).toBe(400);
    expect((await page("../../library")).status).toBe(404);
    expect((await POST(new Request(api, { method: "POST", body: JSON.stringify({ projectId: "publish-test" }) }))).status).toBe(400);
    expect((await GET(new Request(api))).status).toBe(400);
  });
});

describe("publishing through the agent bridge", () => {
  it("writes a publication the studio serves", async () => {
    const { spawnSync } = await import("node:child_process");
    const { writeFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const workspace = mkdtempSync(join(tmpdir(), "trace-publish-bridge-"));
    const previous = process.env.TRACE_DATA_DIR;
    process.env.TRACE_DATA_DIR = workspace;
    try {
      const projectPath = join(workspace, "paper.trace.json");
      writeFileSync(projectPath, JSON.stringify(fresh()));
      const bridge = fileURLToPath(new URL("../../plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs", import.meta.url));
      const run = spawnSync(process.execPath, [bridge, "publish", "--project", projectPath, "--no-figures", "--expires-days", "30", "--app-url", "http://127.0.0.1:9"], {
        encoding: "utf8",
        env: { ...process.env, TRACE_DATA_DIR: workspace },
      });
      expect(run.status).toBe(0);
      const output = JSON.parse(run.stdout);
      expect(output.excluded).toEqual(["figures"]);
      expect(output.url).toBeUndefined();

      const served = await readPage(new Request(`http://127.0.0.1${output.path}`), { params: Promise.resolve({ id: output.id }) });
      expect(served.status).toBe(200);
      expect(await served.text()).toContain(fresh().story.title);

      const bad = spawnSync(process.execPath, [bridge, "publish", "--project", projectPath, "--expires-days", "5"], { encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace } });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/--expires-days must be 7, 30 or 90/);
    } finally {
      if (previous === undefined) delete process.env.TRACE_DATA_DIR;
      else process.env.TRACE_DATA_DIR = previous;
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
