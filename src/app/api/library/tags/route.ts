import { z } from "zod";
import { libraryTagsToJson, tagListSchema } from "@/lib/library-tags";
import { readLibraryTags, readStoredProject, saveStoredProjectTags } from "@/lib/trace-storage";

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

export async function GET() {
  try {
    return noStore(libraryTagsToJson(await readLibraryTags()));
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "The library tags could not be read." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const projectId = new URL(request.url).searchParams.get("id")?.trim();
  if (!projectId) return noStore({ error: "A project id is required." }, { status: 400 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return noStore({ error: "The tag list is too large." }, { status: 413 });
    }
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return noStore({ error: parsed.error.issues[0]?.message ?? "The tag list is not valid." }, { status: 400 });
    }
    // Kütüphanede olmayan bir projeye etiket yazılmıyor; aksi halde hiçbir
    // listede görünmeyen, silinemeyen kayıtlar birikirdi.
    if (!(await readStoredProject(projectId))) {
      return noStore({ error: "The project is not in the library." }, { status: 404 });
    }
    return noStore({ ok: true, tags: await saveStoredProjectTags(projectId, parsed.data.tags) });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    return noStore(
      { error: error instanceof Error ? error.message : "The tags could not be saved." },
      { status: 500 },
    );
  }
}
