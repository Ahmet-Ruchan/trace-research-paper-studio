/**
 * Plugin doğrulayıcısını derler.
 *
 * Gerçek Zod şemasını ve bütünlük fonksiyonlarını tek bir ESM dosyasına
 * paketler; plugin bunu import eder. Böylece plugin elle aynalanmış bir kopya
 * değil, uygulamanın TAM OLARAK aynı kurallarını çalıştırır — daha önce
 * sapmaya ve bozuk teslimlere yol açan sınıf hatası yapısal olarak kapanır.
 *
 * Plugin çalışma anında bağımlılıksız kalır: artefakt repoya commit'lenir.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = join(
  root,
  "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/generated/validator.mjs",
);

const build = await rolldown({
  input: join(root, "src/lib/plugin-validator-entry.ts"),
  platform: "node",
  resolve: {
    alias: { "@": join(root, "src") },
    extensions: [".ts", ".js", ".mjs", ".json"],
  },
  transform: { define: { "process.env.NODE_ENV": '"production"' } },
  treeshake: true,
});

const { output } = await build.generate({ format: "esm", minify: false });
await build.close();

const chunk = output.find((item) => item.type === "chunk");
if (!chunk) throw new Error("rolldown çıktısında chunk yok");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `// ÜRETİLMİŞ DOSYA — elle düzenlemeyin.\n` +
    `// Kaynak: src/lib/plugin-validator-entry.ts (+ schema.ts, generation-validation.ts, formula.ts)\n` +
    `// Yeniden üret: npm run build:validator\n\n` +
    chunk.code,
  "utf8",
);

// Duman testi: paket gerçekten yüklenebiliyor ve çalışıyor mu?
const validator = await import(`${OUT}?t=${Date.now()}`);
if (typeof validator.validateProjectObject !== "function") {
  throw new Error("Paketten validateProjectObject dışa aktarılmadı");
}
const rejects = validator.validateProjectObject({ version: 2 });
if (rejects.ok !== false) throw new Error("Doğrulayıcı geçersiz girdiyi kabul etti");

console.log(
  JSON.stringify(
    { ok: true, out: OUT, kb: Math.round(readFileSync(OUT).length / 1024) },
    null,
    2,
  ),
);
