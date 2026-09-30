import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as listBackups, POST as runBackup } from "@/app/api/backup/route";
import { POST as importData } from "@/app/api/profile/data/route";
import { listWeeklyBackups, weeklyBackup, WEEKLY_BACKUPS_KEPT } from "./backup-storage";
import { loadExampleProject } from "./example-fixture";
import { listStoredProjects, saveReaderNotes, saveStoredProject } from "./trace-storage";

/** Günler yerel: testler sabit bir saat diliminde koşuyor. */
let zone: string | undefined;
let workspace: string;
let previous: string | undefined;
beforeEach(() => {
  zone = process.env.TZ;
  process.env.TZ = "Europe/Istanbul";
  workspace = mkdtempSync(join(tmpdir(), "trace-weekly-"));
  previous = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = workspace;
});
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
  if (previous === undefined) delete process.env.TRACE_DATA_DIR;
  else process.env.TRACE_DATA_DIR = previous;
  rmSync(workspace, { recursive: true, force: true });
});

const day = (date: string, time = "10:00") => new Date(`${date}T${time}:00+03:00`);
const project = { ...loadExampleProject("attention-is-all-you-need.en.trace.json"), id: "attention" };

describe("the weekly backup", () => {
  it("writes nothing for an empty installation", async () => {
    expect(await weeklyBackup(day("2026-09-30"))).toEqual({ written: false });
    expect(await listWeeklyBackups()).toEqual([]);
  });

  it("writes a full backup at most once a week, papers included, and keeps the newest four", async () => {
    await saveStoredProject(project);
    await saveReaderNotes("attention", [{ id: "n1", target: { kind: "claim", claimId: project.evidence.claims[0].id }, text: "Kept safe.", color: "yellow", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }]);
    expect((await weeklyBackup(day("2026-09-01"))).written).toBe(true);
    expect((await weeklyBackup(day("2026-09-07", "23:00"))).written).toBe(false);
    expect((await weeklyBackup(day("2026-09-08", "00:10"))).written).toBe(true);
    for (const date of ["2026-09-15", "2026-09-22", "2026-09-29"]) await weeklyBackup(day(date));
    expect((await listWeeklyBackups()).map((item) => item.day)).toEqual(["2026-09-29", "2026-09-22", "2026-09-15", "2026-09-08"]);
    expect(WEEKLY_BACKUPS_KEPT).toBe(4);
    // Günlük yedeklere dokunmuyor.
    expect(readdirSync(join(workspace, "backups")).filter((name) => name.startsWith("notes-"))).toHaveLength(0);

    // Yedek, "Download my data" dosyasının aynısı: başka bir bilgisayarda geri yükleniyor.
    const file = readFileSync((await listWeeklyBackups())[0].path, "utf8");
    rmSync(join(workspace, "library"), { recursive: true, force: true });
    const response = await importData(new Request("http://127.0.0.1/api/profile/data", { method: "POST", body: file }));
    expect(((await response.json()) as { library: { papersAdded: number; notesAdded: number } }).library).toMatchObject({ papersAdded: 1, notesAdded: 1 });
    expect((await listStoredProjects()).map((item) => item.id)).toEqual(["attention"]);
  });

  it("answers the studio with the backups it keeps", async () => {
    await saveStoredProject(project);
    const first = (await (await runBackup()).json()) as { written: boolean; kept: number; backups: Array<{ day: string; bytes: number }> };
    expect(first).toMatchObject({ written: true, kept: 4 });
    expect(first.backups[0].bytes).toBeGreaterThan(100_000);
    expect(((await (await runBackup()).json()) as { written: boolean }).written).toBe(false);
    expect(((await (await listBackups()).json()) as { backups: unknown[] }).backups).toHaveLength(1);
  });
});
