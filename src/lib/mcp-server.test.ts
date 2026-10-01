import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";

/**
 * MCP sunucusu (`trace-mcp.mjs`) gerçek bir süreç olarak: stdin'e satır
 * satır JSON-RPC, stdout'tan yanıtlar. Kütüphane geçici bir veri dizininde.
 * Üç ajanın sunucuyu başlatan kayıtları da burada denetleniyor.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const PLUGIN = join(root, "plugins/trace-paper-studio");
const SERVER = join(PLUGIN, "skills/trace-paper-studio/scripts/trace-mcp.mjs");

let workspace: string;
type Reply = { jsonrpc: "2.0"; id: number | null; result?: Record<string, unknown> & { content?: Array<{ text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> }; error?: { code: number; message: string } };

function session(...messages: unknown[]): Reply[] {
  const input = messages.map((message) => (typeof message === "string" ? message : JSON.stringify(message))).join("\n") + "\n";
  const run = spawnSync(process.execPath, [SERVER], { input, encoding: "utf8", env: { ...process.env, TRACE_DATA_DIR: workspace, TRACE_LIBRARY_DIR: "" }, timeout: 30_000 });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Reply);
}

const init = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
const call = (id: number, name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const structured = (reply: Reply | undefined) => reply?.result?.structuredContent as Record<string, unknown>;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-mcp-"));
  const library = join(workspace, "library");
  mkdirSync(library, { recursive: true });
  const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
  writeFileSync(join(library, "attention.trace.json"), JSON.stringify(example));
  const at = new Date().toISOString();
  writeFileSync(join(library, "notes.json"), JSON.stringify({ version: 1, projects: [{ id: example.id, notes: [{ id: "n1", target: { kind: "claim", claimId: example.evidence.claims[0].id }, text: "Seminar question.", createdAt: at, updatedAt: at }] }] }));
  writeFileSync(join(library, "tags.json"), JSON.stringify({ version: 1, projects: [{ id: example.id, tags: ["NLP"] }] }));
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe("the Trace MCP server", () => {
  it("answers initialize with the version it was asked for, and lists its tools", () => {
    const [hello, tools] = session(init, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(hello.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "trace" } });
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    expect((hello.result!.serverInfo as { version: string }).version).toBe(pkg.version);
    // Bilinmeyen bir sürüm istenirse en yenisi.
    expect(session({ ...init, params: { ...init.params, protocolVersion: "1999-01-01" } })[0].result!.protocolVersion).toBe("2025-11-25");
    const names = (tools.result!.tools as Array<{ name: string; inputSchema: { type: string } }>).map((tool) => tool.name);
    expect(names).toEqual(["library", "paper", "search_claims", "notes", "reading_list", "save_to_reading_list", "remove_from_reading_list", "today"]);
    for (const tool of tools.result!.tools as Array<{ inputSchema: { type: string } }>) expect(tool.inputSchema.type).toBe("object");
  });

  it("reads the library, a paper, the claims and the reader's notes from the data directory", () => {
    const replies = session(init, call(1, "library"), call(2, "paper", { title: "attention", include_claims: true, claim_limit: 2 }), call(3, "search_claims", { query: "BLEU", limit: 3 }), call(4, "notes", { query: "seminar" }));
    expect(structured(replies[1])).toMatchObject({ papers: 1, results: [{ tags: ["NLP"], notes: 1 }] });
    expect(JSON.parse(replies[1].result!.content![0].text)).toEqual(structured(replies[1]));
    expect((structured(replies[2]).claimList as unknown[]).length).toBe(2);
    expect(structured(replies[3])).toMatchObject({ shown: 3, hits: expect.arrayContaining([expect.objectContaining({ page: expect.any(Number) })]) });
    expect(structured(replies[4])).toMatchObject({ total: 1, notes: [{ note: "Seminar question.", place: "Claim" }] });
  });

  it("saves to and removes from the reading list in the studio's file, and gives the day", () => {
    const [, saved, again, list, removed, day] = session(
      init,
      call(1, "save_to_reading_list", { title: "Layer Normalization", identifier: "arxiv:1607.06450", year: 2016, paper_id: "attention-is-all-you-need-en", relation: "reference" }),
      call(2, "save_to_reading_list", { title: "Layer Normalization", identifier: "arxiv:1607.06450v2" }),
      call(3, "reading_list"),
      call(4, "remove_from_reading_list", { id: "arxiv:1607.06450" }),
      call(5, "today"),
    );
    expect(structured(saved)).toMatchObject({ added: "arxiv:1607.06450", saved: 1 });
    // Aynı çalışma ikinci kez eklenmiyor.
    expect(structured(again)).toMatchObject({ saved: 1 });
    expect(JSON.stringify(structured(list))).toContain("Layer Normalization");
    expect(structured(removed)).toMatchObject({ removed: "arxiv:1607.06450", saved: 0 });
    expect(structured(day)).toMatchObject({ ok: true, review: expect.anything(), work: expect.anything() });
    expect(existsSync(join(workspace, "library", "reading-list.json"))).toBe(true);
  });

  it("reports a tool's own errors as a result, and protocol errors as errors", () => {
    const replies = session(
      init,
      call(1, "paper", { id: "missing" }),
      call(2, "search_claims", { query: "x" }),
      call(3, "save_to_reading_list", { title: "A work", url: "javascript:alert(1)" }),
      call(4, "library", { unknown: 1 }),
      call(5, "no_such_tool"),
      { jsonrpc: "2.0", id: 6, method: "resources/list" },
      "{ not json",
      { jsonrpc: "2.0", id: 7, method: "ping" },
    );
    const byId = new Map(replies.map((reply) => [reply.id, reply]));
    expect(byId.get(1)!.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('No paper with the id "missing"') }] });
    expect(byId.get(2)!.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("Invalid arguments: query") }] });
    expect(byId.get(3)!.result!.isError).toBe(true);
    expect(byId.get(4)!.result!.isError).toBe(true);
    expect(byId.get(5)!.error).toMatchObject({ code: -32602 });
    expect(byId.get(6)!.error).toMatchObject({ code: -32601 });
    expect(byId.get(null)!.error).toMatchObject({ code: -32700 });
    expect(byId.get(7)!.result).toEqual({});
    // Her isteğe, bozuk satır dahil, tek yanıt.
    expect(replies).toHaveLength(9);
    expect(existsSync(join(workspace, "library", "reading-list.json"))).toBe(false);
  });
});

describe("how each agent starts the server", () => {
  const read = (path: string) => JSON.parse(readFileSync(join(PLUGIN, path), "utf8")) as Record<string, unknown>;
  const script = "skills/trace-paper-studio/scripts/trace-mcp.mjs";

  it("Claude Code: .mcp.json at the plugin root, by the plugin's own path", () => {
    expect(read(".mcp.json")).toEqual({ mcpServers: { trace: { command: "node", args: [`\${CLAUDE_PLUGIN_ROOT}/${script}`] } } });
  });

  it("Codex: the manifest points to its own file, run from the scripts folder (Codex does not expand Claude's variable)", () => {
    const manifest = read(".codex-plugin/plugin.json");
    expect(manifest.mcpServers).toBe("./codex-mcp.json");
    const server = (read("codex-mcp.json").mcpServers as Record<string, { command: string; args: string[]; cwd: string }>).trace;
    expect(server).toEqual({ command: "node", args: ["trace-mcp.mjs"], cwd: "./skills/trace-paper-studio/scripts" });
    expect(existsSync(join(PLUGIN, server.cwd, server.args[0]))).toBe(true);
  });

  it("Antigravity: mcp_config.json at the plugin root, with ${PLUGIN_ROOT}", () => {
    expect(read("mcp_config.json")).toEqual({ mcpServers: { trace: { command: "node", args: [`\${PLUGIN_ROOT}/${script}`] } } });
    expect(existsSync(join(PLUGIN, script))).toBe(true);
  });
});
