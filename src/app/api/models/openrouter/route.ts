import { z } from "zod";

export const runtime = "nodejs";

const inputSchema = z.object({ apiKey: z.string().min(1) });
const modelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().optional(),
  pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).optional(),
  architecture: z.object({
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()).optional(),
  }).optional(),
  supported_parameters: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "OpenRouter API key gerekli." }, { status: 400 });

  const url = new URL("https://openrouter.ai/api/v1/models/user");
  url.searchParams.set("supported_parameters", "structured_outputs");
  url.searchParams.set("output_modalities", "text");
  url.searchParams.set("sort", "most-popular");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${parsed.data.apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    return Response.json(
      { error: response.status === 401 ? "The OpenRouter API key is not valid." : "The OpenRouter model catalogue could not be loaded." },
      { status: response.status === 401 ? 401 : 502 },
    );
  }

  const payload = await response.json() as { data?: unknown[] };
  const models = (payload.data ?? [])
    .map((value) => modelSchema.safeParse(value))
    .filter((result) => result.success)
    .filter(({ data }) =>
      data.architecture?.output_modalities?.includes("text") &&
      !data.architecture?.output_modalities?.includes("image") &&
      data.supported_parameters?.includes("structured_outputs"),
    )
    .map(({ data }) => ({
      id: data.id,
      label: data.name ?? data.id,
      contextLength: data.context_length,
      pricing: data.pricing,
      inputModalities: data.architecture?.input_modalities ?? [],
      outputModalities: data.architecture?.output_modalities ?? [],
    }))
    .slice(0, 150);
  return Response.json({ models }, { headers: { "Cache-Control": "no-store" } });
}
