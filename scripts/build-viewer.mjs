/**
 * Bağımsız Trace viewer'ını derler.
 *
 * NEDEN: Görsel gramerleri ve interaktifler eskiden ÜÇ yerde ayrı ayrı
 * yazılıyordu (React bileşeni, export-story string şablonu, viewer.html
 * vanilla JS). Yeni bir tür eklemek üç implementasyon demekti ve sapma
 * kaçınılmazdı. Artık tek kaynak `src/visuals/**`; bu betik onu preact ile
 * paketleyip tek dosyalık bir HTML'e gömer.
 *
 * Plugin çalışma anında bağımlılıksız KALIR: ürettiğimiz artefakt repoya
 * commit'lenir, `deliver` yalnızca yer tutucuların üzerine yazar.
 *
 * Çıktılar:
 *   plugins/.../assets/viewer.html      (plugin teslimi okur)
 *   src/generated/viewer-template.ts    (export-story.ts okur)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const VIEWER_HTML = join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/assets/viewer.html");
const TEMPLATE_TS = join(root, "src/generated/viewer-template.ts");
const MAX_BYTES = 600 * 1024;

const PLACEHOLDERS = ["__TRACE_PROJECT_JSON__", "__TRACE_VIEW_MODE__", "__TRACE_STUDIO_JSON__"];

async function bundle() {
  const build = await rolldown({
    input: join(root, "viewer/entry.tsx"),
    platform: "browser",
    resolve: {
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
        "react-dom/client": "preact/compat/client",
        "react/jsx-runtime": "preact/jsx-runtime",
        "react/jsx-dev-runtime": "preact/jsx-runtime",
        "@": join(root, "src"),
      },
      extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
    },
    // JSX ayarı verilmez: rolldown otomatik runtime'ı `react/jsx-runtime`
    // üzerinden çözer ve yukarıdaki alias onu preact'e yönlendirir.
    transform: { define: { "process.env.NODE_ENV": '"production"' } },
    treeshake: true,
  });

  const { output } = await build.generate({ format: "iife", minify: true, name: "TraceViewer" });
  await build.close();

  const chunk = output.find((item) => item.type === "chunk");
  if (!chunk) throw new Error("rolldown çıktısında chunk yok");
  return chunk.code;
}

function collectStyles() {
  const files = [
    "src/visuals/tokens.css",
    "src/visuals/styles.css",
    "src/visuals/learning.css",
    "viewer/shell.css",
  ];
  return files
    .map((file) => `/* ${file} */\n${readFileSync(join(root, file), "utf8")}`)
    .join("\n");
}

/**
 * `</script>` dizisi bir script bloğunu erkenden kapatabilir; JS'i HTML'e
 * gömerken bu kaçış zorunludur.
 */
function escapeForScript(code) {
  return code.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--");
}

function assertSafe(script) {
  const banned = [/\beval\s*\(/, /new\s+Function\s*\(/, /setTimeout\s*\(\s*["'`]/];
  for (const pattern of banned) {
    if (pattern.test(script)) {
      throw new Error(`Paket yasaklı bir kod çalıştırma yolu içeriyor: ${pattern}`);
    }
  }
}

async function main() {
  const script = await bundle();
  assertSafe(script);

  const shell = readFileSync(join(root, "viewer/index.html"), "utf8");
  const html = shell
    .replace("__TRACE_STYLES__", () => collectStyles())
    .replace("__TRACE_SCRIPT__", () => escapeForScript(script));

  for (const placeholder of PLACEHOLDERS) {
    const count = html.split(placeholder).length - 1;
    if (count !== 1) {
      throw new Error(`${placeholder} tam olarak bir kez bulunmalı (bulunan ${count})`);
    }
  }

  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_BYTES) {
    throw new Error(`viewer.html çok büyük: ${(bytes / 1024).toFixed(0)} KB > ${MAX_BYTES / 1024} KB`);
  }

  writeFileSync(VIEWER_HTML, html, "utf8");

  mkdirSync(dirname(TEMPLATE_TS), { recursive: true });
  writeFileSync(
    TEMPLATE_TS,
    `// ÜRETİLMİŞ DOSYA — elle düzenlemeyin.\n` +
      `// Kaynak: viewer/ + src/visuals/ · Yeniden üret: npm run build:viewer\n` +
      `export const VIEWER_TEMPLATE = ${JSON.stringify(html)};\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        viewerHtml: VIEWER_HTML,
        template: TEMPLATE_TS,
        scriptKb: Math.round(script.length / 1024),
        totalKb: Math.round(bytes / 1024),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
