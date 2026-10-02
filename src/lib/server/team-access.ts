import type { ReaderNote } from "../reader-notes";
import { visibleNotes } from "../team";
import { serverText } from "./server-text";
import { currentMember, firstOwnerId, memberNames, readTeam } from "./team-store";

/**
 * Ekip kipinde sunucunun okuduğu notların süzgeci ve yalnızca sahibin
 * yapabildikleri (`team.ts`). Ekip kipi kapalıysa ikisi de hiçbir şey yapmıyor.
 */

/** Bu isteği yapan üyenin görebileceği notlar; ekip kipi kapalıysa hepsi. */
export function notesFilterFor(request: Request): (notes: readonly ReaderNote[]) => ReaderNote[] {
  const team = readTeam();
  if (!team.members.length) return (notes) => [...notes];
  const member = currentMember(request);
  if (!member) return () => [];
  const owner = firstOwnerId(team);
  const names = memberNames(team);
  return (notes) => visibleNotes(notes, member, owner, names);
}

/**
 * Bütün verinin dışa ve içe aktarımı ile yedekler: başka üyelerin özel
 * notlarını da taşıdıkları için ekip kipinde yalnızca sahip. Engel varsa yanıt.
 */
export function ownerOnlyInTeam(request: Request): Response | undefined {
  const team = readTeam();
  if (!team.members.length) return undefined;
  const member = currentMember(request);
  const headers = { "Cache-Control": "no-store" };
  const t = serverText(request).errors;
  if (!member) return Response.json({ error: t.signInToStudio() }, { status: 401, headers });
  if (member.role !== "owner") return Response.json({ error: t.ownerOnlyData() }, { status: 403, headers });
  return undefined;
}
