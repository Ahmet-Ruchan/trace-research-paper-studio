import { z } from "zod";
import { addMember, changePassword, currentMember, listMembers, removeMember, sessionToken } from "@/lib/server/team-store";
import { teamBody, teamFailure, teamJson } from "@/lib/server/team-http";
import { serverText } from "@/lib/server/server-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sahip: yeni bir üye (ad ve ilk parolası; üye sonra kendi parolasını değiştiriyor). */
export async function POST(request: Request) {
  try {
    const body = z.object({ name: z.string(), password: z.string(), role: z.enum(["owner", "member"]).default("member") }).parse(await teamBody(request));
    const member = addMember(currentMember(request), body.name, body.password, body.role);
    return teamJson({ ok: true, member, ...listMembers() });
  } catch (error) {
    return teamFailure(error, serverText(request));
  }
}

/** Sahip: bir üyeyi çıkarmak; notları ve oyları kalıyor, oturumları kapanıyor. */
export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return teamJson({ error: serverText(request).team.memberIdRequired }, { status: 400 });
    removeMember(currentMember(request), id);
    return teamJson({ ok: true, ...listMembers() });
  } catch (error) {
    return teamFailure(error, serverText(request));
  }
}

/** Kendi parolası: eskisi doğruysa; öbür cihazlardaki oturumlar kapanıyor. */
export async function PATCH(request: Request) {
  try {
    const body = z.object({ current: z.string().max(1000), next: z.string() }).parse(await teamBody(request));
    changePassword(currentMember(request), body.current, body.next, sessionToken(request.headers.get("cookie")));
    return teamJson({ ok: true });
  } catch (error) {
    return teamFailure(error, serverText(request));
  }
}
