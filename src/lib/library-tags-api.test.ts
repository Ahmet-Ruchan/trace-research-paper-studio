import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/library/tags/route";
import { loadExampleProject } from "./example-fixture";
import { saveStoredProject } from "./trace-storage";

/** Kütüphane görünümünün etiket uçları, sunucu başlatmadan. */
let workspace: string;
let previousDataDirectory: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-tags-api-"));
  previousDataDirectory = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = workspace;
});

afterEach(() => {
  if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previousDataDirectory;
  rmSync(workspace, { recursive: true, force: true });
});

const base = "http://127.0.0.1/api/library/tags";
const put = (query: string, body: unknown) =>
  PUT(new Request(`${base}${query}`, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("library tags API", () => {
  it("saves a cleaned tag list and lists it", async () => {
    await saveStoredProject({ ...loadExampleProject(), id: "api-tags" });

    const saved = await put("?id=api-tags", { tags: ["#Transformers", "transformers", " to  read "] });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("Cache-Control")).toBe("no-store");
    expect(await saved.json()).toEqual({ ok: true, tags: ["Transformers", "to read"] });

    expect(await (await GET()).json()).toEqual({
      version: 1,
      projects: [{ id: "api-tags", tags: ["Transformers", "to read"] }],
    });
  });

  it("refuses a paper that is not in the library", async () => {
    const response = await put("?id=nowhere", { tags: ["NLP"] });
    expect(response.status).toBe(404);
    expect((await GET().then((result) => result.json())).projects).toEqual([]);
  });

  it("explains a bad request", async () => {
    await saveStoredProject({ ...loadExampleProject(), id: "api-tags" });
    expect((await put("", { tags: ["NLP"] })).status).toBe(400);
    expect((await put("?id=api-tags", "{")).status).toBe(400);
    expect((await put("?id=api-tags", { tags: "NLP" })).status).toBe(400);

    const long = await put("?id=api-tags", { tags: ["x".repeat(41)] });
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe("A tag can be at most 40 characters.");

    expect((await put("?id=api-tags", { tags: ["x".repeat(20_000)] })).status).toBe(413);
  });
});
