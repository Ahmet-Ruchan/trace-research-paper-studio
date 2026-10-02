import { z } from "zod";
import { canonicalJson, stableHash } from "./canonical-json";
import { groupNotes, ORPHAN_HEADING, type NoteGroup, type ReaderNote } from "./reader-notes";
import { researchProjectSchema, type ResearchProject } from "./schema";

/**
 * Paylaşılabilir yayınlar.
 *
 * Bir yayın, projenin YAYIN ANINDAKİ bir kopyası: sonraki düzenlemeler
 * kendiliğinden dışarı sızmaz, yazar "güncelle" dediğinde yeni kopya alınır.
 * Kopya Trace sunucusunun kendisinden `/p/<kimlik>` adresinde, bağımsız
 * görüntüleyiciyle sunuluyor. Sunucu yalnızca bu makinede çalışıyorsa
 * bağlantı da yalnızca burada açılır; herkese açık bir sunucuya dağıtılırsa
 * bağlantıyı bilen herkes okur. Arayüz bunu açıkça söylüyor.
 *
 * Yayın denetimleri:
 * - Hangi bloklar dışarı çıkar: derin rapor, teknik ek, öğrenme katmanı ve
 *   makalenin kendi şekilleri. Şekiller yazarlarına ait görseller; bir yazar
 *   notlarını paylaşırken onları dışarıda bırakmak isteyebilir.
 * - Kanıt alıntıları ÇIKARILAMAZ: her iddianın sayfaya ve alıntıya bağlı
 *   olması ürünün kendisi. Alıntısız bir yayın doğrulanamaz bir özet olurdu.
 * - Yayından kaldırma kaydı silmez; bağlantı hemen 404 döner, yeniden
 *   yayınlanabilir.
 * - İsteğe bağlı son kullanma tarihi.
 * - Kimlik tahmin edilemez; listeleme ucu yok. "Liste dışı" tek görünürlük.
 */

export const publicationIdPattern = /^[a-f0-9]{20}$/;

export const publicationIncludeSchema = z.object({
  deepReport: z.boolean(),
  technicalAppendix: z.boolean(),
  learning: z.boolean(),
  figures: z.boolean(),
  /** Okuyucunun seçtiği notlar; varsayılan kapalı (eski kayıtlarda yok). */
  notes: z.boolean().default(false),
});
export type PublicationInclude = z.infer<typeof publicationIncludeSchema>;
/** Girdi biçimi: notlar alanı olmayan eski istekler de geçerli (varsayılan kapalı). */
export type PublicationIncludeInput = z.input<typeof publicationIncludeSchema>;

export const defaultPublicationInclude: PublicationInclude = {
  deepReport: true,
  technicalAppendix: true,
  learning: true,
  figures: true,
  notes: false,
};

export const publicationStatusSchema = z.enum(["live", "unpublished"]);

export const publicationSettingsSchema = z.object({
  include: publicationIncludeSchema,
  /** Yayına girecek notların kimlikleri; `include.notes` açıksa. */
  noteIds: z.array(z.string().min(1).max(80)).max(1000).default([]),
  /** ISO tarih ya da null: süresiz. */
  expiresAt: z.iso.datetime().nullable(),
});
export type PublicationSettings = z.infer<typeof publicationSettingsSchema>;
export type PublicationSettingsInput = z.input<typeof publicationSettingsSchema>;

export const publicationRecordSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(publicationIdPattern),
  projectId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Kopyanın alındığı proje sürümünün `updatedAt` değeri. */
  publishedFrom: z.string(),
  /**
   * Kopyanın alındığı içeriğin parmak izi. "Proje değişti mi" sorusu buna
   * bakıyor, `updatedAt`'e değil: bir projeyi yalnızca açmak zaman damgasını
   * yeniliyor ve her yayın hemen "eskimiş" görünüyordu.
   */
  contentFingerprint: z.string().optional(),
  status: publicationStatusSchema,
  settings: publicationSettingsSchema,
  project: z.unknown(),
  /** Seçilen notların yayın anındaki kopyası; projeye değil kayda ait. */
  notes: z.array(z.lazy(() => publishedNoteSchema)).max(1000).optional(),
});
export type PublicationRecord = z.infer<typeof publicationRecordSchema>;

