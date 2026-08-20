import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * `@/` alias'ı tsconfig'de tanımlı ve hem Next hem rolldown tarafından
 * çözülüyor; vitest'in de aynı haritayı bilmesi gerekiyor.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
