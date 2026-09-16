import { z } from "zod";
import { canonicalJson, stableHash } from "./canonical-json";
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
});
export type PublicationInclude = z.infer<typeof publicationIncludeSchema>;

export const defaultPublicationInclude: PublicationInclude = {
  deepReport: true,
  technicalAppendix: true,
  learning: true,
  figures: true,
};

export const publicationStatusSchema = z.enum(["live", "unpublished"]);

export const publicationSettingsSchema = z.object({
  include: publicationIncludeSchema,
  /** ISO tarih ya da null: süresiz. */
  expiresAt: z.iso.datetime().nullable(),
});
export type PublicationSettings = z.infer<typeof publicationSettingsSchema>;

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
});
export type PublicationRecord = z.infer<typeof publicationRecordSchema>;

export type PublicationState = "live" | "unpublished" | "expired";

export type PublicationSummary = Omit<PublicationRecord, "project"> & {
  state: PublicationState;
  path: string;
};

export const EXPIRY_CHOICES = [null, 7, 30, 90] as const;

export function expiryFromDays(days: number | null, now: string) {
  if (days === null) return null;
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

export function publicationState(record: Pick<PublicationRecord, "status" | "settings">, now: string): PublicationState {
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
export function projectForPublication(project: ResearchProject, include: PublicationInclude): ResearchProject {
  const copy: ResearchProject = structuredClone(project);
  delete copy.generation;
  if (!include.deepReport) delete copy.deepReport;
  if (!include.technicalAppendix) delete copy.technicalAppendix;
  if (!include.learning) {
    delete copy.primer;
    delete copy.derivations;
    delete copy.quiz;
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
  const { project: _project, ...rest } = record;
  void _project;
  return { ...rest, state: publicationState(record, now), path: publicationPath(record.id) };
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