export type PublicationState = "live" | "unpublished" | "expired";

export type PublicationSummary = Omit<PublicationRecord, "project" | "notes"> & {
  state: PublicationState;
  path: string;
  /** Yayındaki not sayısı. */
  noteCount: number;
};

export const publishedNoteSchema = z.object({
  place: z.string().max(40),
  heading: z.string().max(600),
  quote: z.string().max(1200).optional(),
  text: z.string().max(4000),
  page: z.number().int().positive().optional(),
});
export type PublishedNote = z.infer<typeof publishedNoteSchema>;

/**
 * Yayına girecek notlar: okuyucunun seçtikleri, makaledeki sırasıyla ve
 * yerleriyle. Yalnızca "önemli" işareti olan ya da artık projede olmayan
 * bir yere bağlı notlar girmiyor.
 */
export function publishedNotes(project: ResearchProject, notes: readonly ReaderNote[], noteIds: readonly string[]): PublishedNote[] {
  const chosen = new Set(noteIds);
  return groupNotes(project, notes)
    .filter((group) => group.heading !== ORPHAN_HEADING)
    .flatMap((group) =>
      group.notes
        .filter((note) => chosen.has(note.id) && (note.text || note.quote))
        .map((note) => ({ place: group.place, heading: group.heading, ...(note.quote ? { quote: note.quote } : {}), text: note.text, ...(group.page ? { page: group.page } : {}) })),
    );
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Not bölümünün okuyucuya görünen metni. Varsayılan İngilizce; Türkçesi
 * `src/i18n/messages`'ta. `place` kayıtta İngilizce duruyor ("Story",
 * "Deep report", "Primer", "Claim"); ekranda bu sözlükle çevriliyor.
 */
export type PublishedNotesWords = {
  heading: string;
  intro: string;
  places: Record<NoteGroup["place"], string>;
  page: (page: number) => string;
};

export const PUBLISHED_NOTES_WORDS: PublishedNotesWords = {
  heading: "Notes from the author",
  intro: "The person who shared this story added their own notes. They are not part of the analysis and carry no evidence of their own.",
  places: { Story: "Story", "Deep report": "Deep report", Primer: "Primer", Claim: "Claim" },
  page: (page) => `p. ${page}`,
};

/** Kayıttaki yer adının ekrandaki hâli; bilinmeyen yer olduğu gibi. */
export function publishedNotePlace(place: string, words: PublishedNotesWords = PUBLISHED_NOTES_WORDS) {
  return Object.hasOwn(words.places, place) ? words.places[place as NoteGroup["place"]] : place;
}

/** Yayın sayfasının sonuna eklenen not bölümü: betiksiz, kaçışlı, kendi stiliyle. */
export function publishedNotesHtml(notes: readonly PublishedNote[], words: PublishedNotesWords = PUBLISHED_NOTES_WORDS) {
  if (!notes.length) return "";
  const items = notes
    .map((note) => `<li><span>${escapeHtml(publishedNotePlace(note.place, words))} · ${escapeHtml(note.heading)}${note.page ? ` · ${escapeHtml(words.page(note.page))}` : ""}</span>${note.quote ? `<blockquote>${escapeHtml(note.quote)}</blockquote>` : ""}${note.text ? `<p>${escapeHtml(note.text).replace(/\n/g, "<br>")}</p>` : ""}</li>`)
    .join("");
  return `<section class="trace-shared-notes" aria-label="${escapeHtml(words.heading)}"><style>.trace-shared-notes{max-width:44rem;margin:48px auto 64px;padding:0 20px;font:16px/1.6 Georgia,serif;color:inherit}.trace-shared-notes h2{font-weight:500;margin:0 0 6px}.trace-shared-notes>p{margin:0 0 18px;opacity:.75;font:14px/1.5 system-ui,sans-serif}.trace-shared-notes ol{list-style:none;margin:0;padding:0;display:grid;gap:14px}.trace-shared-notes li{padding:14px 16px;border:1px solid rgba(127,127,127,.35);border-radius:12px}.trace-shared-notes li span{display:block;opacity:.7;font:12px/1.4 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}.trace-shared-notes blockquote{margin:8px 0 0;padding-left:12px;border-left:3px solid #e5b832;font-style:italic}.trace-shared-notes li p{margin:8px 0 0}</style><h2>${escapeHtml(words.heading)}</h2><p>${escapeHtml(words.intro)}</p><ol>${items}</ol></section>`;
}

