import { z } from "zod";
import { conceptNames } from "@/lib/alias-proposals";
import { conceptKeys } from "@/lib/concept-links";
import { decideAlias, forgetAlias } from "@/lib/concept-aliases";
import { listStoredProjects, readConceptAliases, updateConceptAliases } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

const bodySchema = z.object({
  a: z.string().trim().min(1).max(200),
  b: z.string().trim().min(1).max(200),
  decision: z.enum(["same", "different", "forget"]),
  proposedBy: z.enum(["reader", "model"]).default("reader"),
  reason: z.string().max(400).optional(),
});

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/** Okuyucunun kavram eşleri ve kütüphanedeki kavram adları (elle eşlemek için). */
export async function GET() {
  try {
    const [file, projects] = await Promise.all([readConceptAliases(), listStoredProjects()]);
    return noStore({ ...file, names: conceptNames(projects, { version: 1, decisions: [] }).map((name) => name.term) });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The concept links could not be read." }, { status: 500 });
  }
}

/**
 * Bir kararı yazar: "same", "different" ya da "forget". İki ad da
 * kütüphanedeki bir makalenin ön bilgisinde ya da sözlüğünde geçmeli; hiçbir
 * yerde olmayan adlar arasında bağ kurulmuyor.
 */
export async function PUT(request: Request) {
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: "The request is too large." }, { status: 413 });
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return noStore({ error: parsed.error.issues[0]?.message ?? "The request is not valid." }, { status: 400 });
    const { a, b, decision, proposedBy, reason } = parsed.data;
    const projects = await listStoredProjects();
    const known = new Set(
      projects.flatMap((project) => [...(project.primer?.concepts ?? []).map((concept) => concept.term), ...project.evidence.glossary.map((item) => item.term)]).flatMap(conceptKeys),
    );
    if (decision !== "forget" && ![a, b].every((term) => conceptKeys(term).some((key) => known.has(key)))) {
      return noStore({ error: "Both names must be concepts of a paper in your library." }, { status: 404 });
    }
    const now = new Date().toISOString();
    const file = await updateConceptAliases((current) => (decision === "forget" ? forgetAlias(current, a, b) : decideAlias(current, a, b, decision, proposedBy, now, reason)));
    return noStore({ ok: true, ...file });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    return noStore({ error: error instanceof Error ? error.message : "The concept link could not be saved." }, { status: 400 });
  }
}
