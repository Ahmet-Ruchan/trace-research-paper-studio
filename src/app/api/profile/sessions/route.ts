import { z, ZodError } from "zod";
import { addSessions, removeSession, workSessionSchema } from "@/lib/work-log";
import { readWorkLog, updateWorkLog } from "@/lib/trace-storage";

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
export async function GET() {
  try {
    return noStore({ log: await readWorkLog() });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The work log could not be read." }, { status: 500 });
  }
}

/** Oturum ekler; aynı kimlik bir kez (iki sekme aynı turu kaydedebiliyor). */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: "Too many sessions at once." }, { status: 413 });
    const { sessions } = bodySchema.parse(JSON.parse(text));
    const latest = Date.now() + FUTURE_SLACK_MS;
    if (sessions.some((session) => Date.parse(session.end) > latest)) return noStore({ error: "A session cannot end in the future." }, { status: 400 });
    const log = await updateWorkLog((current) => addSessions(current, sessions));
    return noStore({ ok: true, sessions: log.sessions.length });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    if (error instanceof ZodError) return noStore({ error: error.issues[0]?.message ?? "The sessions are not valid." }, { status: 400 });
    return noStore({ error: error instanceof Error ? error.message : "The sessions could not be saved." }, { status: 500 });
  }
}

/** Bir oturumu siler (yanlışlıkla açık kalan bir kronometre). */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 80) return noStore({ error: "A session id is required." }, { status: 400 });
  try {
    let found = false;
    await updateWorkLog((current) => {
      found = current.sessions.some((session) => session.id === id);
      return removeSession(current, id);
    });
    return found ? noStore({ ok: true }) : noStore({ error: "The session is not in the work log." }, { status: 404 });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The session could not be deleted." }, { status: 500 });
  }
}
