import { z } from "zod";
import { readerNotesSchema } from "@/lib/reader-notes";
import { readReaderNotes, readStoredProject, saveReaderNotes } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bin not, her biri en çok dört bin karakter: sınır kötüye kullanıma karşı. */
const MAX_BODY_BYTES = 1024 * 1024;

const bodySchema = z.object({ notes: readerNotesSchema });

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function projectIdOf(request: Request) {
  return new URL(request.url).searchParams.get("id")?.trim();
}

/** `?id=` ile bir makalenin notları. */
export async function GET(request: Request) {
  const projectId = projectIdOf(request);
  if (!projectId) return noStore({ error: "A project id is required." }, { status: 400 });
  try {
    return noStore({ notes: await readReaderNotes(projectId) });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Your notes could not be read." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const projectId = projectIdOf(request);
  if (!projectId) return noStore({ error: "A project id is required." }, { status: 400 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: "The notes are too large." }, { status: 413 });
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return noStore({ error: parsed.error.issues[0]?.message ?? "The notes are not valid." }, { status: 400 });
    // Kütüphanede olmayan bir makaleye not yazılmıyor; hiçbir yerden silinemeyen kayıtlar birikirdi.
    if (!(await readStoredProject(projectId))) return noStore({ error: "The project is not in the library." }, { status: 404 });
    return noStore({ ok: true, notes: await saveReaderNotes(projectId, parsed.data.notes) });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    return noStore({ error: error instanceof Error ? error.message : "Your notes could not be saved." }, { status: 500 });
  }
}
