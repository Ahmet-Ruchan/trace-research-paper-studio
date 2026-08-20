import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Üretilmiş artefaktlar; kaynakları viewer/, src/visuals/ ve src/lib/.
    // Yeniden üret: npm run build:artifacts
    "src/generated/**",
    "plugins/**/scripts/generated/**",
    "plugins/**/assets/viewer.html",
  ]),
  {
    /**
     * KISITLI BÖLGE.
     *
     * `src/visuals/**` ve `viewer/**` iki ayrı hedefte derlenir: Next
     * uygulaması (gerçek React) ve plugin'in bağımsız paketi (preact/compat,
     * rolldown, tarayıcı). Aşağıdaki içe aktarmalar ikinci hedefte kırılır ya
     * da paketi gereksiz büyütür; bu yüzden derleme anında değil, yazarken
     * yakalanmaları gerekir.
     */
    files: ["src/visuals/**/*.{ts,tsx}", "viewer/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react-dom/server", message: "Viewer paketi istemcide çalışır; sunucu render'ı yok." },
            { name: "lucide-react", message: "Paketi büyütür. Satır içi SVG kullanın." },
            { name: "next/navigation", message: "Viewer paketinde Next yok." },
            { name: "next/image", message: "Viewer paketinde Next yok." },
            { name: "next/link", message: "Viewer paketinde Next yok." },
            { name: "@/lib/safe-fetch", message: "Sunucu tarafı modülü." },
            { name: "@/lib/project-library", message: "IndexedDB host'a özgüdür." },
          ],
          patterns: [
            { group: ["next/*"], message: "Viewer paketinde Next yok." },
            { group: ["node:*"], message: "Tarayıcı paketinde Node API'si yok." },
            { group: ["fs", "path", "crypto"], message: "Tarayıcı paketinde Node API'si yok." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
