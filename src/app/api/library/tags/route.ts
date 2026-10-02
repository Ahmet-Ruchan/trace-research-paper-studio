import { z } from "zod";
import { libraryTagsToJson, tagListSchema } from "@/lib/library-tags";
import { readLibraryTags, readStoredProject, saveStoredProjectTags } from "@/lib/trace-storage";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** On iki kısa etiket birkaç yüz bayt; sınır yalnızca kötüye kullanıma karşı. */
const MAX_BODY_BYTES = 16 * 1024;

const bodySchema = z.object({ tags: tagListSchema });

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(request?: Request) {
  try {
    return noStore(libraryTagsToJson(await readLibraryTags()));
  } catch (error) {
    const t = serverText(request);
    return noStore(
      { error: errorMessage(error, t.errors, t.tags.readFailed) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const t = serverText(request);
  const projectId = new URL(request.url).searchParams.get("id")?.trim();
  if (!projectId) return noStore({ error: t.request.projectIdRequired }, { status: 400 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return noStore({ error: t.tags.tooLarge }, { status: 413 });
    }
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return noStore({ error: parsed.error.issues[0]?.message ?? t.tags.invalid }, { status: 400 });
    }
    // Kütüphanede olmayan bir projeye etiket yazılmıyor; aksi halde hiçbir
    // listede görünmeyen, silinemeyen kayıtlar birikirdi.
    if (!(await readStoredProject(projectId))) {
      return noStore({ error: t.request.notInLibrary }, { status: 404 });
    }
    return noStore({ ok: true, tags: await saveStoredProjectTags(projectId, parsed.data.tags) });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: t.request.invalidJson }, { status: 400 });
    return noStore(
      { error: errorMessage(error, t.errors, t.tags.saveFailed) },
      { status: 500 },
    );
  }
}
