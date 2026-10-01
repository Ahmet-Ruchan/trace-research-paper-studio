import { z } from "zod";
import { publicationIdPattern, publicationSettingsSchema, publicationStatusSchema } from "@/lib/publications";
import { createPublication, deletePublication, listPublications, readPublication, readReaderNotes, updatePublication } from "@/lib/trace-storage";
import { notesFilterFor } from "@/lib/server/team-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function failure(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return noStore({ error: `Invalid publication request: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}` }, { status: 400 });
  }
  if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
  return noStore({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

const idFrom = (request: Request) => new URL(request.url).searchParams.get("id") ?? "";

/**
 * Yazarın kendi yayınlarını yönettiği uç. Okuyucunun gördüğü sayfa
 * `/p/<kimlik>`; bu uç ise tam kayıtları, durumları ve denetimleri döndürüyor,
 * dolayısıyla projeye göre süzülmeden listeleme yapmıyor.
 */
export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
  if (!projectId) return noStore({ error: "A project id is required." }, { status: 400 });
  try {
    return noStore({ publications: await listPublications(projectId) });
  } catch (error) {
    return failure(error, "The publications could not be read.");
  }
}

const createSchema = z.object({ projectId: z.string().min(1).max(200), settings: publicationSettingsSchema });

/** Ekip kipinde yayına yalnızca yayınlayanın görebildiği notlar girebiliyor. */
async function visibleNoteIds(request: Request, projectId: string, noteIds: string[] | undefined): Promise<string[]> {
  if (!noteIds?.length) return noteIds ?? [];
  const visible = new Set(notesFilterFor(request)(await readReaderNotes(projectId)).map((note) => note.id));
  return noteIds.filter((id) => visible.has(id));
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(JSON.parse(await request.text()));
    const noteIds = await visibleNoteIds(request, body.projectId, body.settings.noteIds);
    const publication = await createPublication(body.projectId, { ...body.settings, noteIds });
    if (!publication) return noStore({ error: "Save the project to the library before publishing it." }, { status: 404 });
    return noStore({ publication });
  } catch (error) {
    return failure(error, "The project could not be published.");
  }
}

const patchSchema = z.object({
  status: publicationStatusSchema.optional(),
  settings: publicationSettingsSchema.optional(),
  refresh: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const id = idFrom(request);
  if (!publicationIdPattern.test(id)) return noStore({ error: "The publication id is not valid." }, { status: 400 });
  try {
    const patch = patchSchema.parse(JSON.parse(await request.text()));
    if (patch.settings?.noteIds?.length) {
      const record = await readPublication(id);
      if (record) patch.settings = { ...patch.settings, noteIds: await visibleNoteIds(request, record.projectId, patch.settings.noteIds) };
    }
    const publication = await updatePublication(id, patch);
    if (!publication) return noStore({ error: "That publication does not exist." }, { status: 404 });
    return noStore({ publication });
  } catch (error) {
    return failure(error, "The publication could not be updated.");
  }
}

export async function DELETE(request: Request) {
  const id = idFrom(request);
  if (!publicationIdPattern.test(id)) return noStore({ error: "The publication id is not valid." }, { status: 400 });
  try {
    return noStore({ ok: true, deleted: await deletePublication(id) });
  } catch (error) {
    return failure(error, "The publication could not be deleted.");
  }
}
