/**
 * Sürümü tek komutla her yerde günceller ya da sapmayı denetler.
 *
 *   node scripts/set-version.mjs 0.16.0   # yaz
 *   node scripts/set-version.mjs --check  # yalnızca denetle (npm run check bunu çalıştırır)
 *
 * NEDEN: Sürüm beş yerde yaşıyor ve elle güncelleniyordu. Sonuç tam olarak
 * beklenen şeydi: plugin'ler 0.15.0 derken package.json 0.2.0, kilit dosyası
 * 0.1.0 diyordu. Ajanlar plugin'in yenilendiğini manifestteki sürümden
 * anlıyor; unutulan bir alan kullanıcının güncellemeyi hiç almaması demek.
 *
 * Dosyalar JSON olarak yeniden serileştirilmiyor, yalnızca sürüm alanı
 * değiştiriliyor: Codex manifesti `—` gibi kaçışlar taşıyor ve
 * `JSON.stringify` onları sessizce başka bir biçime çevirip gereksiz bir
 * fark üretirdi.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_NAME = "trace-paper-studio";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Her hedef: dosya, sürümü okuyan fonksiyon, sürüm alanlarının kaç kez değişeceği. */
const targets = [
  { path: "package.json", read: (json) => [json.version] },
  { path: "package-lock.json", read: (json) => [json.version, json.packages?.[""]?.version] },
  {
    path: ".claude-plugin/marketplace.json",
    read: (json) => [json.plugins?.find((plugin) => plugin.name === PLUGIN_NAME)?.version],
  },
  { path: `plugins/${PLUGIN_NAME}/.claude-plugin/plugin.json`, read: (json) => [json.version] },
  { path: `plugins/${PLUGIN_NAME}/.codex-plugin/plugin.json`, read: (json) => [json.version] },
];

function versionsOf(target) {
  const text = readFileSync(join(root, target.path), "utf8");
  return { text, versions: target.read(JSON.parse(text)) };
}

/**
 * Yalnızca sürüm alanlarını değiştirir. Kilit dosyasında `"version"` her
 * bağımlılıkta geçiyor; bu yüzden sayı sınırlı: kök ve `packages[""]`, yani
 * dosyadaki İLK iki eşleşme. Değişiklikten sonra sonuç okunup doğrulanıyor.
 */
function writeVersion(target, version) {
  const { text, versions } = versionsOf(target);
  let remaining = versions.length;
  let next = text;
  if (target.path === ".claude-plugin/marketplace.json") {
    const json = JSON.parse(text);
    const index = json.plugins.findIndex((plugin) => plugin.name === PLUGIN_NAME);
    let seen = -1;
    next = text.replace(/"version":\s*"[^"]*"/g, (match) => {
      seen += 1;
      return seen === index ? `"version": "${version}"` : match;
    });
  } else {
    next = text.replace(/"version":\s*"[^"]*"/g, (match) => {
      if (remaining === 0) return match;
      remaining -= 1;
      return `"version": "${version}"`;
    });
  }
  const written = target.read(JSON.parse(next));
  if (written.some((value) => value !== version)) {
    throw new Error(`${target.path}: the version could not be written safely; nothing was changed.`);
  }
  return next;
}

const argument = process.argv[2];

if (argument === "--check") {
  const found = targets.flatMap((target) =>
    versionsOf(target).versions.map((version) => ({ path: target.path, version })),
  );
  const distinct = [...new Set(found.map((item) => item.version))];
  if (distinct.length !== 1 || !SEMVER.test(distinct[0] ?? "")) {
    console.error(JSON.stringify({ ok: false, note: "Versions differ. Run: node scripts/set-version.mjs <version>", found }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, version: distinct[0], files: targets.length }, null, 2));
} else if (argument && SEMVER.test(argument)) {
  // Önce hepsi hesaplanıyor, sonra yazılıyor: biri başarısız olursa yarım bir sürüm kalmasın.
  const outputs = targets.map((target) => ({ target, text: writeVersion(target, argument) }));
  for (const { target, text } of outputs) writeFileSync(join(root, target.path), text, "utf8");
  console.log(JSON.stringify({ ok: true, version: argument, updated: targets.map((target) => target.path) }, null, 2));
} else {
  console.error("Usage: node scripts/set-version.mjs <major.minor.patch> | --check");
  process.exit(1);
}
