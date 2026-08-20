import { render } from "preact";
import { researchProjectSchema } from "@/lib/schema";
import { ViewerShell } from "./shell";

/**
 * Bağımsız viewer giriş noktası.
 *
 * Bu paket `scripts/build-viewer.mjs` tarafından derlenip
 * `plugins/.../assets/viewer.html` içine gömülür. Proje JSON'u ve görünüm modu
 * teslim anında yer tutucuların üzerine yazılır — bu yüzden derleme anında
 * veriye ihtiyaç yoktur.
 */

const DATA_ELEMENT_ID = "trace-data";
const MODE_ELEMENT_ID = "trace-mode";

function readProject() {
  const node = document.getElementById(DATA_ELEMENT_ID);
  if (!node?.textContent) throw new Error("Project data not found.");
  const parsed = researchProjectSchema.safeParse(JSON.parse(node.textContent));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Invalid Trace project schema: ${first.path.join(".") || "root"} · ${first.message}`);
  }
  return parsed.data;
}

function mount() {
  const root = document.getElementById("trace-root");
  if (!root) return;
  try {
    const project = readProject();
    const mode = document.getElementById(MODE_ELEMENT_ID)?.textContent?.trim();
    const initialTab = mode === "story" ? "story" : "lab";
    render(<ViewerShell project={project} initialTab={initialTab} />, root);
  } catch (error) {
    root.textContent = "";
    const message = document.createElement("p");
    message.className = "viewer-fatal";
    message.textContent = error instanceof Error ? error.message : "Could not load the project.";
    root.appendChild(message);
  }
}

mount();
