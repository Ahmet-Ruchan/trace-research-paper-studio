import { deleteStoredProject, listStoredProjects, saveStoredProject } from "@/lib/trace-storage";
import { MAX_REVISION_LABEL, revisionReasonSchema } from "@/lib/project-revisions";
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
    // Kaydın nedeni revizyon alınıp alınmayacağını belirliyor; bilinmeyen bir
    // neden sessizce "edit" sayılmıyor, çünkü o zaman büyük bir değişiklik
    // on dakikalık birleştirmeye takılıp geçmişte hiç iz bırakmayabilirdi.
    const url = new URL(request.url);
    const reason = revisionReasonSchema.safeParse(url.searchParams.get("reason") ?? "edit");
    if (!reason.success) return noStore({ error: "Unknown save reason." }, { status: 400 });
    const label = url.searchParams.get("label")?.slice(0, MAX_REVISION_LABEL) || undefined;
    await saveStoredProject(parsed.data, { reason: reason.data, label });
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
