import { MAX_REVISION_LABEL, revisionIdPattern } from "@/lib/project-revisions";
import { createProjectRevision, listProjectRevisions, readProjectRevision } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function projectIdFrom(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  return id && id.length <= 200 ? id : undefined;
}

/**
 * `?id=<proje>` revizyonları listeler, `&revision=<kimlik>` birini tam
 * projesiyle döndürür. Geri yükleme ayrı bir uç değil: istemci o projeyi
 * `PUT /api/library?reason=restore` ile yazar ve depolama o anki hâli önce
 * revizyon olarak saklar. Geri yükleme de böylece geri alınabilir.
 */
export async function GET(request: Request) {
  const projectId = projectIdFrom(request);
  if (!projectId) return noStore({ error: "A project id is required." }, { status: 400 });
  const revision = new URL(request.url).searchParams.get("revision");
  try {
    if (!revision) return noStore({ revisions: await listProjectRevisions(projectId) });
    if (!revisionIdPattern.test(revision)) return noStore({ error: "The revision id is not valid." }, { status: 400 });
    const loaded = await readProjectRevision(projectId, revision);
    if (!loaded) return noStore({ error: "That revision does not exist." }, { status: 404 });
    return noStore({ revision: loaded.summary, project: loaded.project });
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "The project history could not be read." },
      { status: 500 },
    );
  }
}

/** Kaydedilmiş hâli elle bir sürüm olarak işaretler. Gövde: `{ "label"?: string }`. */
export async function POST(request: Request) {
  const projectId = projectIdFrom(request);
  if (!projectId) return noStore({ error: "A project id is required." }, { status: 400 });
  let label: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { label?: unknown };
    label = typeof body.label === "string" ? body.label.slice(0, MAX_REVISION_LABEL) : undefined;
    const revision = await createProjectRevision(projectId, label);
    if (!revision) return noStore({ error: "Save the project before marking a version." }, { status: 404 });
    return noStore({ revision });
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "The version could not be saved." },
      { status: 500 },
    );
  }
}
