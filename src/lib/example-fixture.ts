import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ResearchProject } from "./schema";

/**
 * Testler için düğüm tarafı yükleyici. YALNIZCA test ve betiklerden çağrılır —
 * `node:fs` içerdiği için istemci paketine giremez.
 *
 * Fikstürün amiral gemisi örnek olması bilinçli: şemaya eklenen her kural, ürün
 * olarak dağıttığımız dosyaya karşı test edilir. Testler yapay bir mini projede
 * geçip gerçek çıktıda patlarsa test bir şey kanıtlamamış olur.
 */
export function loadExampleProject(
  file = "attention-is-all-you-need.trace.json",
): ResearchProject {
  const path = fileURLToPath(new URL(`../../public/examples/${file}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as ResearchProject;
}

export const exampleProject = loadExampleProject();
