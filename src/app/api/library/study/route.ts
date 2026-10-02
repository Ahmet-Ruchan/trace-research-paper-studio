import { z } from "zod";
import { studyFileToJson, studyProgressSchema } from "@/lib/study-path";
import { readAllStudyProgress, readStoredProject, readStudyProgress, saveStudyProgress } from "@/lib/trace-storage";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dört yüz yanıtlık bir kayıt bile yüz kilobaytı geçmiyor; sınır kötüye kullanıma karşı. */
const MAX_BODY_BYTES = 256 * 1024;

const bodySchema = z.object({ progress: studyProgressSchema.nullable() });

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function projectIdOf(request: Request) {
  return new URL(request.url).searchParams.get("id")?.trim();
}

/** `?id=` ile bir projenin ilerlemesi; kimliksiz bütün kütüphaneninki (tekrar kuyruğu için). */
export async function GET(request: Request) {
  const projectId = projectIdOf(request);
  try {
    if (!projectId) return noStore(studyFileToJson(await readAllStudyProgress()));
    return noStore({ progress: (await readStudyProgress(projectId)) ?? null });
  } catch (error) {
    const t = serverText(request);
    return noStore({ error: errorMessage(error, t.errors, t.study.readFailed) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const t = serverText(request);
  const projectId = projectIdOf(request);
  if (!projectId) return noStore({ error: t.request.projectIdRequired }, { status: 400 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return noStore({ error: t.study.tooLarge }, { status: 413 });
    }
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return noStore({ error: parsed.error.issues[0]?.message ?? t.study.invalid }, { status: 400 });
    }
    // Kütüphanede olmayan bir projeye ilerleme yazılmıyor; hiçbir yerden silinemeyen kayıtlar birikirdi.
    if (!(await readStoredProject(projectId))) {
      return noStore({ error: t.request.notInLibrary }, { status: 404 });
    }
    const progress = await saveStudyProgress(projectId, parsed.data.progress ?? undefined);
    return noStore({ ok: true, progress: progress ?? null });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: t.request.invalidJson }, { status: 400 });
    return noStore({ error: errorMessage(error, t.errors, t.study.saveFailed) }, { status: 500 });
  }
}
