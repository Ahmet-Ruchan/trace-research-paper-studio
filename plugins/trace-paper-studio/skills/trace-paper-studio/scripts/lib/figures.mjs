/**
 * Makalenin KENDİ şekillerini çıkarır.
 *
 * Neden gömülü görselleri aramıyoruz: `pdfimages` üç makalede üç farklı
 * sonuç veriyor. Attention'da 3 temiz raster çıkıyor, ResNet'te SIFIR (şekiller
 * vektör olarak çizilmiş), ViT'te 304 parça (şekil karolara bölünmüş). Yani
 * gömülü görsel aramak, makalelerin büyük kısmında ya hiçbir şey ya çöp verir.
 *
 * Bunun yerine sayfanın şekil bölgesi RENDER ediliyor. Tek kod yolu; vektör,
 * raster ve karolu şekillerin üçünde de çalışıyor, çünkü sayfanın son hali
 * rasterleştiriliyor.
 *
 * Bölgeyi bulmak için şeklin kendi başlığı çapa olarak kullanılıyor:
 * "Figure 2." metin katmanında bir koordinatla duruyor, şekil de onun
 * üstündeki boşlukta. Başlığın x aralığı aynı zamanda sütunu veriyor — iki
 * sütunlu bir makalede sayfa genişliğinde kırpmak yan sütunun metnini de
 * içeri alır.
 *
 * Hiçbir şey uydurulmuyor: her şekil bir sayfaya ve kendi başlığına bağlı.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Hedef genişlik: okunur, ama data URI olarak taşınabilir kalacak kadar. */
const TARGET_WIDTH_PX = 1100;
const MIN_DPI = 72;
const MAX_DPI = 300;

/** Gömülecek tek bir şeklin üst sınırı; aşarsa daha düşük DPI ile yeniden. */
const MAX_FIGURE_BYTES = 220_000;

/** Bir şeklin bölgesi bundan kısaysa şekil değil, satır arası boşluktur. */
const MIN_REGION_HEIGHT_PT = 60;
const MIN_REGION_WIDTH_PT = 80;

const CAPTION_START = /^(figure|fig\.?|table|scheme)$/i;
const CAPTION_NUMBER = /^\(?\d{1,2}[.:)]?$/;

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} not found. Install poppler-utils to extract figures.`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || "unknown").trim().slice(0, 200)}`);
  }
  return result.stdout;
}

/**
 * `pdftotext -bbox` çıktısını sayfalara ve kelimelere ayırır.
 * XML ayrıştırıcı eklemiyoruz: çıktı sabit biçimli ve plugin bağımlılıksız
 * kalmalı.
 */
