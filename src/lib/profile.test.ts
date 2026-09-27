import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getProfile, PUT as putProfile } from "@/app/api/profile/route";
import { DELETE as deleteSession, GET as getSessions, POST as postSessions } from "@/app/api/profile/sessions/route";
import { GET as exportData, POST as importData } from "@/app/api/profile/data/route";
import { displayName, emptyProfile, initials, parseProfile, profileSchema, type Profile } from "./profile";
import type { WorkLog, WorkSession } from "./work-log";

let workspace: string;
let previous: string | undefined;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "trace-profile-"));
  previous = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = workspace;
});
afterEach(() => {
  if (previous === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previous;
  rmSync(workspace, { recursive: true, force: true });
});

const json = (body: unknown) => JSON.stringify(body);
const put = (profile: unknown) => putProfile(new Request("http://127.0.0.1/api/profile", { method: "PUT", body: json({ profile }) }));
const post = (sessions: unknown) => postSessions(new Request("http://127.0.0.1/api/profile/sessions", { method: "POST", body: json({ sessions }) }));
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const session = (id: string, from: number, to: number): WorkSession => ({ id, start: minutesAgo(from), end: minutesAgo(to), kind: "focus" });

describe("the reader's profile", () => {
  it("names the reader and draws their initials", () => {
    const profile = { ...emptyProfile("2026-09-01T00:00:00.000Z"), firstName: "ada", lastName: "Lovelace" };
    expect(displayName(profile)).toBe("ada Lovelace");
    expect(initials(profile)).toBe("AL");
    expect(initials(emptyProfile("x"))).toBe("");
    expect(parseProfile({ version: 9 }, "2026-09-01T00:00:00.000Z").firstName).toBe("");
  });

  it("starts empty with sensible timer settings, and saves a change of name without losing when it was created", async () => {
    const first = (await (await getProfile()).json()) as { profile: Profile };
    expect(first.profile.preferences.focus).toMatchObject({ work: 25, shortBreak: 5, longBreak: 15, longEvery: 4, rounds: 0, autoStartBreaks: true });
    expect(first.profile.preferences.colors).toEqual({ focus: "red", timer: "orange", stopwatch: "blue", alarm: "purple" });
    const saved = await put({ ...first.profile, firstName: "  Ada ", lastName: "Lovelace", createdAt: "1999-01-01T00:00:00.000Z" });
    expect(saved.status).toBe(200);
    const created = profileSchema.parse(JSON.parse(readFileSync(join(workspace, "profile.json"), "utf8"))).createdAt;
    const renamed = (await (await put({ ...first.profile, firstName: "Augusta", lastName: "King" })).json()) as { profile: Profile };
    expect(renamed.profile).toMatchObject({ firstName: "Augusta", lastName: "King", createdAt: created });
    expect(created).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("refuses a malformed email, an oversized photo and a picture that is not an image", async () => {
    const { profile } = (await (await getProfile()).json()) as { profile: Profile };
    const email = await put({ ...profile, email: "not an address" });
    expect(email.status).toBe(400);
    expect(((await email.json()) as { error: string }).error).toContain("email");
    expect((await put({ ...profile, photo: `data:image/jpeg;base64,${"A".repeat(420_000)}` })).status).toBe(413);
    expect((await put({ ...profile, photo: "data:text/html;base64,PHNjcmlwdD4=" })).status).toBe(400);
    expect((await put({ ...profile, email: "ada@example.org", photo: "data:image/jpeg;base64,/9j/4AAQ" })).status).toBe(200);
  });

  it("sets a damaged profile aside instead of overwriting it, and keeps a daily backup", async () => {
    writeFileSync(join(workspace, "profile.json"), "{ not json");
    const { profile } = (await (await getProfile()).json()) as { profile: Profile };
    expect((await put({ ...profile, firstName: "Ada" })).status).toBe(200);
    expect(readdirSync(workspace).some((name) => name.startsWith("profile.damaged-"))).toBe(true);
    expect((await put({ ...profile, firstName: "Ada", lastName: "L" })).status).toBe(200);
    expect(readdirSync(join(workspace, "backups")).filter((name) => name.startsWith("profile-"))).toHaveLength(1);
  });
});

describe("the work log endpoints", () => {
  it("records sessions once, lists them, and deletes one", async () => {
    expect((await post([session("a", 60, 35), session("b", 30, 5)])).status).toBe(200);
    expect((await post([session("a", 60, 35)])).status).toBe(200);
    const { log } = (await (await getSessions()).json()) as { log: WorkLog };
    expect(log.sessions.map((item) => item.id)).toEqual(["a", "b"]);
    expect(readFileSync(join(workspace, "focus-log.json"), "utf8").split("\n").length).toBeGreaterThan(3);
    const removed = await deleteSession(new Request("http://127.0.0.1/api/profile/sessions?id=a", { method: "DELETE" }));
    expect(removed.status).toBe(200);
    expect((await deleteSession(new Request("http://127.0.0.1/api/profile/sessions?id=a", { method: "DELETE" }))).status).toBe(404);
    expect(((await (await getSessions()).json()) as { log: WorkLog }).log.sessions.map((item) => item.id)).toEqual(["b"]);
  });

  it("refuses a session that ends in the future or before it starts", async () => {
    expect((await post([{ id: "f", start: minutesAgo(5), end: minutesAgo(-30), kind: "focus" }])).status).toBe(400);
    expect((await post([{ id: "g", start: minutesAgo(5), end: minutesAgo(10), kind: "focus" }])).status).toBe(400);
    expect(existsSync(join(workspace, "focus-log.json"))).toBe(false);
  });

  it("downloads everything in one file and merges it back, taking the profile only into an empty one", async () => {
    const { profile } = (await (await getProfile()).json()) as { profile: Profile };
    await put({ ...profile, firstName: "Ada" });
    await post([session("a", 60, 35)]);
    const file = (await (await exportData()).json()) as { kind: string; profile: Profile; log: WorkLog };
    expect(file.kind).toBe("trace-work-data");

    // Başka bir makine: boş profil, başka bir oturum.
    rmSync(workspace, { recursive: true, force: true });
    await post([session("z", 20, 10)]);
    const imported = (await (await importData(new Request("http://127.0.0.1/api/profile/data", { method: "POST", body: json(file) }))).json()) as { added: number; profileAdopted: boolean };
    expect(imported).toMatchObject({ added: 1, profileAdopted: true });
    const again = (await (await importData(new Request("http://127.0.0.1/api/profile/data", { method: "POST", body: json({ ...file, profile: { ...file.profile, firstName: "Someone else" } }) }))).json()) as { added: number; profileAdopted: boolean };
    expect(again).toMatchObject({ added: 0, profileAdopted: false });
    expect(((await (await getProfile()).json()) as { profile: Profile }).profile.firstName).toBe("Ada");
    expect(((await (await getSessions()).json()) as { log: WorkLog }).log.sessions.map((item) => item.id).sort()).toEqual(["a", "z"]);
    expect((await importData(new Request("http://127.0.0.1/api/profile/data", { method: "POST", body: json({ kind: "other" }) }))).status).toBe(400);
  });
});
