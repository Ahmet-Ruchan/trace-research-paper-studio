import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Stüdyonun veri dizini (`~/.trace` ya da `TRACE_DATA_DIR`); proxy de kullanıyor, bağımlılığı yok. */
export function traceDataDirectory() {
  return process.env.TRACE_DATA_DIR ? resolve(process.env.TRACE_DATA_DIR) : join(homedir(), ".trace");
}