function readWordBoxes(pdfPath) {
  const xml = run("pdftotext", ["-bbox", pdfPath, "-"]);
  const pages = [];
  const pagePattern = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  const wordPattern = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;

  for (let page = pagePattern.exec(xml); page; page = pagePattern.exec(xml)) {
    const words = [];
    for (let word = wordPattern.exec(page[3]); word; word = wordPattern.exec(page[3])) {
      words.push({
        xMin: Number(word[1]),
        yMin: Number(word[2]),
        xMax: Number(word[3]),
        yMax: Number(word[4]),
        text: decodeEntities(word[5]),
      });
    }
    pages.push({ width: Number(page[1]), height: Number(page[2]), words });
  }
  return pages;
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

/** Aynı satırdaki kelimeler: dikey örtüşmeye bakılır, eşitliğe değil. */
function sameLine(a, b) {
  const overlap = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
  return overlap > (a.yMax - a.yMin) * 0.5;
}

/**
 * İki kelime yatayda bitişik mi — yani aynı sütunun aynı satırında mı.
 *
 * Bu kontrol olmadan iki sütunlu bir makale bozuluyor: `pdftotext` sol
 * sütundaki "Figure 2." ile SAĞ sütundaki gövde metnini aynı y'de veriyor,
 * `sameLine` ikisini tek satır sanıyor ve başlığın x aralığı iki sütuna
 * birden yayılıyor. ResNet'te gerçek şekillerin bulunamamasının sebebi buydu.
 */
const CONTIGUOUS_GAP_PT = 20;

function isContiguous(left, right) {
  return right.xMin - left.xMax < CONTIGUOUS_GAP_PT && right.xMin >= left.xMin;
}

/** Başlık satırın başında mı? Değilse bu bir metin içi göndermedir. */
function startsLine(words, index) {
  const word = words[index];
  return !words.some(
    (other) => other !== word && sameLine(word, other) && other.xMax <= word.xMin && isContiguous(other, word),
  );
}

/**
 * Başlığı ve kapsadığı sütunu bulur.
 *
 * Sütun genişliği başlığın KENDİ satırlarından türetiliyor. Tek sütunlu bir
 * makalede bu sayfa genişliğine yakın çıkar, iki sütunluda bir sütuna; iki
 * sütunu birden kaplayan şekiller (`figure*`) de kendiliğinden doğru olur.
 */
function collectCaption(words, startIndex) {
  const first = words[startIndex];
  const lines = [];
  let current = [first];
  let ended = false;

  for (let index = startIndex + 1; index < words.length && !ended; index += 1) {
    const word = words[index];
    const anchor = current[0];

    if (sameLine(anchor, word)) {
      // Yatayda kopma = başka sütun. Satır orada biter.
      if (!isContiguous(current.at(-1), word)) { ended = true; break; }
      current.push(word);
      continue;
    }

    lines.push(current);
    const previousBottom = Math.max(...current.map((item) => item.yMax));
    const lineHeight = anchor.yMax - anchor.yMin;
    // Büyük dikey sıçrama ya da yeni bir başlık: bu başlık bitti.
    if (word.yMin - previousBottom > lineHeight * 1.6) break;
    if (CAPTION_START.test(word.text)) break;
    // Devam satırı başlığın sütununda başlamalı.
    const left = Math.min(...lines.flat().map((item) => item.xMin));
    const right = Math.max(...lines.flat().map((item) => item.xMax));
    if (word.xMin < left - 6 || word.xMin > right + 6) break;
    current = [word];
    if (lines.length > 6) break;
  }
  if (current.length && !lines.includes(current)) lines.push(current);

  const flat = lines.flat();
  return {
    text: flat.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim(),
    top: Math.min(...flat.map((word) => word.yMin)),
    columnLeft: Math.min(...flat.map((word) => word.xMin)),
    columnRight: Math.max(...flat.map((word) => word.xMax)),
  };
}

/**
 * Gövde metni satırı: sütunu doldurur VE iki kenara da yaslanır.
 *
 * Yalnızca genişliğe bakmak yetmiyordu — Attention'ın dikkat
 * görselleştirmeleri sütun boyunca uzanan kelime dizileri içeriyor ve genişlik
 * ölçütü onları gövde metni sanıp şekilleri ortadan kesiyordu. İki kenara
 * birden yaslanmak paragrafa özgüdür; şekil etiketleri ortalanmış ya da
 * dağınıktır.
 */
const EDGE_TOLERANCE_PT = 8;
const BODY_WIDTH_RATIO = 0.75;

/** Başlığın en üst pikselinin kırpmaya sızmaması için küçük pay. */
const CAPTION_CLEARANCE_PT = 3;

/**
 * Şeklin durduğu SÜTUNUN gerçek genişliği.
 *
 * Kırpma kutusunu başlığın x aralığından almak yetmiyor: "Figure 1: The
 * Transformer - model architecture." tek satır ve ortalanmış, şekil ise ondan
 * çok daha geniş. Sonuç, Transformer diyagramının iki yanındaki "Positional
 * Encoding" etiketlerinin kesilmesiydi — kırpılmış bir şekil, hiç şekil
 * olmamasından kötü, çünkü eksik olduğu belli olmuyor.
 *
 * Sütun, sayfadaki metin satırlarının sol kenarları kümelenerek bulunuyor:
 * bir sütunda yazılan her paragraf aynı x'te başlar, o yüzden en kalabalık
 * sol kenarlar sütun başlangıçlarını verir.
 */
function columnBounds(page, caption) {
  const rows = [];
  for (const word of [...page.words].sort((a, b) => a.yMin - b.yMin)) {
    const last = rows.at(-1);
    if (last && sameLine({ yMin: last.top, yMax: last.bottom }, word)) {
      last.bottom = Math.max(last.bottom, word.yMax);
      last.left = Math.min(last.left, word.xMin);
      last.right = Math.max(last.right, word.xMax);
      continue;
    }
    rows.push({ top: word.yMin, bottom: word.yMax, left: word.xMin, right: word.xMax });
  }

  // Kısa satırlar (etiketler, sayfa numarası) sütunu tarif etmez.
  const wide = rows.filter((row) => row.right - row.left > page.width * 0.2);
  const clusters = [];
  for (const row of wide) {
    const cluster = clusters.find((item) => Math.abs(item.left - row.left) < 12);
    if (cluster) {
      cluster.right = Math.max(cluster.right, row.right);
      cluster.count += 1;
      continue;
    }
    clusters.push({ left: row.left, right: row.right, count: 1 });
  }

  const centre = (caption.columnLeft + caption.columnRight) / 2;
  const containing = clusters
    .filter((item) => item.count >= 2 && item.left - 6 <= centre && item.right + 6 >= centre)
    // Şekil iki sütunu birden kaplıyorsa (`figure*`) en dar değil, başlığı
    // kapsayan EN GENİŞ sütun doğru olan.
    .sort((a, b) => b.right - b.left - (a.right - a.left));

  const column = containing[0];
  if (!column) return { left: caption.columnLeft, right: caption.columnRight };
  return {
    left: Math.min(column.left, caption.columnLeft),
    right: Math.max(column.right, caption.columnRight),
  };
}

function rowsAbove(page, caption) {
  const inColumn = page.words.filter(
    (word) =>
      word.yMax < caption.top - 1 &&
      word.xMax > caption.columnLeft - 4 &&
      word.xMin < caption.columnRight + 4,
  );

  const rows = [];
  for (const word of inColumn.sort((a, b) => a.yMin - b.yMin)) {
    const last = rows.at(-1);
    if (last && sameLine({ yMin: last.top, yMax: last.bottom }, word)) {
      last.bottom = Math.max(last.bottom, word.yMax);
      last.left = Math.min(last.left, word.xMin);
      last.right = Math.max(last.right, word.xMax);
      continue;
    }
    rows.push({ top: word.yMin, bottom: word.yMax, left: word.xMin, right: word.xMax });
  }
  return rows;
}

/**
 * Şekil, başlığın üstünde gövde metninin bittiği yerde başlar.
 *
 * İlk denemem "en büyük dikey boşluğu bul" idi ve VEKTÖR şekillerde çöktü:
 * ResNet'in residual bloğunun içinde "weight layer", "relu" gibi etiketler
 * var, bunlar metin katmanında görünüyor, dolayısıyla şeklin ortasında boşluk
 * yok — şeklin kendisi "boş alan" değil.
 *
 * Bunun yerine başlıktan yukarı doğru yürünüp sütunu dolduran İKİ ARDIŞIK
 * gövde satırına rastlanana kadar her şey şekle dahil ediliyor. "İki ardışık"
 * şart, çünkü geniş bir şeklin içindeki tek bir uzun etiket satırı şekli
 * erkenden kesmemeli.
 */
function regionAboveCaption(page, caption) {
  const topMargin = page.height * 0.05;
  const bottom = caption.top - CAPTION_CLEARANCE_PT;
  const rows = rowsAbove(page, caption);
  if (!rows.length) return { top: topMargin, bottom };

  const columnWidth = caption.columnRight - caption.columnLeft;
  const isBody = (row) =>
    row.right - row.left > columnWidth * BODY_WIDTH_RATIO &&
    row.left <= caption.columnLeft + EDGE_TOLERANCE_PT &&
    row.right >= caption.columnRight - EDGE_TOLERANCE_PT;

  let top = topMargin;
  for (let index = rows.length - 1; index >= 1; index -= 1) {
    if (isBody(rows[index]) && isBody(rows[index - 1])) {
      top = rows[index].bottom;
      break;
    }
  }
  return { top, bottom };
}

/**
 * Kırpılmış bölgeyi PNG'ye render eder. DPI, çıkan görsel hedef genişliğe
 * yakın olacak şekilde hesaplanıyor — böylece dar bir sütun şekli de geniş bir
 * tam sayfa şekli de benzer okunurlukta ve benzer boyutta çıkıyor.
 */
function renderRegion(pdfPath, page, box, outDir, name, quality = 1) {
  const widthPt = box.right - box.left;
  const heightPt = box.bottom - box.top;
  const dpi = Math.min(
    MAX_DPI,
    Math.max(MIN_DPI, Math.round(((TARGET_WIDTH_PX * 72) / widthPt) * quality)),
  );
  const scale = dpi / 72;
  const target = join(outDir, name);

  run("pdftocairo", [
    "-png",
    "-r", String(dpi),
    "-f", String(page),
    "-l", String(page),
    "-x", String(Math.max(0, Math.floor(box.left * scale))),
    "-y", String(Math.max(0, Math.floor(box.top * scale))),
    "-W", String(Math.ceil(widthPt * scale)),
    "-H", String(Math.ceil(heightPt * scale)),
    "-singlefile",
    pdfPath,
    target,
  ]);

  const file = `${target}.png`;
  if (!existsSync(file)) throw new Error(`pdftocairo produced no file for page ${page}.`);
  return { file, dpi, widthPx: Math.ceil(widthPt * scale), heightPx: Math.ceil(heightPt * scale) };
}

/**
 * Tek renk bir PNG şekil değildir: kırpma boş bir alana denk gelmiş demektir.
 * Dosya boyutu bunun ucuz bir göstergesi — boş bir bölge çok küçük sıkışır.
 */
function looksEmpty(file, widthPx, heightPx) {
  const bytes = statSync(file).size;
  return bytes < 2_500 || bytes / (widthPx * heightPx) < 0.0008;
}

/**
 * @returns {{figures: Array, note?: string}} Şekiller job dizinine yazılır;
 *   hangisinin anlamlı olduğuna ajan karar verir.
 */
export function extractFigures(pdfPath, outDirectory, { limit = 8 } = {}) {
  mkdirSync(outDirectory, { recursive: true });

  let pages;
  try {
    pages = readWordBoxes(pdfPath);
  } catch (error) {
    return { figures: [], note: error instanceof Error ? error.message : String(error) };
  }

  const figures = [];
  const seen = new Set();
  for (const [index, page] of pages.entries()) {
    const pageNumber = index + 1;
    for (let position = 0; position < page.words.length; position += 1) {
      if (figures.length >= limit) break;
      const word = page.words[position];
      if (!CAPTION_START.test(word.text)) continue;
      const next = page.words[position + 1];
      if (!next || !sameLine(word, next) || !isContiguous(word, next)) continue;
      if (!CAPTION_NUMBER.test(next.text)) continue;
      // "…see Table 9 for better results" bir başlık değil, göndermedir.
      if (!startsLine(page.words, position)) continue;

      // Noktalama normalize ediliyor: "Table 3:" ile "Table 3" aynı şekildir.
      const key = `${pageNumber}:${word.text.toLowerCase().replace(/[.]$/, "")}:${next.text.replace(/[^0-9]/g, "")}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const found = collectCaption(page.words, position);
      // Şekil başlığından geniş olabilir; kırpma da gövde tespiti de sütunun
      // tamamını görmeli, başlığın kapladığı yeri değil.
      const column = columnBounds(page, found);
      const caption = { ...found, columnLeft: column.left, columnRight: column.right };
      const region = regionAboveCaption(page, caption);
      const box = {
        left: column.left,
        right: column.right,
        top: region.top,
        bottom: region.bottom,
      };
      if (box.bottom - box.top < MIN_REGION_HEIGHT_PT) continue;
      if (box.right - box.left < MIN_REGION_WIDTH_PT) continue;

      const label = `${word.text} ${next.text}`.replace(/[.:)]$/, "");
      const name = `figure-p${pageNumber}-${figures.length + 1}`;
      try {
        /**
         * Bir şekil projeye gömülecek; okunurluğu korurken bütçeye sığması
         * gerekiyor. Aşarsa daha düşük çözünürlükte yeniden render ediliyor —
         * yeniden ölçekleme yerine yeniden render, çünkü plugin bağımlılıksız
         * kalmalı ve `pdftocairo` zaten elimizde.
         */
        let rendered = renderRegion(pdfPath, pageNumber, box, outDirectory, name);
        for (let attempt = 1; statSync(rendered.file).size > MAX_FIGURE_BYTES && attempt <= 3; attempt += 1) {
          rendered = renderRegion(pdfPath, pageNumber, box, outDirectory, name, 0.72 ** attempt);
        }
        if (looksEmpty(rendered.file, rendered.widthPx, rendered.heightPx)) {
          unlinkSync(rendered.file);
          continue;
        }
        figures.push({
          id: name,
          label: label.trim(),
          caption: caption.text,
          page: pageNumber,
          file: rendered.file,
          widthPx: rendered.widthPx,
          heightPx: rendered.heightPx,
          bytes: statSync(rendered.file).size,
        });
      } catch {
        // Tek bir şeklin render edilememesi hazırlığı düşürmemeli.
      }
    }
  }

  return { figures };
}

/** PNG'yi projeye gömülecek data URI'ye çevirir. */
export function toDataUri(file) {
  return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
}
