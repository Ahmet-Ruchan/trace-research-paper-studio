import { aliasMap } from "@/lib/concept-aliases";
import { libraryVault } from "@/lib/obsidian-vault";
import { listStoredProjects, readAllReaderNotes, readAllStudyProgress, readConceptAliases, readReadingList } from "@/lib/trace-storage";
import { dayKey } from "@/lib/work-log";
import { zipFiles } from "@/lib/zip";
import { notesFilterFor } from "@/lib/server/team-access";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bütün kütüphane bir Obsidian kasası olarak (`obsidian-vault.ts`), tek .zip dosyasında. */
export async function GET(request: Request) {
  try {
    const [projects, allNotes, study, aliases, readingList] = await Promise.all([listStoredProjects(), readAllReaderNotes(), readAllStudyProgress(), readConceptAliases(), readReadingList()]);
    // Ekip kipinde kasada yalnızca isteyenin görebildiği notlar.
    const visible = notesFilterFor(request);
    const notes = new Map([...allNotes].map(([id, list]) => [id, visible(list)]));
    const now = new Date();
    const files = libraryVault({ projects, notes, study, aliases: aliasMap(aliases), readingList, exportedAt: now.toISOString() });
    return new Response(Buffer.from(zipFiles(files, now)), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="trace-obsidian-${dayKey(now)}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const t = serverText(request);
    return Response.json({ error: errorMessage(error, t.errors, t.obsidian.exportFailed) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
