import { parseAliasFile } from "@/lib/concept-aliases";
import { collectBackup } from "@/lib/backup-storage";
import { backupFileSchema, emptyBackupSummary, mergeAliasFiles, mergeNotes, mergeTags, type BackupSummary } from "@/lib/full-backup";
import { parseLibraryTags } from "@/lib/library-tags";
import { isProfile, profileSchema } from "@/lib/profile";
import { parseNotesFile } from "@/lib/reader-notes";
import { addToReadingList, parseReadingList } from "@/lib/reading-list";
import { researchProjectSchema } from "@/lib/schema";
import { parseStudyFile } from "@/lib/study-path";
import { mergeStudyProgress } from "@/lib/study-transfer";
import { mergeWorkLogs } from "@/lib/work-log";
import {
  listStoredProjects,
  readAllReaderNotes,
  readAllStudyProgress,
  readLibraryTags,
  readStoredProject,
  readWorkLog,
  saveReaderNotes,
  saveStoredProject,
  saveStoredProjectTags,
  saveStudyProgress,
  updateConceptAliases,
  updateProfile,
  updateReadingList,
  updateWorkLog,
} from "@/lib/trace-storage";
import { ownerOnlyInTeam } from "@/lib/server/team-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Makaleler de dosyada olabildiği için sınır geniş; yüz makalelik bir kütüphane kırk megabayt civarı. */
const MAX_BODY_BYTES = 300 * 1024 * 1024;

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/**
 * Okuyucunun bütün verisi tek dosyada (`full-backup.ts`). `?papers=0` ile
 * makaleler dışarıda kalıyor; dosya küçülüyor, okuyucunun kayıtları yine tam.
 */
export async function GET(request?: Request) {
  const blocked = request ? ownerOnlyInTeam(request) : undefined;
  if (blocked) return blocked;
  try {
    const withPapers = request ? new URL(request.url).searchParams.get("papers") !== "0" : true;
    return noStore(await collectBackup({ withPapers }));
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Your data could not be read." }, { status: 500 });
  }
}

/**
 * İçe aktarma BİRLEŞTİRİYOR: oturumlar kimliğe göre, eski günler büyük olanla.
 * Profil yalnızca buradaki hiç doldurulmamışsa alınıyor. Kütüphane kayıtları
 * için kurallar `full-backup.ts`'te: hiçbir şey silinmiyor, buradaki bir
 * makalenin üzerine yazılmıyor.
 */
export async function POST(request: Request) {
  const blocked = ownerOnlyInTeam(request);
  if (blocked) return blocked;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: "The file is larger than 300 MB." }, { status: 413 });
    const parsed = backupFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return noStore({ error: "This is not a Trace data file." }, { status: 400 });
    const before = (await readWorkLog()).sessions.length;
    const log = await updateWorkLog((current) => mergeWorkLogs(current, parsed.data.log));
    let profileAdopted = false;
    if (isProfile(parsed.data.profile)) {
      const incoming = profileSchema.parse(parsed.data.profile);
      await updateProfile((current) => {
        const untouched = !current.firstName && !current.lastName && current.createdAt === current.updatedAt;
        if (!untouched) return current;
        profileAdopted = true;
        return { ...incoming, updatedAt: new Date().toISOString() };
      });
    }
    const library = parsed.data.library ? await importLibrary(parsed.data.library) : undefined;
    return noStore({ ok: true, added: log.sessions.length - before, sessions: log.sessions.length, profileAdopted, ...(library ? { library } : {}) });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The file is not valid JSON." }, { status: 400 });
    return noStore({ error: error instanceof Error ? error.message : "Your data could not be imported." }, { status: 500 });
  }
}

async function importLibrary(library: NonNullable<ReturnType<typeof backupFileSchema.parse>["library"]>): Promise<BackupSummary> {
  const summary = emptyBackupSummary();
  const now = new Date().toISOString();

  // Önce makaleler: kayıtlar ancak makalesi kütüphanedeyse yazılıyor.
  for (const raw of library.papers ?? []) {
    const paper = researchProjectSchema.safeParse(raw);
    if (!paper.success) {
      summary.papersUnreadable += 1;
      continue;
    }
    if (await readStoredProject(paper.data.id)) summary.papersKept += 1;
    else {
      await saveStoredProject(paper.data, { reason: "import" });
      summary.papersAdded += 1;
    }
  }
  const here = new Set((await listStoredProjects()).map((project) => project.id));

  const study = parseStudyFile(library.study);
  if (study.size) {
    const current = await readAllStudyProgress();
    for (const [id, progress] of study) {
      if (!here.has(id)) {
        summary.withoutPaper += 1;
        continue;
      }
      const mine = current.get(id);
      const merged = mergeStudyProgress(mine, progress, now);
      // Birleşince yalnızca güncelleme zamanı değişiyorsa yazılmıyor: aynı dosya iki kez yüklenebilir.
      if (mine && JSON.stringify({ ...merged, updatedAt: "" }) === JSON.stringify({ ...mine, updatedAt: "" })) continue;
      await saveStudyProgress(id, merged);
      summary.studyMerged += 1;
    }
  }

  const notes = parseNotesFile(library.notes);
  if (notes.size) {
    const current = await readAllReaderNotes();
    for (const [id, incoming] of notes) {
      if (!here.has(id)) {
        summary.withoutPaper += 1;
        continue;
      }
      const mine = current.get(id) ?? [];
      const merged = mergeNotes(mine, incoming);
      if (JSON.stringify(merged) === JSON.stringify(mine)) continue;
      await saveReaderNotes(id, merged);
      summary.notesAdded += merged.length - mine.length;
    }
  }

  const reading = parseReadingList(library.readingList);
  if (reading.length) {
    await updateReadingList((items) => {
      let next = items;
      for (const item of reading) {
        try {
          const grown = addToReadingList(next, item);
          if (grown.length > next.length) summary.readingAdded += 1;
          next = grown;
        } catch {
          // Liste dolu: kalanlar eklenmiyor, var olanlar kalıyor.
          break;
        }
      }
      return next;
    });
  }

  const tags = parseLibraryTags(library.tags);
  if (tags.size) {
    const current = await readLibraryTags();
    for (const [id, incoming] of tags) {
      if (!here.has(id)) {
        summary.withoutPaper += 1;
        continue;
      }
      const mine = current.get(id) ?? [];
      const merged = mergeTags(mine, incoming);
      if (merged.length === mine.length) continue;
      await saveStoredProjectTags(id, merged);
      summary.tagsMerged += 1;
    }
  }

  if (library.aliases !== undefined) {
    const incoming = parseAliasFile(library.aliases);
    if (incoming.decisions.length) {
      await updateConceptAliases((file) => {
        const merged = mergeAliasFiles(file, incoming);
        summary.aliasesAdded = merged.added;
        return merged.file;
      });
    }
  }
  return summary;
}
