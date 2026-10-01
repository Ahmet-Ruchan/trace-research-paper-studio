import { z } from "zod";
import { clearedSessionCookie, listMembers, sessionCookie, sessionToken, signIn, signOut } from "@/lib/server/team-store";
import { teamBody, teamFailure, teamJson } from "@/lib/server/team-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Giriş: ad ve parola; doğruysa HttpOnly oturum çerezi. */
export async function POST(request: Request) {
  try {
    const body = z.object({ name: z.string().max(200), password: z.string().max(1000) }).parse(await teamBody(request));
    const { token, member } = signIn(body.name, body.password);
    return teamJson({ ok: true, me: member, ...listMembers() }, { cookie: sessionCookie(token, request) });
  } catch (error) {
    return teamFailure(error);
  }
}

/** Çıkış: bu oturum siliniyor, çerez temizleniyor. */
export async function DELETE(request: Request) {
  try {
    signOut(sessionToken(request.headers.get("cookie")));
    return teamJson({ ok: true }, { cookie: clearedSessionCookie() });
  } catch (error) {
    return teamFailure(error);
  }
}
