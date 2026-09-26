import { z } from "zod";
import { foldForSearch } from "./search-text";

/**
 * Kütüphane etiketleri.
 *
 * Etiket makalenin değil, kütüphanenin bilgisi. Bu yüzden `.trace.json`
 * içinde değil, kütüphanenin yanında ayrı bir dosyada (`tags.json`) duruyor:
 *
 * - Proje içinde olsaydı etiket eklemek bir düzenleme sayılır, geçmiş panelinde
 *   içeriği değişmemiş bir sürüm bırakır ve projeyi kütüphanede en üste taşırdı.
 * - Eski bir sürümü geri yüklemek o günün etiketlerini de geri getirirdi.
 * - Ajan `deliver` ve `splice` ile kütüphanedeki kopyanın üzerine yazıyor;
 *   stüdyoda verilen etiketler her teslimde silinirdi.
 * - Yayımlanan bir bağlantı ya da paylaşılan bir JSON, kişinin kendi düzenini
 *   ("okunacak", "zayıf") dışarı taşırdı.
 *
 * Bir etiket aynı zamanda bir koleksiyon: aynı etiketi taşıyan makaleler tek
 * tıkla süzülüyor, karşılaştırılıyor ya da literatür haritasına gönderiliyor.
 */

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_PROJECT = 12;

/** Proje kimliği → etiketler. Nesne değil `Map`: kimlik serbest metin ve "__proto__" da olabilir. */
export type LibraryTags = ReadonlyMap<string, readonly string[]>;

/** Boşlukları ve kontrol karakterlerini tek boşluğa indirir, baştaki `#` işaretini atar. */
export function cleanTag(raw: string) {
  return raw.replace(/[\p{Cc}\s]+/gu, " ").trim().replace(/^#+\s*/, "");
}

/**
 * Etiketin kimliği. "NLP" ile "nlp" aynı etiket; arama katlaması kullanılıyor,
 * böylece Türkçe yazılmış "İlk okuma" ile "ilk okuma" da eşleşiyor.
 */
export function tagKey(tag: string) {
  return foldForSearch(cleanTag(tag));
}

function dedupeTags(tags: readonly string[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tagKey(tag);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const tagSchema = z
  .string()
  .transform(cleanTag)
  .pipe(z.string().min(1, "A tag cannot be empty.").max(MAX_TAG_LENGTH, `A tag can be at most ${MAX_TAG_LENGTH} characters.`));

export const tagListSchema = z
  .array(tagSchema)
  .transform(dedupeTags)
  .pipe(z.array(z.string()).max(MAX_TAGS_PER_PROJECT, `A paper can carry at most ${MAX_TAGS_PER_PROJECT} tags.`));

const libraryTagsFileSchema = z.object({
  version: z.literal(1),
  projects: z.array(z.unknown()),
});

const libraryTagsEntrySchema = z.object({
  id: z.string().min(1),
  tags: tagListSchema,
});

/** Dosyanın (ya da API yanıtının) biçimi tanınıyor mu? Tanınmayan dosya ezilmeden önce kenara alınır. */
export function isLibraryTagsFile(raw: unknown) {
  return libraryTagsFileSchema.safeParse(raw).success;
}

/**
 * Hoşgörülü okuma: bozuk bir girdi yalnızca kendisini düşürür. Elle
 * düzenlenmiş tek bir satır, kütüphanenin bütün etiketlerini silmemeli.
 */
export function parseLibraryTags(raw: unknown): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  const file = libraryTagsFileSchema.safeParse(raw);
  if (!file.success) return tags;
  for (const item of file.data.projects) {
    const entry = libraryTagsEntrySchema.safeParse(item);
    if (entry.success && entry.data.tags.length) tags.set(entry.data.id, entry.data.tags);
  }
  return tags;
}

export function libraryTagsToJson(tags: LibraryTags) {
  return {
    version: 1 as const,
    projects: [...tags]
      .filter(([, list]) => list.length)
      .map(([id, list]) => ({ id, tags: [...list] })),
  };
}

export type TagEdit = { ok: true; tags: string[] } | { ok: false; error: string };

/**
 * Bir etiket ekler. Kütüphanede aynı etiket başka bir yazımla zaten varsa o
 * yazım kullanılıyor: "nlp" yazan kullanıcı ikinci bir "NLP" koleksiyonu
 * açmamalı, var olanına katılmalı.
 */
export function addTag(current: readonly string[], raw: string, known: readonly string[] = []): TagEdit {
  const cleaned = cleanTag(raw);
  const key = tagKey(cleaned);
  if (!cleaned || current.some((tag) => tagKey(tag) === key)) return { ok: true, tags: [...current] };
  const tag = known.find((item) => tagKey(item) === key) ?? cleaned;
  const parsed = tagListSchema.safeParse([...current, tag]);
  return parsed.success
    ? { ok: true, tags: parsed.data }
    : { ok: false, error: parsed.error.issues[0]?.message ?? "The tag could not be added." };
}

export function removeTag(current: readonly string[], tag: string) {
  const key = tagKey(tag);
  return current.filter((item) => tagKey(item) !== key);
}

export function hasTag(tags: readonly string[] | undefined, tag: string) {
  const key = tagKey(tag);
  return Boolean(tags?.some((item) => tagKey(item) === key));
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * Kütüphanedeki etiketler ve kaç makalenin taşıdığı; en kalabalık koleksiyon
 * önce. Yalnızca verilen projeler sayılıyor: kütüphaneden silinmiş bir
 * projenin artakalan kaydı boş bir koleksiyon göstermemeli.
 */
export function tagCounts(projectIds: readonly string[], tags: LibraryTags) {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const id of new Set(projectIds)) {
    for (const tag of tags.get(id) ?? []) {
      const entry = counts.get(tagKey(tag));
      if (entry) entry.count += 1;
      else counts.set(tagKey(tag), { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || collator.compare(left.tag, right.tag));
}
