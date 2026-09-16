/**
 * Kelime düzeyinde metin farkı.
 *
 * Geçmiş paneli "bölüm metni değişti" demekle kalmasın, NEYİN değiştiğini
 * göstersin diye. Birim kelime: karakter farkı bir paragrafı okunmaz bir
 * harf çorbasına çevirir, satır farkı ise tek paragraflık bir gövdede her
 * değişikliği "hepsi değişti" diye gösterir.
 *
 * Boşluklar ayrı parça olarak tutuluyor; böylece parçalar art arda
 * yazıldığında iki metin de birebir geri çıkıyor (test bunu denetliyor).
 *
 * Algoritma en uzun ortak alt dizi. Bir bölüm birkaç yüz kelime, yani
 * tablo küçük; yine de beklenmedik uzunlukta bir metinde tarayıcıyı
 * kilitlemesin diye bir hücre sınırı var. Sınır aşılırsa ortak baş ve son
 * korunup ortası "silindi / eklendi" olarak veriliyor: daha kaba, ama doğru.
 */

export type DiffSegment = { type: "same" | "removed" | "added"; text: string };

/** Ortak baş ve son ayıklandıktan sonra kalan tablo için üst sınır. */
export const MAX_DIFF_CELLS = 400_000;

export function tokenize(text: string) {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

function push(segments: DiffSegment[], type: DiffSegment["type"], text: string) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last?.type === type) last.text += text;
  else segments.push({ type, text });
}

export function diffWords(before: string, after: string): DiffSegment[] {
  const left = tokenize(before);
  const right = tokenize(after);

  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft -= 1;
    endRight -= 1;
  }

  const segments: DiffSegment[] = [];
  push(segments, "same", left.slice(0, start).join(""));

  const a = left.slice(start, endLeft);
  const b = right.slice(start, endRight);
  if (a.length * b.length > MAX_DIFF_CELLS) {
    push(segments, "removed", a.join(""));
    push(segments, "added", b.join(""));
  } else {
    // lengths[i][j]: a[i..] ile b[j..] arasındaki en uzun ortak alt dizi.
    const width = b.length + 1;
    const lengths = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lengths[i * width + j] = a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        push(segments, "same", a[i]);
        i += 1;
        j += 1;
      } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
        push(segments, "removed", a[i]);
        i += 1;
      } else {
        push(segments, "added", b[j]);
        j += 1;
      }
    }
    push(segments, "removed", a.slice(i).join(""));
    push(segments, "added", b.slice(j).join(""));
  }

  push(segments, "same", left.slice(endLeft).join(""));
  return absorbWhitespace(segments);
}

/** İki değişiklik arasında kalıp değişikliğe katılan ortak parçanın en fazla kelime sayısı. */
export const MAX_ABSORBED_WORDS = 2;

/**
 * Değişiklikleri okunur öbeklere toplar.
 *
 * "the old cat" → "the new dog" farkında LCS aradaki tek boşluğu ortak sayar
 * ve sonuç "−old +new ␣ −cat +dog" diye parçalanır. Okuyan için
 * "−old cat +new dog" daha açık. Aynı şey kısa ortak kelimeler için de
 * geçerli: yeniden yazılmış bir paragrafta "that", "be" gibi kelimeler
 * tesadüfen eşleşir ve fark her iki kelimede bir kesilir (gerçek bir
 * tarayıcı testinde tam olarak böyle göründü). İki değişikliğin arasında
 * kalan ve en fazla iki kelimelik ortak parça öbeğe katılıyor.
 *
 * Katılan parça iki metinde de var, bu yüzden hem silinen hem eklenen tarafa
 * yazılıyor; iki metin birebir geri çıkmaya devam ediyor. Her öbekte silinen,
 * eklenenden önce geliyor.
 */
function absorbWhitespace(segments: DiffSegment[]): DiffSegment[] {
  const result: DiffSegment[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    if (removed) result.push({ type: "removed", text: removed });
    if (added) result.push({ type: "added", text: added });
    removed = "";
    added = "";
  };
  segments.forEach((segment, index) => {
    if (segment.type === "removed") removed += segment.text;
    else if (segment.type === "added") added += segment.text;
    else {
      const inRun = Boolean(removed || added);
      const next = segments[index + 1];
      const words = segment.text.split(/\s+/).filter(Boolean).length;
      if (inRun && next && next.type !== "same" && words <= MAX_ABSORBED_WORDS) {
        removed += segment.text;
        added += segment.text;
        return;
      }
      flush();
      const last = result[result.length - 1];
      if (last?.type === "same") last.text += segment.text;
      else result.push({ ...segment });
    }
  });
  flush();
  return result;
}

/** Değişikliğin çevresinde gösterilen ortak kelime sayısı. */
export const CONTEXT_WORDS = 12;

/**
 * Gösterim için: uzun ortak parçaları değişikliklerin çevresindeki birkaç
 * kelimeye indirir. Beş paragraflık bir bölümde tek cümle değiştiyse okuyucu
 * bütün metni değil, o cümleyi ve çevresini görmeli. Kısaltılan yer
 * `elided: true` ile işaretleniyor; sonuç yalnızca çizmek için, metni geri
 * kurmak için değil.
 */
export function withContext(segments: readonly DiffSegment[], context = CONTEXT_WORDS) {
  const words = (text: string) => text.match(/\s*\S+\s*/g) ?? [];
  return segments.flatMap((segment, index) => {
    if (segment.type !== "same") return [{ ...segment, elided: false }];
    const parts = words(segment.text);
    const first = index === 0;
    const last = index === segments.length - 1;
    if (first && last) return [{ ...segment, elided: false }];
    const keepBefore = first ? 0 : context;
    const keepAfter = last ? 0 : context;
    if (parts.length <= keepBefore + keepAfter + 4) return [{ ...segment, elided: false }];
    return [
      ...(keepBefore ? [{ type: "same" as const, text: parts.slice(0, keepBefore).join(""), elided: false }] : []),
      { type: "same" as const, text: "…", elided: true },
      ...(keepAfter ? [{ type: "same" as const, text: parts.slice(-keepAfter).join(""), elided: false }] : []),
    ];
  });
}

/** Parçalardan metnin bir tarafını geri kurar. */
export function reconstruct(segments: readonly DiffSegment[], side: "before" | "after") {
  const skip = side === "before" ? "added" : "removed";
  return segments.filter((segment) => segment.type !== skip).map((segment) => segment.text).join("");
}
