import { z } from "zod";
import { notesFileToJson, readerNotesSchema, type ReaderNote } from "@/lib/reader-notes";
import { currentMember, firstOwnerId, memberNames, readTeam } from "@/lib/server/team-store";
import { mergeNotes, visibleNotes, type TeamMember } from "@/lib/team";
import { readAllReaderNotes, readReaderNotes, readStoredProject, saveReaderNotes, updateReaderNotes } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bin not, her biri en çok dört bin karakter: sınır kötüye kullanıma karşı. */
const MAX_BODY_BYTES = 1024 * 1024;

const bodySchema = z.object({ notes: readerNotesSchema });

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function projectIdOf(request: Request) {
  return new URL(request.url).searchParams.get("id")?.trim();
}

/**
 * Ekip kipinde kim okuyor: üye kendi notlarını ve başkalarının paylaştıklarını
 * görüyor (`team.ts`). Ekip kipi kapalıysa `undefined`: notların hepsi tek okuyucunun.
 */
function teamView(request: Request) {
  const team = readTeam();
  if (!team.members.length) return undefined;
  const member = currentMember(request);
  if (!member) throw Object.assign(new Error("Sign in to the studio first."), { status: 401 });
  return { member, owner: firstOwnerId(team), names: memberNames(team) };
}

const shown = (notes: readonly ReaderNote[], view: ReturnType<typeof teamView>) => (view ? visibleNotes(notes, view.member as TeamMember, view.owner, view.names) : [...notes]);

/** `?id=` ile bir makalenin notları; kimliksiz bütün kütüphaneninki (kütüphane araması için). */
export async function GET(request: Request) {
  const projectId = projectIdOf(request);
  try {
    const view = teamView(request);
    if (!projectId) {
      const all = await readAllReaderNotes();
      return noStore(notesFileToJson(new Map([...all].map(([id, notes]) => [id, shown(notes, view)]))));
    }
    return noStore({ notes: shown(await readReaderNotes(projectId), view) });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return noStore({ error: error instanceof Error ? error.message : "Your notes could not be read." }, { status });
  }
}

export async function PUT(request: Request) {
  const projectId = projectIdOf(request);
  if (!projectId) return noStore({ error: "A project id is required." }, { status: 400 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: "The notes are too large." }, { status: 413 });
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return noStore({ error: parsed.error.issues[0]?.message ?? "The notes are not valid." }, { status: 400 });
    // Kütüphanede olmayan bir makaleye not yazılmıyor; hiçbir yerden silinemeyen kayıtlar birikirdi.
    if (!(await readStoredProject(projectId))) return noStore({ error: "The project is not in the library." }, { status: 404 });
    const view = teamView(request);
    // Ekip kipinde gönderilenden yalnızca üyenin kendi notları alınıyor; başkalarınınki diskteki gibi kalıyor.
    const saved = view
      ? await updateReaderNotes(projectId, (stored) => mergeNotes(stored, parsed.data.notes, view.member, view.owner))
      : await saveReaderNotes(projectId, parsed.data.notes);
    return noStore({ ok: true, notes: shown(saved, view) });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    const status = (error as { status?: number }).status ?? 500;
    return noStore({ error: error instanceof Error ? error.message : "Your notes could not be saved." }, { status });
  }
}
