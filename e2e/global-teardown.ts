import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { E2E_DATA_MARKER } from "./fresh-library";

/** Koşunun açtığı geçici veri dizini koşuyla gidiyor; verilen bir dizine dokunulmuyor. */
export default function globalTeardown() {
  const directory = process.env.TRACE_E2E_DATA_DIR;
  if (process.env.TRACE_E2E_OWNS_DATA_DIR !== "1" || !directory || !existsSync(join(directory, E2E_DATA_MARKER))) return;
  rmSync(directory, { recursive: true, force: true });
}
