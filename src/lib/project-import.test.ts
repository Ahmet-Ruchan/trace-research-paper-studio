import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { handoffAddress, MAX_PROJECT_BYTES, parseTraceProject, PROJECT_TOO_LARGE } from "./project-import";

describe("a project coming into the studio", () => {
  it("parses a valid project and names what is wrong with an invalid one", () => {
    const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
    expect(parseTraceProject(JSON.stringify(example)).id).toBe(example.id);
    expect(() => parseTraceProject("{ nope")).toThrow("The file is not valid JSON.");
    expect(() => parseTraceProject(JSON.stringify({ ...example, evidence: undefined }))).toThrow(/^Invalid Trace project schema: evidence · /);
    expect(() => parseTraceProject("[]")).toThrow(/^Invalid Trace project schema: root · /);
    expect(() => parseTraceProject(" ".repeat(MAX_PROJECT_BYTES + 1))).toThrow(PROJECT_TOO_LARGE);
  });

  it("takes an agent's handoff only from this machine, over http(s)", () => {
    const origin = "http://127.0.0.1:3000";
    expect(handoffAddress("http://127.0.0.1:4317/project.json", origin).port).toBe("4317");
    expect(handoffAddress("http://localhost:4317/p.json", origin).hostname).toBe("localhost");
    expect(handoffAddress("http://[::1]:4317/p.json", origin).hostname).toBe("[::1]");
    // Göreli adres bu sayfanın kökenine göre çözülüyor.
    expect(handoffAddress("/api/x.json", origin).href).toBe("http://127.0.0.1:3000/api/x.json");
    for (const address of ["https://attacker.example/x.json", "http://127.0.0.1.attacker.example/x.json", "file:///etc/passwd", "ftp://localhost/x.json"]) {
      expect(() => handoffAddress(address, origin), address).toThrow("Imports are only accepted from an address on this machine.");
    }
    expect(() => handoffAddress("http://[bad", origin)).toThrow("The import address is not valid.");
  });
});
