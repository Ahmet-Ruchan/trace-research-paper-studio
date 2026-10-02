import type { NextRequest } from "next/server";
import { uiLanguageForRequest } from "@/i18n/languages";
import serverMessages from "@/i18n/messages/server";
import { ACCESS_REALM, accessAllowed, isPublicPath } from "@/lib/access-gate";
import { memberForCookie, readTeam } from "@/lib/server/team-store";
import { openWithoutSession } from "@/lib/team";

/**
 * İki kapı, ikisi de isteğe bağlı:
 *
 * 1. `TRACE_ACCESS_PASSWORD` tanımlıysa HTTP Basic parolası (`access-gate.ts`).
 * 2. Ekip kipi açıksa (`~/.trace/team.json`'da hesap varsa) oturum açmış bir
 *    üye (`team.ts`). Stüdyonun sayfası açık kalıyor, giriş ekranını o gösteriyor;
 *    API ve başka her şey üye istiyor.
 *
 * İkisi de yoksa hiçbir şey yapmıyor; yerel kullanım ve plugin teslimi olduğu gibi.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!accessAllowed(pathname, request.headers.get("authorization"), process.env.TRACE_ACCESS_PASSWORD)) {
    return new Response(serverMessages[uiLanguageForRequest(request)].proxy.authenticationRequired, {
      status: 401,
      headers: { "WWW-Authenticate": `Basic realm="${ACCESS_REALM}", charset="UTF-8"`, "Cache-Control": "no-store" },
    });
  }
  if (isPublicPath(pathname) || openWithoutSession(pathname)) return;
  const team = readTeam();
  if (!team.members.length || memberForCookie(request.headers.get("cookie"), team)) return;
  // Metin isteği yapanın dilinde (çerez, yoksa tarayıcının dili). Yalnızca
  // `server` bölümü: vekil her istekte çalışıyor, bütün sözlüğü yüklemesin.
  const headers = { "Cache-Control": "no-store" };
  const signIn = serverMessages[uiLanguageForRequest(request)].errors.signInToStudio();
  if (pathname.startsWith("/api/")) return Response.json({ error: signIn }, { status: 401, headers });
  return new Response(signIn, { status: 401, headers });
}
