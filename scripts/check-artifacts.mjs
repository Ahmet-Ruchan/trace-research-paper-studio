/**
 * Üretilmiş artefaktların kaynakla senkron olduğunu doğrular.
 *
 * `plugins/.../assets/viewer.html` ve `src/generated/viewer-template.ts`
 * derleme çıktısıdır ama repoya commit'lenir (plugin çalışma anında
 * bağımlılıksız olmalı). Biri `src/visuals/**` veya `viewer/**` içinde
 * değişiklik yapıp yeniden derlemeyi unutursa, teslim edilen site sessizce
 * eski kodu çalıştırır. Bu betik bunu CI'da yakalar.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const ARTIFACTS = [
  "plugins/trace-paper-studio/skills/trace-paper-studio/assets/viewer.html",
  "src/generated/viewer-template.ts",
  "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/generated/validator.mjs",
];

const BUILDERS = ["scripts/build-viewer.mjs", "scripts/build-plugin-validator.mjs"];

function hash(path) {
  return createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
}

const before = ARTIFACTS.map((path) => ({ path, hash: hash(path) }));

for (const builder of BUILDERS) {
  execFileSync("node", [join(root, builder)], { stdio: "pipe" });
}

const drifted = before.filter((entry) => entry.hash !== hash(entry.path));

if (drifted.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message:
          "Üretilmiş artefaktlar kaynakla uyumsuz. `npm run build:viewer` çalıştırıp sonucu commit'leyin.",
        drifted: drifted.map((entry) => entry.path),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checked: ARTIFACTS }, null, 2));
