import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { BACKUP_VERSION } from "./full-backup";
import { libraryTagsToJson } from "./library-tags";
import { WORK_DATA_KIND } from "./profile";
import { notesFileToJson } from "./reader-notes";
import { readingListToJson } from "./reading-list";
import { studyFileToJson } from "./study-path";
import {
  atomicWrite,
  listStoredProjects,
  readAllReaderNotes,
  readAllStudyProgress,
  readConceptAliases,
  readLibraryTags,
  readProfile,
  readReadingList,
  readWorkLog,
  traceDataDirectory,
} from "./trace-storage";
import { dayDate, dayKey } from "./work-log";

/**
 * Tam yedeğin sunucu tarafı: "Download my data" ile indirilen dosyayı kuruyor
 * ve haftada bir aynısını `~/.trace/backups/trace-data-<gün>.json` olarak
 * kendiliğinden yazıyor. Günlük yedekler (profil, çalışma kaydı, notlar)
 * yalnızca tek dosyanın bir önceki hâlini tutuyor; haftalık yedek her şeyin,
 * makaleler dahil, bir anlık görüntüsü. En yeni dördü kalıyor.
 */

export const WEEKLY_BACKUP_DAYS = 7;
export const WEEKLY_BACKUPS_KEPT = 4;
const DAY_MS = 86_400_000;
const NAME = /^trace-data-(\d{4}-\d{2}-\d{2})\.json$/;

export async function collectBackup(options: { withPapers: boolean }) {
  const [profile, log, study, notes, readingList, tags, aliases, papers] = await Promise.all([
    readProfile(),
    readWorkLog(),
    readAllStudyProgress(),
    readAllReaderNotes(),
    readReadingList(),
    readLibraryTags(),
    readConceptAliases(),
    options.withPapers ? listStoredProjects() : Promise.resolve(undefined),
  ]);
  return {
    kind: WORK_DATA_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    log,
    library: {
      study: studyFileToJson(study),
      notes: notesFileToJson(notes),
      readingList: readingListToJson(readingList),
      tags: libraryTagsToJson(tags),
      aliases,
      ...(papers ? { papers } : {}),
    },
  };
}

export type WeeklyBackupInfo = { day: string; name: string; path: string; bytes: number };

export function backupDirectory() {
  return join(traceDataDirectory(), "backups");
}

/** Haftalık yedekler, en yenisi önce. */
export async function listWeeklyBackups(): Promise<WeeklyBackupInfo[]> {
  let names: string[] = [];
  try {
    names = await readdir(backupDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const found = await Promise.all(
    names.flatMap((name) => {
      const day = name.match(NAME)?.[1];
      return day ? [stat(join(backupDirectory(), name)).then((info) => ({ day, name, path: join(backupDirectory(), name), bytes: info.size }))] : [];
    }),
  );
  return found.sort((left, right) => right.day.localeCompare(left.day));
}

/**
 * Son yedek bir haftadan eskiyse (ya da hiç yoksa) yenisini yazıyor. Hiçbir
 * şey kaydedilmemiş bir kurulumda yazmıyor: boş yedekler gerçek olanları
 * dörtlü sınırdan itip silerdi.
 */
export async function weeklyBackup(now = new Date()): Promise<{ written: boolean; latest?: WeeklyBackupInfo }> {
  const existing = await listWeeklyBackups();
  const latest = existing[0];
  if (latest && now.getTime() - dayDate(latest.day).getTime() < WEEKLY_BACKUP_DAYS * DAY_MS) return { written: false, latest };
  const backup = await collectBackup({ withPapers: true });
  const { library, log } = backup;
  const empty = !library.papers?.length && !log.sessions.length && !Object.keys(log.archive).length && !library.study.projects.length && !library.notes.projects.length && !library.readingList.items.length;
  if (empty) return { written: false, ...(latest ? { latest } : {}) };
  await atomicWrite(join(backupDirectory(), `trace-data-${dayKey(now)}.json`), `${JSON.stringify(backup)}\n`);
  const all = await listWeeklyBackups();
  for (const old of all.slice(WEEKLY_BACKUPS_KEPT)) await rm(old.path, { force: true });
  return { written: true, latest: all[0] };
}
