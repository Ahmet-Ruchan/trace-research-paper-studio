import { z } from "zod";
import { MAX_ALIAS_DECISIONS, pairKey, type AliasFile } from "./concept-aliases";
import { MAX_TAGS_PER_PROJECT, tagKey } from "./library-tags";
import { WORK_DATA_KIND } from "./profile";
import { MAX_NOTES_PER_PAPER, type ReaderNote } from "./reader-notes";
import { workLogSchema } from "./work-log";

/**
 * Tam yedek: okuyucunun Trace'te tuttuğu her şey tek dosyada.
 *
 * Sürüm 1 yalnızca profil ve çalışma kaydıydı. Sürüm 2 kütüphanenin yanında
 * tutulan okuyucu kayıtlarını da taşıyor: çalışma ilerlemesi ve tekrar
 * kartları, notlar ve vurgular, okuma listesi, etiketler, kavram eşleri ve
 * istenirse makalelerin kendisi.
 *
 * İçe aktarma BİRLEŞTİRİYOR, hiçbir şey silmiyor: buradaki bir makalenin
 * üzerine yazılmıyor, aynı not için daha yeni olan kalıyor, çalışma ilerlemesi
 * iki cihazdaki gibi birleşiyor (`mergeStudyProgress`), okuyucunun burada
 * verdiği bir kavram kararı dosyadakiyle değişmiyor. Her parça kendi şemasıyla
 * ayrı okunuyor: bozuk bir parça diğerlerini düşürmüyor.
 */

export const BACKUP_VERSION = 2;
export const MAX_BACKUP_PAPERS = 5000;

export const backupFileSchema = z.object({
  kind: z.literal(WORK_DATA_KIND),
  version: z.union([z.literal(1), z.literal(BACKUP_VERSION)]),
  exportedAt: z.string().max(40).optional(),
  profile: z.unknown().optional(),
  log: workLogSchema,
  library: z
    .object({
      papers: z.array(z.unknown()).max(MAX_BACKUP_PAPERS).optional(),
      study: z.unknown().optional(),
      notes: z.unknown().optional(),
      readingList: z.unknown().optional(),
      tags: z.unknown().optional(),
      aliases: z.unknown().optional(),
    })
    .optional(),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

/** Aynı not iki yerde: daha yeni düzenlenen kalıyor. Buradaki sıra korunuyor, yeniler sona ekleniyor. */
export function mergeNotes(current: readonly ReaderNote[], incoming: readonly ReaderNote[]): ReaderNote[] {
  const byId = new Map(current.map((note) => [note.id, note]));
  const order = current.map((note) => note.id);
  for (const note of incoming) {
    const existing = byId.get(note.id);
    if (!existing) order.push(note.id);
    if (!existing || note.updatedAt > existing.updatedAt) byId.set(note.id, note);
  }
  return order.map((id) => byId.get(id)!).slice(0, MAX_NOTES_PER_PAPER);
}

/** Etiketlerin birleşimi; aynı etiketin başka yazımı ikinci kez eklenmiyor. */
export function mergeTags(current: readonly string[], incoming: readonly string[]): string[] {
  const merged = [...current];
  const keys = new Set(current.map(tagKey));
  for (const tag of incoming) {
    if (keys.has(tagKey(tag)) || merged.length >= MAX_TAGS_PER_PROJECT) continue;
    keys.add(tagKey(tag));
    merged.push(tag);
  }
  return merged;
}

/** Dosyadaki kavram kararları yalnızca burada karar verilmemiş çiftler için ekleniyor. */
export function mergeAliasFiles(current: AliasFile, incoming: AliasFile): { file: AliasFile; added: number } {
  const decided = new Set(current.decisions.map((item) => pairKey(...item.terms)));
  const fresh = incoming.decisions.filter((item) => {
    const key = pairKey(...item.terms);
    if (!key || decided.has(key)) return false;
    decided.add(key);
    return true;
  });
  return { file: { version: 1, decisions: [...current.decisions, ...fresh].slice(-MAX_ALIAS_DECISIONS) }, added: fresh.length };
}

export type BackupSummary = {
  papersAdded: number;
  papersKept: number;
  papersUnreadable: number;
  studyMerged: number;
  notesAdded: number;
  readingAdded: number;
  tagsMerged: number;
  aliasesAdded: number;
  /** Kütüphanede olmayan makalelere ait kayıtlar: makale olmadan yazılmıyor. */
  withoutPaper: number;
};

export const emptyBackupSummary = (): BackupSummary => ({ papersAdded: 0, papersKept: 0, papersUnreadable: 0, studyMerged: 0, notesAdded: 0, readingAdded: 0, tagsMerged: 0, aliasesAdded: 0, withoutPaper: 0 });

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

/** İçe aktarma özetinin parçaları; Türkçesi `src/i18n/messages/server.ts`'te. */
export const backupImportText = {
  sessionsAdded: (sessions: number) => `${count(sessions, "session", "sessions")} added`,
  profileAdopted: "the profile in the file taken over",
  papersAdded: (papers: number) => `${count(papers, "paper", "papers")} added to your library`,
  papersKept: (papers: number) => `${count(papers, "paper", "papers")} already here kept as they are`,
  studyMerged: (papers: number) => `study progress merged for ${count(papers, "paper", "papers")}`,
  notesAdded: (notes: number) => `${count(notes, "note", "notes")} added`,
  readingAdded: (works: number) => `${count(works, "work", "works")} added to your reading list`,
  tagsMerged: (papers: number) => `tags merged for ${count(papers, "paper", "papers")}`,
  aliasesAdded: (links: number) => `${count(links, "concept link", "concept links")} added`,
  withoutPaper: (records: number) => `${count(records, "record", "records")} left out because the paper is not in your library`,
  papersUnreadable: (papers: number) => `${count(papers, "paper", "papers")} in the file could not be read`,
  /** Parçalar tek cümlede: ilk harf büyük, sonda hiçbir şeyin silinmediği. */
  sentence: (parts: readonly string[]) => {
    const text = parts.join(", ");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}. Nothing was removed.`;
  },
};

export type BackupImportText = typeof backupImportText;

/** İçe aktarmanın okuyucuya söylenişi (`text` arayüzün dilinde); yalnızca bir şey değiştiyse. */
export function describeBackupImport(sessions: number, profileAdopted: boolean, summary?: BackupSummary, text: BackupImportText = backupImportText) {
  const parts = [text.sessionsAdded(sessions)];
  if (profileAdopted) parts.push(text.profileAdopted);
  if (summary) {
    if (summary.papersAdded) parts.push(text.papersAdded(summary.papersAdded));
    if (summary.papersKept) parts.push(text.papersKept(summary.papersKept));
    if (summary.studyMerged) parts.push(text.studyMerged(summary.studyMerged));
    if (summary.notesAdded) parts.push(text.notesAdded(summary.notesAdded));
    if (summary.readingAdded) parts.push(text.readingAdded(summary.readingAdded));
    if (summary.tagsMerged) parts.push(text.tagsMerged(summary.tagsMerged));
    if (summary.aliasesAdded) parts.push(text.aliasesAdded(summary.aliasesAdded));
    if (summary.withoutPaper) parts.push(text.withoutPaper(summary.withoutPaper));
    if (summary.papersUnreadable) parts.push(text.papersUnreadable(summary.papersUnreadable));
  }
  return text.sentence(parts);
}
