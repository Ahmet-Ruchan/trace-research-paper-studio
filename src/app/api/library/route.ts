import { deleteStoredProject, listStoredProjects, saveStoredProject } from "@/lib/trace-storage";
import { researchProjectSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET() {
  try {
    return noStore({ projects: await listStoredProjects() });
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "The Trace library could not be read." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_PROJECT_BYTES) return noStore({ error: "The Trace JSON exceeds the 5 MB limit." }, { status: 413 });
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_PROJECT_BYTES) {
      return noStore({ error: "The Trace JSON exceeds the 5 MB limit." }, { status: 413 });
    }
    const parsed = researchProjectSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return noStore(
        { error: `Invalid Trace project schema: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}` },
        { status: 400 },
      );
    }
    await saveStoredProject(parsed.data);
    return noStore({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    return noStore(
      { error: error instanceof Error ? error.message : "The Trace project could not be saved." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const projectId = new URL(request.url).searchParams.get("id")?.trim();
  if (!projectId) return noStore({ error: "A project id is required." }, { status: 400 });
  try {
    const deleted = await deleteStoredProject(projectId);
    return noStore({ ok: true, deleted });
  } catch (error) {
    return noStore(
      { error: error instanceof Error ? error.message : "The Trace project could not be deleted." },
      { status: 500 },
    );
  }
}
