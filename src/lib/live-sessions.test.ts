import { describe, expect, it } from "vitest";
import { liveKind, liveReport, liveVerdict, requiredAgents } from "../../scripts/live-sessions.mjs";

const rows = (codex: string, claude: string) => [
  { agent: "Codex", version: "0.157.1", failed: 0, live: codex },
  { agent: "Claude Code", version: "2.1.283", failed: 0, live: claude },
  { agent: "Antigravity CLI", version: "1.2.12", failed: 0, live: "not possible: needs a Google sign-in" },
];

describe("which agent was tried with a real model session", () => {
  it("says so plainly when every session was skipped for want of a key", () => {
    const verdict = liveVerdict(rows("skipped: no key", "skipped: no key"), { live: true });
    expect(verdict.headline).toBe("No agent was tried with a real model session in this run.");
    expect(verdict.tried).toEqual([]);
    expect(verdict.warnings).toEqual([
      "Codex was not tried with a real model session: no OPENAI_API_KEY was given.",
      "Claude Code was not tried with a real model session: no ANTHROPIC_API_KEY was given.",
    ]);
    expect(verdict.errors).toEqual([]);
  });

  it("names the agents that passed, and fails the run when one that had to pass did not", () => {
    const verdict = liveVerdict(rows("passed", "skipped: no key"), { live: true, require: requiredAgents("codex, claude") });
    expect(verdict.headline).toBe("Tried with a real model session: Codex.");
    expect(verdict.errors).toEqual(["Claude Code had to pass a real model session (--require-live) but no ANTHROPIC_API_KEY was given."]);
    expect(liveVerdict(rows("failed", "passed"), { live: true }).errors).toEqual(["Codex: the real model session did not use the skill to run the bridge."]);
    expect(liveVerdict(rows("not asked", "passed"), { live: true }).warnings).toEqual(["Codex was not tried with a real model session: the run stopped before it."]);
    expect(liveVerdict(rows("passed", "passed"), { live: true, require: requiredAgents("agy") }).errors[0]).toMatch(/Antigravity CLI .* cannot be tried live/);
  });

  it("does not warn when no live session was asked for", () => {
    const verdict = liveVerdict(rows("not asked", "not asked"), { live: false });
    expect(verdict).toMatchObject({ headline: "No real model session was asked for (run with --live).", warnings: [], errors: [] });
  });

  it("reads the agent list and keeps a record of the run", () => {
    expect(requiredAgents("")).toEqual([]);
    expect(requiredAgents("Codex,agy")).toEqual(["Codex", "Antigravity CLI"]);
    expect(() => requiredAgents("gemini")).toThrow(/unknown agent "gemini"/);
    expect(liveKind("skipped: no key")).toBe("skipped");
    const report = liveReport(rows("passed", "skipped: no key"), { plugin: "0.38.0", live: true, at: "2026-10-01T00:00:00.000Z" });
    expect(report.agents.map((agent: { kind: string }) => agent.kind)).toEqual(["passed", "skipped", "impossible"]);
    expect(report).toMatchObject({ plugin: "0.38.0", liveAsked: true });
  });
});
