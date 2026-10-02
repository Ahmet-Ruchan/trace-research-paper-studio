import { z } from "zod";
import { serverText } from "@/lib/server/server-text";
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
  /** Her yönde kaç çalışma; kavram önerileri daha geniş bir kaynak listesine bakıyor. */
  limit: z.number().int().min(4).max(50).optional(),
  /** Kaynakların özetleri de gelsin: kavram önerileri özette geçen kavramları da arıyor. */
  abstracts: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: serverText(request).citations.titleRequired }, { status: 400 });
  const { limit, abstracts, ...paper } = parsed.data;
  const graph = await fetchCitationGraph(paper, { limit: limit ?? 12, abstracts: abstracts ?? false });
  return Response.json(graph, { headers: { "Cache-Control": "no-store" } });
}
