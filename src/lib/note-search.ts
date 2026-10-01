import { searchTerms } from "./library-search";
import { groupNotes, type NoteGroup, type ReaderNote } from "./reader-notes";
import type { ResearchProject } from "./schema";
import { foldForSearch } from "./search-text";

/**
 * Kütüphane aramasında okuyucunun notları ve vurguları.
 *
 * İddia araması makalelerin ne dediğini buluyor; bu arama okuyucunun ne
 * düşündüğünü ve neyi işaretlediğini. Her not yeriyle (hikâye, rapor,
 * Primer ya da iddia ve başlığı) geliyor. Yalnızca "önemli" işareti olan,
 * metni olmayan kayıtlar aranmıyor: aranacak bir şey yok.
 */

export const DEFAULT_NOTE_LIMIT = 60;

type IndexedNote = { project: ResearchProject; note: ReaderNote; place: NoteGroup["place"]; heading: string; text: string; quote: string; title: string };
export type NoteIndex = readonly IndexedNote[];
export type NoteHit = { project: ResearchProject; note: ReaderNote; place: NoteGroup["place"]; heading: string };
export type NoteSearch = { terms: string[]; hits: NoteHit[]; total: number; papers: number };

export function buildNoteIndex(projects: readonly ResearchProject[], notes: ReadonlyMap<string, readonly ReaderNote[]>): NoteIndex {
  return projects.flatMap((project) =>
    groupNotes(project, notes.get(project.id) ?? []).flatMap((group) =>
      group.notes
        .filter((note) => note.text || note.quote)
        .map((note) => ({ project, note, place: group.place, heading: group.heading, text: foldForSearch(note.text), quote: foldForSearch(note.quote ?? ""), title: foldForSearch(group.heading) })),
    ),
  );
}

/**
 * Her kelime notun metninde, vurgusunda ya da yerinin başlığında geçmeli.
 * Okuyucunun kendi yazdığı ve vurguladığı başlıktan ağır basıyor; en yeni
 * notlar eşit puanda önce.
 */
export function searchNotes(index: NoteIndex, query: string, limit = DEFAULT_NOTE_LIMIT): NoteSearch {
  const terms = searchTerms(query);
  if (!terms.length) return { terms, hits: [], total: 0, papers: 0 };
  const scored = index.flatMap((entry) => {
    let score = 0;
    for (const term of terms) {
      if (entry.text.includes(term) || entry.quote.includes(term)) score += 2;
      else if (entry.title.includes(term)) score += 1;
      else return [];
    }
    return [{ entry, score }];
  });
  scored.sort((left, right) => right.score - left.score || right.entry.note.updatedAt.localeCompare(left.entry.note.updatedAt));
  return {
    terms,
    total: scored.length,
    papers: new Set(scored.map(({ entry }) => entry.project.id)).size,
    hits: scored.slice(0, limit).map(({ entry }) => ({ project: entry.project, note: entry.note, place: entry.place, heading: entry.heading })),
  };
}
