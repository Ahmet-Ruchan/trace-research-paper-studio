import { backupDirectory, listWeeklyBackups, weeklyBackup, WEEKLY_BACKUPS_KEPT } from "@/lib/backup-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

const describe = (backups: Awaited<ReturnType<typeof listWeeklyBackups>>) => ({ directory: backupDirectory(), kept: WEEKLY_BACKUPS_KEPT, backups: backups.map(({ day, name, bytes }) => ({ day, name, bytes })) });

/** Haftalık tam yedekler: gün, dosya adı, boyut. */
export async function GET() {
  try {
    return noStore(describe(await listWeeklyBackups()));
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The backups could not be listed." }, { status: 500 });
  }
}

/** Stüdyo açılınca çağrılıyor: son yedek bir haftadan eskiyse yenisi yazılıyor. */
export async function POST() {
  try {
    const { written } = await weeklyBackup();
    return noStore({ written, ...describe(await listWeeklyBackups()) });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The weekly backup could not be written." }, { status: 500 });
  }
}
