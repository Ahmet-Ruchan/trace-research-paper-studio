/**
 * Geri alınabilir silme.
 *
 * Kütüphaneden silmek kalıcı: proje dosyası, bütün sürüm geçmişi, etiketleri
 * ve yayımlanmış bağlantıları gidiyor. Eskiden tek güvence tarayıcının onay
 * penceresiydi; alışkanlıkla "Tamam"a basan kullanıcı her şeyi kaybediyordu.
 *
 * Artık silme hemen görünür ama sunucuya bir süre sonra gidiyor; o sürede
 * "Undo" her şeyi olduğu gibi geri getiriyor, çünkü henüz hiçbir şey
 * silinmedi. Sunucuda "çöp kutusu" yok: yayımlanmış bağlantılar ve etiketler
 * ancak silme gerçekten gerçekleşince kapanıyor.
 *
 * Bekleyen silme kullanıcının niyeti; kaybolmamalı. Kütüphaneden ayrılınca ya
 * da sayfa kapanırken hemen tamamlanıyor (`flush`).
 */
export const UNDO_WINDOW_MS = 8_000;

export type FlushReason = "timeout" | "replaced" | "left" | "pagehide";

export class PendingDeletion<Item extends { id: string }> {
  private pending?: { item: Item; timer: ReturnType<typeof setTimeout> };

  constructor(
    private readonly commit: (item: Item, reason: FlushReason) => void,
    private readonly onChange: (item: Item | undefined) => void,
    private readonly windowMs = UNDO_WINDOW_MS,
  ) {}

  get current() {
    return this.pending?.item;
  }

  /** Bir önceki bekleyen silme varsa önce o tamamlanıyor: iki silme birbirini geri alamaz. */
  schedule(item: Item) {
    this.flush("replaced");
    const timer = setTimeout(() => this.flush("timeout"), this.windowMs);
    this.pending = { item, timer };
    this.onChange(item);
  }

  /** Bekleyen silmeyi iptal eder ve geri getirilecek öğeyi döner. */
  undo(): Item | undefined {
    if (!this.pending) return undefined;
    clearTimeout(this.pending.timer);
    const { item } = this.pending;
    this.pending = undefined;
    this.onChange(undefined);
    return item;
  }

  flush(reason: FlushReason) {
    if (!this.pending) return;
    const { item, timer } = this.pending;
    clearTimeout(timer);
    this.pending = undefined;
    this.onChange(undefined);
    this.commit(item, reason);
  }
}
