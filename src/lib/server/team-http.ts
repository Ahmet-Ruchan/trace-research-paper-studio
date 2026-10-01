import { ZodError } from "zod";
import { TeamError } from "./team-store";

/** Ekip API'lerinin ortak yanıtları: önbelleğe alınmıyor, hatalar okunur bir cümle. */
export function teamJson(body: unknown, init?: ResponseInit & { cookie?: string }) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  if (init?.cookie) headers.append("Set-Cookie", init.cookie);
  return Response.json(body, { ...init, headers });
}

export function teamFailure(error: unknown) {
  if (error instanceof TeamError) return teamJson({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return teamJson({ error: error.issues[0]?.message ?? "The details are not valid." }, { status: 400 });
  if (error instanceof SyntaxError) return teamJson({ error: "The request is not valid JSON." }, { status: 400 });
  return teamJson({ error: error instanceof Error ? error.message : "The team could not be changed." }, { status: 500 });
}

/** Küçük bir JSON gövdesi: ekip istekleri birkaç alan taşıyor. */
export async function teamBody(request: Request) {
  const text = await request.text();
  if (text.length > 4096) throw new TeamError("The request is too large.", 413);
  return JSON.parse(text || "{}") as Record<string, unknown>;
}
