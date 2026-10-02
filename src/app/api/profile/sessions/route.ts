import { z, ZodError } from "zod";
import { addSessions, removeSession, workSessionSchema } from "@/lib/work-log";
import { readWorkLog, updateWorkLog } from "@/lib/trace-storage";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
/** Saati biraz ileri bir makine ya da sekme: bundan ileride biten oturum geri çevriliyor. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;

const bodySchema = z.object({ sessions: z.array(workSessionSchema).min(1).max(500) });

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/** Çalışma kaydının tamamı (`~/.trace/focus-log.json`): oturumlar ve katlanmış eski günler. */
export async function GET(request?: Request) {
  try {
    return noStore({ log: await readWorkLog() });
  } catch (error) {
    const t = serverText(request);
    return noStore({ error: errorMessage(error, t.errors, t.workLog.readFailed) }, { status: 500 });
  }
}

/** Oturum ekler; aynı kimlik bir kez (iki sekme aynı turu kaydedebiliyor). */
export async function POST(request: Request) {
  const t = serverText(request);
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: t.workLog.tooMany }, { status: 413 });
    const { sessions } = bodySchema.parse(JSON.parse(text));
    const latest = Date.now() + FUTURE_SLACK_MS;
    if (sessions.some((session) => Date.parse(session.end) > latest)) return noStore({ error: t.workLog.futureEnd }, { status: 400 });
    const log = await updateWorkLog((current) => addSessions(current, sessions));
    return noStore({ ok: true, sessions: log.sessions.length });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: t.request.invalidJson }, { status: 400 });
    if (error instanceof ZodError) return noStore({ error: error.issues[0]?.message ?? t.workLog.invalid }, { status: 400 });
    return noStore({ error: errorMessage(error, t.errors, t.workLog.saveFailed) }, { status: 500 });
  }
}

/** Bir oturumu siler (yanlışlıkla açık kalan bir kronometre). */
export async function DELETE(request: Request) {
  const t = serverText(request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 80) return noStore({ error: t.workLog.idRequired }, { status: 400 });
  try {
    let found = false;
    await updateWorkLog((current) => {
      found = current.sessions.some((session) => session.id === id);
      return removeSession(current, id);
    });
    return found ? noStore({ ok: true }) : noStore({ error: t.workLog.notFound }, { status: 404 });
  } catch (error) {
    return noStore({ error: errorMessage(error, t.errors, t.workLog.deleteFailed) }, { status: 500 });
  }
}
