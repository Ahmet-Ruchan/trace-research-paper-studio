import { buildStandaloneStory } from "@/lib/export-story";
import { PUBLICATION_HEADERS, publicationState } from "@/lib/publications";
import { researchProjectSchema } from "@/lib/schema";
import { readPublication } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Okuyucunun gördüğü yayın sayfası.
 *
 * Bulunamayan, yayından kaldırılmış ve süresi dolmuş yayınlar AYNI yanıtı
 * alıyor. Farklı yanıtlar, bağlantıyı tahmin etmeye çalışan birine hangi
 * kimliklerin bir zamanlar var olduğunu söylerdi.
 */
function notAvailable() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not available</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2efe7;color:#191b18;font:16px/1.6 Georgia,serif}main{max-width:32rem;padding:24px}h1{font-weight:500;margin:0 0 8px}p{color:#71766f;margin:0}</style></head><body><main><h1>This story is not available</h1><p>The link may be wrong, or its author has unpublished it.</p></main></body></html>`;
  return new Response(html, { status: 404, headers: PUBLICATION_HEADERS });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await readPublication(id).catch(() => undefined);
  if (!record || publicationState(record, new Date().toISOString()) !== "live") return notAvailable();
  const project = researchProjectSchema.safeParse(record.project);
  if (!project.success) return notAvailable();
  return new Response(buildStandaloneStory(project.data), { status: 200, headers: PUBLICATION_HEADERS });
}
