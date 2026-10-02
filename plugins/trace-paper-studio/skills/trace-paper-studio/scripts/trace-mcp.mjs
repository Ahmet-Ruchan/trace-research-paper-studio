#!/usr/bin/env node
/**
 * Trace'in MCP sunucusu: okuyucunun kütüphanesi, iddia araması, notları,
 * okuma listesi ve günün özeti MCP araçları olarak.
 *
 *   node trace-mcp.mjs        # stdio üzerinden JSON-RPC 2.0, satır başına bir ileti
 *
 * Eklenti üç ajanda da bunu kendiliğinden başlatıyor (Claude Code `.mcp.json`,
 * Codex `.codex-plugin/plugin.json` → `mcpServers`, Antigravity
 * `mcp_config.json`). Veriyi köprü gibi `~/.trace`'ten (`TRACE_DATA_DIR`)
 * okuyor; okuma listesine ekleme ve çıkarma stüdyonun kilidiyle yazıyor.
 * Model yok, ağ yok, bağımlılık yok: yalnızca Node ve köprünün paketi.
 *
 * stdout yalnızca protokol iletileri için; günlük stderr'e gidiyor.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { claimSearchTool, LIBRARY_MCP_TOOLS, libraryTool, notesTool, paperTool, parseLibraryTags, parseNotesFile, TraceToolError } from "./generated/validator.mjs";
import { readingListReport, readLibrary, todayReport } from "./trace-agent.mjs";

// Eklentinin sürümü; `scripts/set-version.mjs` manifestlerle birlikte yazıyor.
const SERVER_VERSION = "0.43.0";
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const stringOf = (description, max = 500) => ({ type: "string", maxLength: max, description });

/** Köprünün yaptığı işler: okuma listesi (kilitli yazma) ve günün özeti. */
const BRIDGE_TOOLS = [
  {
    name: "reading_list",
    title: "The reading list and the reading order",
    description: "The reader's reading order: the papers of the Trace library in the order to read them, with the works they saved to read later placed where they belong and why. Suggest the next unread item; a saved work can be analysed with the Trace skill.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "save_to_reading_list",
    title: "Save a work to read later",
    description: "Add a work to the reader's reading list, as the studio's Read later does. Give its title, and if known an arXiv id (arxiv:1706.03762) or DOI, the year, a link, and the library paper it came from. Saving a work that is already there only adds where it came from. Only when the reader asks.",
    inputSchema: {
      type: "object",
      properties: {
        title: stringOf("The work's title.", 500),
        identifier: stringOf("arxiv:<id> or a DOI, if known.", 600),
        url: stringOf("An http(s) link to the work.", 600),
        year: { type: "integer", minimum: 1000, maximum: 3000, description: "The year it came out." },
        paper_id: stringOf("The library paper it came from, if any.", 200),
        relation: { type: "string", enum: ["reference", "cited-by", "concept"], description: "How it relates to that paper: one it cites, one that cites it, or one that explains a concept it assumes." },
        concept: stringOf("With relation concept: the concept it explains.", 200),
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "remove_from_reading_list",
    title: "Take a work off the reading list",
    description: "Remove one saved work from the reader's reading list by its id (from reading_list). Only when the reader asks.",
    inputSchema: { type: "object", properties: { id: stringOf("The saved work's id, from reading_list.", 600) }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "today",
    title: "The reader's day",
    description: "The reader's day in Trace: review cards due, the paper to continue studying, what to read next, the time worked today and this week against last week and the daily goal, the week's learning goals, and suggestions in order.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
  },
];

const TOOLS = [...LIBRARY_MCP_TOOLS, ...BRIDGE_TOOLS];

function libraryData() {
  const { library, projects, study } = readLibrary();
  const json = (name) => {
    try {
      return JSON.parse(readFileSync(join(library, name), "utf8"));
    } catch {
      return undefined;
    }
  };
  return { library, projects, study, notes: parseNotesFile(json("notes.json")), tags: parseLibraryTags(json("tags.json")) };
}

function onlyKeys(args, keys) {
  const extra = Object.keys(args).filter((key) => !keys.includes(key));
  if (extra.length) throw new TraceToolError(`Unknown argument${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}.`);
}

function callTool(name, args) {
  switch (name) {
    case "library":
      return libraryTool(libraryData(), args);
    case "paper":
      return paperTool(libraryData(), args);
    case "search_claims":
      return claimSearchTool(libraryData(), args);
    case "notes":
      return notesTool(libraryData(), args);
    case "reading_list":
      onlyKeys(args, []);
      return readingListReport({});
    case "save_to_reading_list": {
      onlyKeys(args, ["title", "identifier", "url", "year", "paper_id", "relation", "concept"]);
      const title = typeof args.title === "string" ? args.title.trim() : "";
      if (!title) throw new TraceToolError("A title is required.");
      return readingListReport({
        add: typeof args.identifier === "string" && args.identifier.trim() ? args.identifier.trim() : title,
        title,
        ...(args.url ? { url: String(args.url) } : {}),
        ...(args.year !== undefined ? { year: args.year } : {}),
        ...(args.paper_id ? { for: String(args.paper_id) } : {}),
        ...(args.relation ? { relation: String(args.relation) } : {}),
        ...(args.concept ? { concept: String(args.concept) } : {}),
      });
    }
    case "remove_from_reading_list":
      onlyKeys(args, ["id"]);
      if (typeof args.id !== "string" || !args.id.trim()) throw new TraceToolError("The id of the saved work is required.");
      return readingListReport({ remove: args.id.trim() });
    case "today":
      onlyKeys(args, []);
      return todayReport();
    default:
      return undefined;
  }
}

/** Zod ve köprü hataları okunur bir cümleye. */
function toolErrorText(error) {
  if (error && typeof error === "object" && Array.isArray(error.issues)) {
    return `Invalid arguments: ${error.issues.map((issue) => `${issue.path?.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`).join("; ")}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function handle(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "trace", title: "Trace Paper Studio", version: SERVER_VERSION },
        instructions:
          "Trace keeps the reader's analysed papers, their claims with page and quote, the reader's notes, reading list and study record on this computer. " +
          "Use library to find a paper's id, paper for one paper, search_claims for what the papers say (cite the page), notes for the reader's own notes, " +
          "reading_list and today for what to read and do next. Change the reading list only when the reader asks.",
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (!TOOLS.some((tool) => tool.name === name)) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
      if (typeof args !== "object" || Array.isArray(args)) throw Object.assign(new Error("Tool arguments must be an object."), { code: -32602 });
      try {
        const result = callTool(name, args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
      } catch (error) {
        // Aracın kendi hatası sonuçta: model okuyup düzeltebilsin.
        return { content: [{ type: "text", text: toolErrorText(error) }], isError: true };
      }
    }
    default:
      if (id === undefined) return undefined;
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function startServer() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const batch = Array.isArray(message) ? message : [message];
    const replies = [];
    for (const item of batch) {
      if (!item || typeof item !== "object" || typeof item.method !== "string") {
        // Yanıtlar (istemcinin bize cevabı) ya da bozuk iletiler: yanıtlanacak bir şey yok.
        if (item && typeof item === "object" && "id" in item && !("result" in item) && !("error" in item)) replies.push({ jsonrpc: "2.0", id: item.id ?? null, error: { code: -32600, message: "Invalid request" } });
        continue;
      }
      // Bildirimlere (kimliksiz) yanıt yok.
      const notification = item.id === undefined;
      try {
        const result = handle(item);
        if (!notification) replies.push({ jsonrpc: "2.0", id: item.id, result: result ?? {} });
      } catch (error) {
        if (!notification) replies.push({ jsonrpc: "2.0", id: item.id, error: { code: typeof error?.code === "number" ? error.code : -32603, message: error instanceof Error ? error.message : String(error) } });
      }
    }
    if (!replies.length) return;
    send(Array.isArray(message) ? replies : replies[0]);
  });
  // İstemci stdin'i kapatınca süreç kendiliğinden bitiyor; `process.exit` yazılmamış yanıtları kesebilirdi.
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) startServer();
