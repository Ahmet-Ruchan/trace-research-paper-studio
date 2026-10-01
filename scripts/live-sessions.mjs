/**
 * Hangi ajan gerçek bir model oturumuyla sınandı?
 *
 * NEDEN: Duman testi `--live` ile gerçek bir oturum açıyor, ama anahtar
 * yoksa "skip" yazıp yeşil bitiyordu. Haftalık çalıştırma depoda anahtar
 * olmadığı için her hafta atlıyordu ve bunu kimse görmüyordu: eklenti hiçbir
 * ajanda gerçek bir modelle denenmemişken her şey "geçti" görünüyordu.
 * Bu modül sonucu açıkça söylüyor: kim gerçekten denendi, kim neden
 * denenmedi; istenirse (`--require-live`) denenmeyen bir ajan başarısızlık.
 *
 * Yalnızca karar ve metin; çalıştırma `plugin-smoke.mjs`'te.
 */

/**
 * Ajan satırındaki `live` değerinin türü.
 *
 * @param {string | undefined} live
 */
export function liveKind(live) {
  if (live === "passed") return "passed";
  if (live === "failed") return "failed";
  if (typeof live === "string" && live.startsWith("not possible")) return "impossible";
  if (typeof live === "string" && live.startsWith("skipped")) return "skipped";
  return "not tried";
}

/** @type {Record<string, string>} */
const KEYS = { Codex: "OPENAI_API_KEY", "Claude Code": "ANTHROPIC_API_KEY" };
/** @type {Record<string, string>} */
const SHORT = { codex: "Codex", claude: "Claude Code", agy: "Antigravity CLI" };

/**
 * `--require-live codex,claude` → ajan adları; bilinmeyen bir ad hata.
 *
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function requiredAgents(value) {
  if (!value) return [];
  return String(value).split(",").map((name) => name.trim().toLowerCase()).filter(Boolean).map((name) => {
    if (!SHORT[name]) throw new Error(`--require-live: unknown agent "${name}" (codex, claude or agy).`);
    return SHORT[name];
  });
}

/**
 * Çalıştırmanın kararı: başlık, her ajan için bir satır, uyarılar ve
 * (`require` listesindekiler gerçek oturumu geçmediyse) hatalar.
 *
 * @param {Array<{ agent: string, live?: string }>} rows
 * @param {{ live: boolean, require?: string[] }} options
 */
export function liveVerdict(rows, { live, require = [] }) {
  const tried = rows.filter((row) => liveKind(row.live) === "passed").map((row) => row.agent);
  const warnings = [];
  const errors = [];
  for (const row of rows) {
    const kind = liveKind(row.live);
    if (live && kind === "skipped") warnings.push(`${row.agent} was not tried with a real model session: no ${KEYS[row.agent] ?? "API key"} was given.`);
    if (live && kind === "not tried") warnings.push(`${row.agent} was not tried with a real model session: the run stopped before it.`);
    if (kind === "failed") errors.push(`${row.agent}: the real model session did not use the skill to run the bridge.`);
  }
  for (const agent of require) {
    const row = rows.find((item) => item.agent === agent);
    const kind = liveKind(row?.live);
    if (kind === "passed" || kind === "failed") continue;
    errors.push(`${agent} had to pass a real model session (--require-live) but ${row ? (kind === "impossible" ? "it cannot be tried live" : kind === "skipped" ? `no ${KEYS[agent] ?? "API key"} was given` : "it was not reached") : "it was not run"}.`);
  }
  const headline = !live
    ? "No real model session was asked for (run with --live)."
    : tried.length
      ? `Tried with a real model session: ${tried.join(", ")}.`
      : "No agent was tried with a real model session in this run.";
  return { headline, tried, warnings, errors };
}

/**
 * Kalıcı kayıt: iş akışı bunu her çalıştırmada eser olarak saklıyor.
 *
 * @param {Array<{ agent: string, version?: string, failed: number, live?: string }>} rows
 * @param {{ plugin: string, live: boolean, at: string }} options
 */
export function liveReport(rows, { plugin, live, at }) {
  return {
    plugin,
    at,
    liveAsked: Boolean(live),
    agents: rows.map((row) => ({ agent: row.agent, version: row.version || null, checksFailed: row.failed, realModelSession: row.live, kind: liveKind(row.live) })),
  };
}
