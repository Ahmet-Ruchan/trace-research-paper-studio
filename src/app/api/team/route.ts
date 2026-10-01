import { z } from "zod";
import { createFirstOwner, currentMember, listMembers, readTeam, sessionCookie, setApprovalsNeeded } from "@/lib/server/team-store";
import { teamBody, teamFailure, teamJson } from "@/lib/server/team-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ekip kipinin durumu (`team.ts`): açık mı, kim oturum açmış, üyeler ve kaç
 * onay gerektiği. Oturumsuz da okunabiliyor (giriş ekranı için), ama o zaman
 * yalnızca açık olup olmadığı söyleniyor.
 */
export async function GET(request: Request) {
  try {
    const team = readTeam();
    const me = currentMember(request);
    if (!team.members.length) return teamJson({ enabled: false });
    if (!me) return teamJson({ enabled: true });
    return teamJson({ enabled: true, me, ...listMembers() });
  } catch (error) {
    return teamFailure(error);
  }
}

/** İlk hesap: ekip kipini açıyor; açan kişi sahip ve oturumu açık. */
export async function POST(request: Request) {
  try {
    const body = z.object({ name: z.string(), password: z.string() }).parse(await teamBody(request));
    const { token, member } = createFirstOwner(body.name, body.password);
    return teamJson({ ok: true, me: member, ...listMembers() }, { cookie: sessionCookie(token, request) });
  } catch (error) {
    return teamFailure(error);
  }
}

/** Sahip: bir iddianın onaylı sayılması için gereken onay sayısı. */
export async function PUT(request: Request) {
  try {
    const body = z.object({ approvalsNeeded: z.number() }).parse(await teamBody(request));
    setApprovalsNeeded(currentMember(request), body.approvalsNeeded);
    return teamJson({ ok: true, ...listMembers() });
  } catch (error) {
    return teamFailure(error);
  }
}
