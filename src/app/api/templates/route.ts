import { ZodError } from "zod";
import { builtInTemplates } from "@/lib/narrative-templates";
import { deleteStoredTemplate, listStoredTemplates, saveStoredTemplate } from "@/lib/trace-storage";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEMPLATE_BYTES = 64 * 1024;

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(request?: Request) {
  try {
    return noStore({ templates: [...builtInTemplates, ...(await listStoredTemplates())] });
  } catch (error) {
    const t = serverText(request);
    return noStore({ error: errorMessage(error, t.errors, t.templates.readFailed) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const t = serverText(request);
  try {
    const text = await request.text();
    if (text.length > MAX_TEMPLATE_BYTES) return noStore({ error: t.templates.tooLarge }, { status: 413 });
    const template = await saveStoredTemplate(JSON.parse(text));
    return noStore({ template });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: t.request.invalidJson }, { status: 400 });
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return noStore({ error: t.templates.invalid(issue?.path.join(".") ?? "", issue?.message) }, { status: 400 });
    }
    return noStore({ error: errorMessage(error, t.errors, t.templates.saveFailed) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const t = serverText(request);
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return noStore({ error: t.templates.idRequired }, { status: 400 });
  try {
    return noStore({ ok: true, deleted: await deleteStoredTemplate(id) });
  } catch (error) {
    return noStore({ error: errorMessage(error, t.errors, t.templates.deleteFailed) }, { status: 500 });
  }
}
