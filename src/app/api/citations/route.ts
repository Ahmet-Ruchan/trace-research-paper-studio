import { z } from "zod";
import { fetchCitationGraph } from "../../../../plugins/trace-paper-studio/skills/trace-paper-studio/scripts/lib/citation-graph.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Atıf grafiği — makalenin dayandığı ve onu izleyen çalışmalar.
 *
 * Proje dosyasına YAZILMAZ: kanıt değil dış bağlam, ve atıf sayıları eskiyor.
 * Her açılışta OpenAlex'ten alınır ve alındığı tarihle gösterilir.
 */
const inputSchema = z.object({
  doi: z.string().max(200).optional(),
  title: z.string().min(1).max(400),
  authors: z.array(z.string().max(200)).max(50).optional(),
});

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "A paper title is required." }, { status: 400 });
  const graph = await fetchCitationGraph(parsed.data, { limit: 12 });
  return Response.json(graph, { headers: { "Cache-Control": "no-store" } });
}
