import { ZodError } from "zod";
import { builtInTemplates } from "@/lib/narrative-templates";
import { deleteStoredTemplate, listStoredTemplates, saveStoredTemplate } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEMPLATE_BYTES = 64 * 1024;

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET() {
  try {
    return noStore({ templates: [...builtInTemplates, ...(await listStoredTemplates())] });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The templates could not be read." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const text = await request.text();
    if (text.length > MAX_TEMPLATE_BYTES) return noStore({ error: "The template is too large." }, { status: 413 });
    const template = await saveStoredTemplate(JSON.parse(text));
    return noStore({ template });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return noStore({ error: `Invalid template: ${issue?.path.join(".") || "root"} · ${issue?.message ?? "unknown error"}` }, { status: 400 });
    }
    return noStore({ error: error instanceof Error ? error.message : "The template could not be saved." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return noStore({ error: "A valid template id is required." }, { status: 400 });
  try {
    return noStore({ ok: true, deleted: await deleteStoredTemplate(id) });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The template could not be deleted." }, { status: 500 });
  }
}
