import { ZodError } from "zod";
import type { Messages } from "@/i18n/messages";
import { errorMessage, UserFacingError } from "../user-error";
import { TeamError } from "./team-store";

/** Ekip API'lerinin ortak yanıtları: önbelleğe alınmıyor, hatalar okunur bir cümle. */
export function teamJson(body: unknown, init?: ResponseInit & { cookie?: string }) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  if (init?.cookie) headers.append("Set-Cookie", init.cookie);
  return Response.json(body, { ...init, headers });
}

/** Hata yanıtı, isteği yapanın dilinde (`t`: `requestMessages(request).server`). */
export function teamFailure(error: unknown, t: Messages["server"]) {
  if (error instanceof TeamError) return teamJson({ error: errorMessage(error, t.errors, t.team.changeFailed) }, { status: error.status });
  if (error instanceof UserFacingError) return teamJson({ error: errorMessage(error, t.errors, t.team.changeFailed) }, { status: 500 });
  if (error instanceof ZodError) return teamJson({ error: error.issues[0]?.message ?? t.team.detailsInvalid }, { status: 400 });
  if (error instanceof SyntaxError) return teamJson({ error: t.request.invalidJson }, { status: 400 });
  return teamJson({ error: error instanceof Error ? error.message : t.team.changeFailed }, { status: 500 });
}

/** Küçük bir JSON gövdesi: ekip istekleri birkaç alan taşıyor. */
export async function teamBody(request: Request) {
  const text = await request.text();
  if (text.length > 4096) throw new TeamError(413, "requestTooLarge");
  return JSON.parse(text || "{}") as Record<string, unknown>;
}
