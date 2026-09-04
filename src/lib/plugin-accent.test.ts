import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TRACE_ACCENT_PALETTE as PLUGIN_PALETTE,
  assignPaperAccent,
} from "../../plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs";
import { TRACE_ACCENT_PALETTE } from "./trace-storage";

let workspace: string;
let previousDataDirectory: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-plugin-accent-"));
  previousDataDirectory = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = join(workspace, "trace-data");
});

afterEach(() => {
  if (previousDataDirectory === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previousDataDirectory;
  rmSync(workspace, { recursive: true, force: true });
});

describe("native plugin accent cycle", () => {
  it("shares the app palette and exhausts it before repeating", () => {
    expect(PLUGIN_PALETTE).toEqual(TRACE_ACCENT_PALETTE);
    const assignments = Array.from({ length: 21 }, (_, index) => {
      const paperPath = join(workspace, `paper-${index}.pdf`);
      writeFileSync(paperPath, `paper fixture ${index}`, "utf8");
      return assignPaperAccent(paperPath);
    });

    const firstCycle = assignments.slice(0, 20).map((assignment) => assignment.accent);
    expect(new Set(firstCycle)).toEqual(new Set(TRACE_ACCENT_PALETTE));
    expect(assignments[20].accent).toBe(firstCycle[0]);
    expect(assignments[20].cycle).toBe(2);
  });

  it("reuses a paper fingerprint without advancing the sequence", () => {
    const paperPath = join(workspace, "same-paper.pdf");
    writeFileSync(paperPath, "same paper", "utf8");
    const first = assignPaperAccent(paperPath);
    const repeated = assignPaperAccent(paperPath);

    expect(repeated).toMatchObject({ accent: first.accent, paletteIndex: first.paletteIndex, reused: true });
  });
});
