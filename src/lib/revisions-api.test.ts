import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUT } from "@/app/api/library/route";
import { GET, POST } from "@/app/api/library/revisions/route";
import { loadExampleProject } from "./example-fixture";

/** Geçmiş panelinin konuştuğu uçlar, sunucu başlatmadan. */
let workspace: string;
let previousDataDirectory: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-revisions-api-"));
  previousDataDirectory = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = workspace;
});

afterEach(() => {
  if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previousDataDirectory;
  rmSync(workspace, { recursive: true, force: true });
});

const base = "http://127.0.0.1/api/library";
const put = (body: unknown, query = "") =>
  PUT(new Request(`${base}${query}`, { method: "PUT", body: JSON.stringify(body) }));

describe("revisions API", () => {
  it("saves with a reason, lists, loads and marks versions", async () => {
    const project = { ...loadExampleProject(), id: "api-history" };
    expect((await put(project)).status).toBe(200);
    expect((await put({ ...project, story: { ...project.story, title: "Regenerated" } }, "?reason=regenerate")).status).toBe(200);

    const listed = await (await GET(new Request(`${base}/revisions?id=api-history`))).json();
    expect(listed.revisions).toHaveLength(1);
    expect(listed.revisions[0]).toMatchObject({ reason: "regenerate", title: project.story.title });

    const loaded = await GET(new Request(`${base}/revisions?id=api-history&revision=${listed.revisions[0].id}`));
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).project.story.title).toBe(project.story.title);

    const marked = await POST(new Request(`${base}/revisions?id=api-history`, { method: "POST", body: JSON.stringify({ label: "Checkpoint" }) }));
    expect((await marked.json()).revision).toMatchObject({ reason: "manual", label: "Checkpoint", title: "Regenerated" });
  });

  it("rejects an unknown reason and malformed ids", async () => {
    const project = { ...loadExampleProject(), id: "api-history" };
    expect((await put(project, "?reason=whatever")).status).toBe(400);
    expect((await GET(new Request(`${base}/revisions`))).status).toBe(400);
    expect((await GET(new Request(`${base}/revisions?id=api-history&revision=..%2F..%2Fx`))).status).toBe(400);
    expect((await GET(new Request(`${base}/revisions?id=api-history&revision=20260916T081530123Z-edit-aaaaaaaa`))).status).toBe(404);
    expect((await POST(new Request(`${base}/revisions?id=never-saved`, { method: "POST" }))).status).toBe(404);
  });
});
