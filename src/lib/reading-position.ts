import { z } from "zod";

/**
 * Kaldığın yer: hikâyede ya da derin raporda en son okunan bölüm.
 *
 * Bu cihaza ait bir kolaylık, okuyucunun kaydı değil: tarayıcıda tutuluyor
 * (`trace-reading-positions`). Başka bir cihazda başka bir yerde kalınmış
 * olabilir; yedeğe ya da projeye girmiyor. Makale başına tek konum, en yeni
 * `MAX_POSITIONS` makale.
 */

export const READING_POSITIONS_KEY = "trace-reading-positions";
export const MAX_POSITIONS = 200;

export const readingPositionSchema = z.object({
  place: z.enum(["story", "report"]),
  sectionId: z.string().min(1).max(200),
  title: z.string().max(300),
  /** Bölümün sırası (0'dan) ve bölüm sayısı: "4 / 8". */
  index: z.number().int().min(0).max(999),
  total: z.number().int().min(1).max(1000),
  at: z.string().max(40),
});
export type ReadingPosition = z.infer<typeof readingPositionSchema>;

type Store = Pick<Storage, "getItem" | "setItem">;

export function parsePositions(raw: string | null): Record<string, ReadingPosition> {
  try {
    const value = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    const positions: Record<string, ReadingPosition> = {};
    for (const [id, position] of Object.entries(value ?? {})) {
      const parsed = readingPositionSchema.safeParse(position);
      if (parsed.success) positions[id] = parsed.data;
    }
    return positions;
  } catch {
    return {};
  }
}

export function readPositions(store: Store | undefined): Record<string, ReadingPosition> {
  try {
    return store ? parsePositions(store.getItem(READING_POSITIONS_KEY)) : {};
  } catch {
    return {};
  }
}

/** Konumu yazar; en eskiler düşüyor. Depolama kapalıysa (gizli pencere) sessizce vazgeçiyor. */
export function savePosition(store: Store | undefined, projectId: string, position: ReadingPosition) {
  if (!store) return;
  const positions = { ...readPositions(store), [projectId]: position };
  const kept = Object.entries(positions).sort((left, right) => right[1].at.localeCompare(left[1].at)).slice(0, MAX_POSITIONS);
  try {
    store.setItem(READING_POSITIONS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Depolama dolu ya da kapalı: kaldığın yer yalnızca bir kolaylık.
  }
}

/** Devam etmeye değer mi: ilk bölümdeyse yeniden başlamak aynı şey. */
export const worthContinuing = (position: ReadingPosition | undefined): position is ReadingPosition => Boolean(position && position.index > 0);

export const positionLabel = (position: ReadingPosition) => `${position.index + 1} of ${position.total}: ${position.title}`;