/** Notları sayfanın gövdesinin sonuna ekliyor. */
export function withPublishedNotes(html: string, notes: readonly PublishedNote[] | undefined, words: PublishedNotesWords = PUBLISHED_NOTES_WORDS) {
  const section = publishedNotesHtml(notes ?? [], words);
  if (!section) return html;
  const at = html.lastIndexOf("</body>");
  return at === -1 ? `${html}${section}` : `${html.slice(0, at)}${section}${html.slice(at)}`;
}

export const EXPIRY_CHOICES = [null, 7, 30, 90] as const;

export function expiryFromDays(days: number | null, now: string) {
  if (days === null) return null;
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

export function publicationState(record: { status: PublicationRecord["status"]; settings: PublicationSettingsInput }, now: string): PublicationState {
  if (record.status === "unpublished") return "unpublished";
  if (record.settings.expiresAt && Date.parse(record.settings.expiresAt) <= Date.parse(now)) return "expired";
  return "live";
}

export function projectContentFingerprint(project: ResearchProject) {
  return `pc1-${stableHash(canonicalJson({ ...project, updatedAt: undefined }))}`;
}

export function publicationPath(id: string) {
  return `/p/${id}`;
}

/**
 * Yayına çıkacak proje. Seçilmeyen bloklar KOPYADAN çıkarılıyor, yalnızca
 * gizlenmiyor: sayfa kaynağını açan biri de onları göremez.
 *
 * `generation` her zaman çıkarılıyor: hangi sağlayıcının ve modelin
 * kullanıldığı yazarın iş akışına dair bir ayrıntı, okuyucunun değil.
 * Sonuç şemadan yeniden geçiyor; çıkarma işlemi bir zorunlu alanı kırarsa
 * yayın yazılmadan önce fark edilsin.
 */
export function projectForPublication(project: ResearchProject, include: PublicationIncludeInput): ResearchProject {
  const copy: ResearchProject = structuredClone(project);
  delete copy.generation;
  if (!include.deepReport) delete copy.deepReport;
  if (!include.technicalAppendix) delete copy.technicalAppendix;
  if (!include.learning) {
    delete copy.primer;
    delete copy.derivations;
    delete copy.quiz;
    delete copy.misreadings;
    delete copy.interactives;
    delete copy.applicationGuide;
  }
  if (!include.figures) delete copy.figures;
  // Türetmeler teknik ekteki denklemlere bağlanabiliyor; ek çıkarıldıysa
  // bağlantı sayfada kırık bir referans olurdu.
  if (!copy.technicalAppendix && copy.derivations) {
    copy.derivations = copy.derivations.map((derivation) => {
      const { equationId: _equationId, ...rest } = derivation;
      void _equationId;
      return rest;
    });
  }
  return researchProjectSchema.parse(copy);
}

export function summarizePublication(record: PublicationRecord, now: string): PublicationSummary {
  const { project: _project, notes, ...rest } = record;
  void _project;
  return { ...rest, state: publicationState(record, now), path: publicationPath(record.id), noteCount: notes?.length ?? 0 };
}

/** Yayın sayfası için yanıt başlıkları; görüntüleyicinin kendi CSP'siyle aynı ve çerçevelenmeyi de kapatıyor. */
export const PUBLICATION_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // Liste dışı: arama motorları dizine almasın.
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  // Yayından kaldırma anında etkili olsun; ara bellekte kopya kalmasın.
  "Cache-Control": "no-store",
};
