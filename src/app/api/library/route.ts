import { deleteStoredProject, listStoredProjects, readStoredProject, saveStoredProject } from "@/lib/trace-storage";
import { MAX_REVISION_LABEL, revisionReasonSchema } from "@/lib/project-revisions";
import { researchProjectSchema } from "@/lib/schema";
import { currentMember, readTeam } from "@/lib/server/team-store";
import { mergeVotes } from "@/lib/team";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(request?: Request) {
  try {
    return noStore({ projects: await listStoredProjects() });
  } catch (error) {
    const t = serverText(request);
    return noStore(
      { error: errorMessage(error, t.errors, t.library.readFailed) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const t = serverText(request);
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_PROJECT_BYTES) return noStore({ error: t.library.tooLarge }, { status: 413 });
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_PROJECT_BYTES) {
      return noStore({ error: t.library.tooLarge }, { status: 413 });
    }
    const parsed = researchProjectSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return noStore(
        { error: t.request.projectSchemaInvalid(issue?.path.join(".") ?? "", issue?.message) },
        { status: 400 },
      );
    }
    // Kaydın nedeni revizyon alınıp alınmayacağını belirliyor; bilinmeyen bir
    // neden sessizce "edit" sayılmıyor, çünkü o zaman büyük bir değişiklik
    // on dakikalık birleştirmeye takılıp geçmişte hiç iz bırakmayabilirdi.
    const url = new URL(request.url);
    const reason = revisionReasonSchema.safeParse(url.searchParams.get("reason") ?? "edit");
    if (!reason.success) return noStore({ error: t.library.unknownReason }, { status: 400 });
    const label = url.searchParams.get("label")?.slice(0, MAX_REVISION_LABEL) || undefined;
    // Ekip kipinde bir üye yalnızca kendi oyunu değiştirebiliyor; kararlar oylardan yeniden hesaplanıyor (`team.ts`).
    const team = readTeam();
    let project = parsed.data;
    if (team.members.length) {
      const member = currentMember(request);
      if (!member) return noStore({ error: t.errors.signInToStudio() }, { status: 401 });
      project = mergeVotes(await readStoredProject(project.id), project, member, team.approvalsNeeded);
    }
    await saveStoredProject(project, { reason: reason.data, label });
    return noStore({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: t.request.invalidJson }, { status: 400 });
    return noStore(
      { error: errorMessage(error, t.errors, t.library.saveFailed) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const t = serverText(request);
  const projectId = new URL(request.url).searchParams.get("id")?.trim();
  if (!projectId) return noStore({ error: t.request.projectIdRequired }, { status: 400 });
  try {
    const deleted = await deleteStoredProject(projectId);
    return noStore({ ok: true, deleted });
  } catch (error) {
    return noStore(
      { error: errorMessage(error, t.errors, t.library.deleteFailed) },
      { status: 500 },
    );
  }
}
