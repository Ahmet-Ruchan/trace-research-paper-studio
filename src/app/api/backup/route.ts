import { backupDirectory, listWeeklyBackups, weeklyBackup, WEEKLY_BACKUPS_KEPT } from "@/lib/backup-storage";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

const describe = (backups: Awaited<ReturnType<typeof listWeeklyBackups>>) => ({ directory: backupDirectory(), kept: WEEKLY_BACKUPS_KEPT, backups: backups.map(({ day, name, bytes }) => ({ day, name, bytes })) });

/** Haftalık tam yedekler: gün, dosya adı, boyut. */
export async function GET(request?: Request) {
  try {
    return noStore(describe(await listWeeklyBackups()));
  } catch (error) {
    const t = serverText(request);
    return noStore({ error: errorMessage(error, t.errors, t.backup.listFailed) }, { status: 500 });
  }
}

/** Stüdyo açılınca çağrılıyor: son yedek bir haftadan eskiyse yenisi yazılıyor. */
export async function POST(request?: Request) {
  try {
    const { written } = await weeklyBackup();
    return noStore({ written, ...describe(await listWeeklyBackups()) });
  } catch (error) {
    const t = serverText(request);
    return noStore({ error: errorMessage(error, t.errors, t.backup.writeFailed) }, { status: 500 });
  }
}
