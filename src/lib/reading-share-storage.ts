import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pagesFor } from "@/i18n/messages/pages";
import { aliasMap } from "./concept-aliases";
import { readingOrder } from "./reading-order";
import { readingShareIdPattern, readingShareSchema, readingShareWorks, summarizeReadingShare, type ReadingShare, type ReadingShareWords } from "./reading-share";
import { atomicWrite, listStoredProjects, readAllStudyProgress, readConceptAliases, readReadingList, tracePublicationDirectory } from "./trace-storage";

/**
 * Paylaşılan okuma listelerinin kayıtları (`reading-share.ts`), yayınların
 * yanında: `~/.trace/publications/<kimlik>.reading-list.json`.
 *
 * Kaydın dili (`language`) paylaşanın arayüz dili; çalışmaların "neden
 * burada" cümleleri ve boş başlığın yerine geçen ad o dilde yazılıyor.
 */

const NAME = /^([a-f0-9]{20})\.reading-list\.json$/;

function shareFile(id: string) {
  if (!readingShareIdPattern.test(id)) throw new Error("The link id is not valid.");
  return join(tracePublicationDirectory(), `${id}.reading-list.json`);
}

/** Listenin şu anki hâli, kütüphanenin okuma sırasına yerleştirilmiş. */
async function currentWorks(includePapers: boolean, words: ReadingShareWords) {
  const [projects, study, aliases, list] = await Promise.all([listStoredProjects(), readAllStudyProgress(), readConceptAliases(), readReadingList()]);
  return readingShareWorks(readingOrder(projects, study, aliasMap(aliases)), list, projects, includePapers, words);
}

export async function readReadingShare(id: string): Promise<ReadingShare | undefined> {
  if (!readingShareIdPattern.test(id)) return undefined;
  try {
    const parsed = readingShareSchema.safeParse(JSON.parse(await readFile(shareFile(id), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function writeShare(share: ReadingShare) {
  await mkdir(tracePublicationDirectory(), { recursive: true, mode: 0o700 });
  await atomicWrite(shareFile(share.id), `${JSON.stringify(readingShareSchema.parse(share))}\n`);
}

export async function listReadingShares() {
  let names: string[] = [];
  try {
    names = await readdir(tracePublicationDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const now = new Date().toISOString();
  const shares = await Promise.all(names.flatMap((name) => {
    const id = NAME.exec(name)?.[1];
    return id ? [readReadingShare(id)] : [];
  }));
  return shares.filter((share): share is ReadingShare => Boolean(share)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((share) => summarizeReadingShare(share, now));
}

export async function createReadingShare(input: { title: string; expiresAt: string | null; includePapers: boolean; language?: ReadingShare["language"] }) {
  const now = new Date().toISOString();
  const language = input.language ?? "en";
  const words = pagesFor(language).readingShare;
  const works = await currentWorks(input.includePapers, words);
  if (!works.some((work) => work.kind === "saved")) return undefined;
  const share: ReadingShare = {
    version: 1,
    // 80 bit rastgelelik: bağlantı tek erişim denetimi, tahmin edilememeli.
    id: randomUUID().replace(/-/g, "").slice(0, 20),
    title: input.title.trim() || words.defaultTitle,
    createdAt: now,
    updatedAt: now,
    status: "live",
    expiresAt: input.expiresAt,
    includePapers: input.includePapers,
    language,
    works,
  };
  await writeShare(share);
  return summarizeReadingShare(share, now);
}

export type ReadingSharePatch = { status?: ReadingShare["status"]; expiresAt?: string | null; title?: string; includePapers?: boolean; refresh?: boolean };

/** Ayar değişikliği kopyayı yenilemiyor; listenin güncel hâli ancak "güncelle" ile gidiyor. */
export async function updateReadingShare(id: string, patch: ReadingSharePatch) {
  const share = await readReadingShare(id);
  if (!share) return undefined;
  const now = new Date().toISOString();
  const includePapers = patch.includePapers ?? share.includePapers;
  const next: ReadingShare = {
    ...share,
    updatedAt: now,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
    ...(patch.title?.trim() ? { title: patch.title.trim().slice(0, 120) } : {}),
    includePapers,
    // Yenilenen kopya da paylaşıldığı dilde kalıyor.
    ...(patch.refresh || patch.includePapers !== undefined ? { works: await currentWorks(includePapers, pagesFor(share.language).readingShare) } : {}),
  };
  await writeShare(next);
  return summarizeReadingShare(next, now);
}

export async function deleteReadingShare(id: string) {
  try {
    await unlink(shareFile(id));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
