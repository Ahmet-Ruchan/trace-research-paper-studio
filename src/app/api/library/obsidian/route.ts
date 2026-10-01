import { aliasMap } from "@/lib/concept-aliases";
import { libraryVault } from "@/lib/obsidian-vault";
import { listStoredProjects, readAllReaderNotes, readAllStudyProgress, readConceptAliases, readReadingList } from "@/lib/trace-storage";
import { dayKey } from "@/lib/work-log";
import { zipFiles } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bütün kütüphane bir Obsidian kasası olarak (`obsidian-vault.ts`), tek .zip dosyasında. */
export async function GET() {
  try {
    const [projects, notes, study, aliases, readingList] = await Promise.all([listStoredProjects(), readAllReaderNotes(), readAllStudyProgress(), readConceptAliases(), readReadingList()]);
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
    return Response.json({ error: error instanceof Error ? error.message : "The library could not be exported." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
