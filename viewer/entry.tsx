import { render } from "preact";
import { researchProjectSchema } from "@/lib/schema";
import { ViewerShell, type StudioHandoff } from "./shell";

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
const STUDIO_ELEMENT_ID = "trace-studio";

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

/**
 * Stüdyo devir teslim bilgisi teslim anında gömülür ve OPSİYONELDİR:
 * paylaşılan bir hikâye çıktısında boş gelir, o zaman düğme hiç çizilmez.
 * Okunamazsa sessizce boş kabul edilir — bu bilgi yüzünden sayfa açılmamazlık
 * etmemeli.
 */
function readStudio(): StudioHandoff {
  const raw = document.getElementById(STUDIO_ELEMENT_ID)?.textContent?.trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const { url, command, directory } = parsed as StudioHandoff;
    return {
      url: typeof url === "string" ? url : undefined,
      command: typeof command === "string" ? command : undefined,
      directory: typeof directory === "string" ? directory : undefined,
    };
  } catch {
    return {};
  }
}

function mount() {
  const root = document.getElementById("trace-root");
  if (!root) return;
  try {
    const project = readProject();
    const mode = document.getElementById(MODE_ELEMENT_ID)?.textContent?.trim();
    const initialTab = mode === "story" ? "story" : "lab";
    render(<ViewerShell project={project} initialTab={initialTab} studio={readStudio()} />, root);
  } catch (error) {
    root.textContent = "";
    const message = document.createElement("p");
    message.className = "viewer-fatal";
    message.textContent = error instanceof Error ? error.message : "Could not load the project.";
    root.appendChild(message);
  }
}

mount();
