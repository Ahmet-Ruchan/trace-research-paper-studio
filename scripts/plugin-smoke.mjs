/**
 * Eklentiyi gerçek ajan CLI'larına kurup çalıştırıyor.
 *
 *   node scripts/plugin-smoke.mjs --codex <bin> --claude <bin> --agy <bin>
 *
 * NEDEN: Manifest testleri alanların sınırlarını biliyor ama bir ajanın
 * eklentiyi gerçekten nasıl okuduğunu bilmiyor. Codex 1024 karakterden uzun
 * beceri açıklamasını cümlenin ortasında kesiyordu, altı başlangıç isteminin
 * üçünü de yalnızca bir uyarıyla atıyordu; ikisi de ancak CLI elle kurulunca
 * görüldü. Bu betik her ajanda:
 *
 *   1. eklentiyi geçici bir ev dizinine, kullanıcının kuracağı yoldan kuruyor,
 *   2. ajanın eklentiyi nasıl gördüğünü soruyor (sürüm, beceri, açıklama,
 *      başlangıç istemleri) ve eklentiyi anan her uyarıyı hata sayıyor,
 *   3. köprüyü KURULAN kopyadan, depo dışında bir dizinde çalıştırıyor: kopya
 *      depodaki bir dosyaya dayanıyorsa burada düşüyor.
 *   4. `--live` verilirse ve anahtar varsa gerçek bir model oturumu açıyor
 *      (Codex: OPENAI_API_KEY, Claude Code: ANTHROPIC_API_KEY): modelden
 *      beceriyle bir dışa aktarım istiyor ve dosyanın köprünün ürettiğiyle
 *      birebir aynı olduğuna bakıyor. Beceri modele gerçekten ulaşıyor mu,
 *      model köprüyü bulup çalıştırabiliyor mu, ancak böyle görülüyor.
 *
 * Sınırlar: Antigravity CLI'da gerçek oturum denenmiyor; `agy -p` bir Google
 * girişi istiyor ve anahtarla açılmıyor, girişsiz beklemede kalıyor. Orada
 * doğrulanan, eklentinin kurulup becerisinin işlendiği ve köprünün kurulan
 * kopyadan çalıştığı. Anahtarsız koşuda gerçek oturum "skip" olarak yazılıyor.
 *
 * Verilmeyen CLI atlanıyor; hiçbiri verilmezse betik hata veriyor. Yalnızca
 * Node'un kendi modüllerini kullanıyor, `npm ci` gerektirmiyor.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = "trace-paper-studio";
const MARKETPLACE = "trace-research-tools";
const PLUGIN_DIR = join(root, "plugins", PLUGIN);
const SKILL_DIR = join(PLUGIN_DIR, "skills", PLUGIN);
const EXAMPLE = join(root, "public", "examples", "attention-is-all-you-need.en.trace.json");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Deponun söylediği: her ajanın göstermesi gereken değerler. */
function expected() {
  const marketplace = readJson(join(root, ".claude-plugin", "marketplace.json"));
  const entry = marketplace.plugins.find((plugin) => plugin.name === PLUGIN);
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const description = skill.match(/^---\n[\s\S]*?^description: (.*)$/m)?.[1];
  const codex = readJson(join(PLUGIN_DIR, ".codex-plugin", "plugin.json"));
  const yaml = readFileSync(join(SKILL_DIR, "agents", "openai.yaml"), "utf8");
  return {
    version: entry.version,
    pluginDescription: entry.description,
    skillDescription: description,
    defaultPrompt: codex.interface.defaultPrompt,
    shortDescription: codex.interface.shortDescription,
    skillShortDescription: yaml.match(/short_description: "([^"]*)"/)?.[1],
  };
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index].replace(/^--/, "");
    if (key === "live") {
      args.live = true;
      continue;
    }
    args[key] = values[index + 1];
    index += 1;
  }
  return args;
}

const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");

let failures = 0;
/** Ajan başına özet: sürüm, düşen denetim sayısı, gerçek oturumun sonucu (CI iş özeti). */
const summary = [];
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${String(detail).split("\n").join("\n        ")}` : ""}`);
  }
  return condition;
}

function skip(label, reason) {
  console.log(`  skip  ${label} (${reason})`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 240_000, maxBuffer: 64 * 1024 * 1024, ...options });
  return { status: result.status, stdout: result.stdout ?? "", stderr: stripAnsi(result.stderr ?? ""), error: result.error };
}

const output = (result) => `${result.error ?? ""}${result.stdout}${result.stderr}`.trim().slice(-1500);

/** Eklentiyi anan uyarı ve hata satırları: ajan bir alanı sessizce atıyor ya da kesiyor olabilir. */
const pluginWarnings = (text) =>
  stripAnsi(text)
    .split("\n")
    .filter((line) => /\b(WARN|ERROR|warning|error)\b/.test(line) && line.includes(PLUGIN));

function findFile(directory, name) {
  if (!existsSync(directory)) return undefined;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === name && path.includes(`${PLUGIN}`) && path.includes("scripts")) return path;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      const found = findFile(path, name);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Köprü, kurulan kopyadan ve depo dışındaki bir dizinden: doğrulama, bütün
 * dışa aktarımlar, kavramlar, açıklama ve bölüm özetleri, bağımsız site.
 */
function bridgeSmoke(agent, bridge) {
  const workspace = mkdtempSync(join(tmpdir(), `trace-smoke-${agent}-`));
  const env = { ...process.env, TRACE_DATA_DIR: join(workspace, "data") };
  mkdirSync(join(workspace, "data", "library"), { recursive: true });
  cpSync(EXAMPLE, join(workspace, "paper.trace.json"));
  writeFileSync(join(workspace, "references.txt"), "Layer Normalization\nDeep Residual Learning for Image Recognition\n");
  const project = readJson(EXAMPLE);
  const node = (...args) => run(process.execPath, [bridge, ...args], { cwd: workspace, env });
  const commands = [
    ["validate --strict", ["validate", "--project", "paper.trace.json", "--strict"]],
    ...["md", "html", "slides", "ipynb", "bib", "ris", "anki"].map((format) => [`export ${format}`, ["export", "--project", "paper.trace.json", "--format", format, "--out", join(workspace, `out.${format}`)]]),
    ["templates", ["templates"]],
    ["record", ["record"]],
    ["concepts", ["concepts"]],
    ["concepts --names", ["concepts", "--names"]],
    ["concepts --references", ["concepts", "--project", "paper.trace.json", "--references", "references.txt"]],
    ["progress", ["progress"]],
    ["work", ["work", "--days", "3"]],
    ["notes --obsidian", ["notes", "--project", "paper.trace.json", "--obsidian"]],
    ["reading", ["reading"]],
    ["today", ["today"]],
    ["obsidian", ["obsidian", "--out", "vault"]],
    ["work --ics", ["work", "--ics", "work-sessions.ics"]],
    ["review", ["review"]],
    ["section", ["section", "--project", "paper.trace.json", "--target", `primer:${project.primer.concepts[0].id}`]],
    ["explain", ["explain", "--project", "paper.trace.json", "--target", `story:${project.story.sections[0].id}`, "--text", "The paper replaces recurrence with attention, so every position can look at every other position in one step and training runs in parallel."]],
    ["deliver --no-open --no-app", ["deliver", "--project", "paper.trace.json", "--no-open", "--no-app", "--out", join(workspace, "site")]],
  ];
  try {
    for (const [label, args] of commands) {
      const result = node(...args);
      check(`${agent}: bridge ${label}`, result.status === 0, output(result));
    }
    check(`${agent}: bridge wrote the standalone site`, existsSync(join(workspace, "site", "index.html")));
  } finally {
    node("stop", "--site", join(workspace, "site"));
    rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Gerçek bir model oturumu: model beceriyle makaleyi BibTeX'e aktarıyor.
 * Dosyanın köprünün kendi çıktısıyla birebir aynı olması, modelin dosyayı
 * elle yazmadığını, becerinin talimatıyla köprüyü bulup çalıştırdığını
 * gösteriyor.
 */
const LIVE_PROMPT =
  "Use the trace-paper-studio skill: export the Trace project paper.trace.json in the current directory as BibTeX to refs.bib, " +
  "by running the skill's bridge script as its instructions say. Do not write refs.bib yourself. Reply DONE when the bridge has written it.";

function liveSmoke(agent, bridge, ask) {
  const workspace = mkdtempSync(join(tmpdir(), `trace-live-${agent}-`));
  try {
    cpSync(EXAMPLE, join(workspace, "paper.trace.json"));
    const expected = join(tmpdir(), `trace-live-${agent}-expected.bib`);
    run(process.execPath, [bridge, "export", "--project", join(workspace, "paper.trace.json"), "--format", "bib", "--out", expected]);
    const answer = ask(workspace);
    const written = join(workspace, "refs.bib");
    const same = existsSync(written) && existsSync(expected) && readFileSync(written, "utf8") === readFileSync(expected, "utf8");
    rmSync(expected, { force: true });
    return check(`${agent}: a real model session used the skill and ran the bridge`, same, output(answer));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

/** Codex app-server'a stdio üzerinden `plugin/read` soruyor; stderr uyarılarıyla birlikte döner. */
function codexPluginRead(codex, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(codex, ["app-server"], { env: { ...env, RUST_LOG: "warn" }, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    const pending = new Map();
    let next = 1;
    const timer = setTimeout(() => finish({ error: "timed out" }), 60_000);
    function finish(result) {
      clearTimeout(timer);
      child.kill();
      setTimeout(() => resolvePromise({ ...result, stderr: stripAnsi(stderr) }), 300);
    }
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        }
      }
    });
    child.on("error", (error) => finish({ error: error.message }));
    const call = (method, params) =>
      new Promise((answer) => {
        const id = next++;
        pending.set(id, answer);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    (async () => {
      const init = await call("initialize", { clientInfo: { name: "trace-plugin-smoke", version: "1.0.0" } });
      if (init.error) return finish({ error: JSON.stringify(init.error) });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
      const read = await call("plugin/read", { pluginName: PLUGIN, marketplacePath: join(root, ".agents", "plugins", "marketplace.json") });
      finish(read.error ? { error: JSON.stringify(read.error) } : { plugin: read.result.plugin });
    })();
  });
}

async function smokeCodex(codex, want, live) {
  const version = run(codex, ["--version"]).stdout.trim();
  console.log(`\nCodex (${version})`);
  const before = failures;
  const row = { agent: "Codex", version, live: "not asked" };
  const home = mkdtempSync(join(tmpdir(), "trace-smoke-codex-"));
  const env = { ...process.env, CODEX_HOME: home, RUST_LOG: "warn" };
  try {
    const add = run(codex, ["plugin", "marketplace", "add", root], { env });
    if (!check("codex: marketplace add", add.status === 0, output(add))) return;
    const install = run(codex, ["plugin", "add", `${PLUGIN}@${MARKETPLACE}`], { env });
    if (!check("codex: plugin add", install.status === 0, output(install))) return;
    check("codex: installing says nothing about the plugin", pluginWarnings(add.stderr + install.stderr).length === 0, pluginWarnings(add.stderr + install.stderr).join("\n"));

    const list = run(codex, ["plugin", "list", "--json"], { env });
    const installed = (() => { try { return JSON.parse(list.stdout).installed ?? []; } catch { return []; } })();
    const entry = installed.find((item) => item.name === PLUGIN);
    check(`codex: installed at ${want.version}, enabled`, entry?.version === want.version && entry?.enabled === true, output(list));

    const read = await codexPluginRead(codex, env);
    if (!check("codex: plugin/read answers", Boolean(read.plugin), read.error)) return;
    const warnings = pluginWarnings(read.stderr);
    check("codex: no warning about the manifest or the skill", warnings.length === 0, warnings.join("\n"));
    const ui = read.plugin.summary.interface ?? {};
    check("codex: every starter prompt kept", JSON.stringify(ui.defaultPrompt) === JSON.stringify(want.defaultPrompt), JSON.stringify(ui.defaultPrompt));
    check("codex: short description as written", ui.shortDescription === want.shortDescription, ui.shortDescription);
    check("codex: store description as written", read.plugin.description === want.pluginDescription);
    const skill = read.plugin.skills?.find((item) => item.name === `${PLUGIN}:${PLUGIN}`);
    check("codex: the skill is loaded and enabled", skill?.enabled === true, JSON.stringify(read.plugin.skills?.map((item) => item.name)));
    check("codex: the skill description is whole", skill?.description === want.skillDescription, skill?.description);
    check("codex: the skill's own short description", skill?.interface?.shortDescription === want.skillShortDescription, skill?.interface?.shortDescription);

    // Modelin gerçekten gördüğü: becerinin açıklaması istemde tam olarak var mı.
    const empty = mkdtempSync(join(tmpdir(), "trace-smoke-empty-"));
    const prompt = run(codex, ["debug", "prompt-input", "hello"], { env, cwd: empty });
    rmSync(empty, { recursive: true, force: true });
    const needle = JSON.stringify(`${PLUGIN}:${PLUGIN}: ${want.skillDescription}`).slice(1, -1);
    check("codex: the model's prompt carries the whole skill description", prompt.status === 0 && prompt.stdout.includes(needle), output(prompt));

    const bridge = findFile(join(home, "plugins", "cache"), "trace-agent.mjs");
    if (check("codex: the installed copy has the bridge", Boolean(bridge))) bridgeSmoke("codex", bridge);

    const key = process.env.OPENAI_API_KEY;
    if (!live) skip("codex: real model session", "run with --live");
    else if (!key) {
      skip("codex: real model session", "no OPENAI_API_KEY");
      row.live = "skipped: no key";
    } else if (bridge) {
      const login = run(codex, ["login", "--with-api-key"], { env, input: key });
      if (check("codex: login with the API key", login.status === 0, output(login))) {
        const passed = liveSmoke("codex", bridge, (workspace) =>
          run(codex, ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "workspace-write", "-C", workspace, LIVE_PROMPT], { env, input: "", timeout: 600_000 }),
        );
        row.live = passed ? "passed" : "failed";
      }
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    summary.push({ ...row, failed: failures - before });
  }
}

function smokeClaude(claude, want, live) {
  const version = run(claude, ["--version"]).stdout.trim();
  console.log(`\nClaude Code (${version})`);
  const before = failures;
  const row = { agent: "Claude Code", version, live: "not asked" };
  const home = mkdtempSync(join(tmpdir(), "trace-smoke-claude-"));
  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  try {
    for (const target of [".", `plugins/${PLUGIN}`, `plugins/${PLUGIN}/skills`, ".claude/skills"]) {
      const result = run(claude, ["plugin", "validate", "--strict", target], { env, cwd: root });
      check(`claude: validate --strict ${target}`, result.status === 0 && /Validation passed/.test(result.stdout + result.stderr), output(result));
    }
    const add = run(claude, ["plugin", "marketplace", "add", root], { env });
    if (!check("claude: marketplace add", add.status === 0, output(add))) return;
    const install = run(claude, ["plugin", "install", `${PLUGIN}@${MARKETPLACE}`], { env });
    if (!check("claude: plugin install", install.status === 0, output(install))) return;

    const list = run(claude, ["plugin", "list", "--json"], { env });
    const entry = (() => { try { return JSON.parse(list.stdout).find((item) => item.id === `${PLUGIN}@${MARKETPLACE}`); } catch { return undefined; } })();
    check(`claude: installed at ${want.version}, enabled`, entry?.version === want.version && entry?.enabled === true, output(list));

    const details = run(claude, ["plugin", "details", `${PLUGIN}@${MARKETPLACE}`], { env });
    check("claude: details list the skill", details.status === 0 && new RegExp(`Skills \\(1\\)\\s+${PLUGIN}`).test(details.stdout), output(details));
    check("claude: details show the store description", details.stdout.includes(want.pluginDescription), output(details));

    const bridge = entry?.installPath ? findFile(entry.installPath, "trace-agent.mjs") : undefined;
    if (check("claude: the installed copy has the bridge", Boolean(bridge))) bridgeSmoke("claude", bridge);

    if (!live) skip("claude: real model session", "run with --live");
    else if (!process.env.ANTHROPIC_API_KEY) {
      skip("claude: real model session", "no ANTHROPIC_API_KEY");
      row.live = "skipped: no key";
    } else if (bridge) {
      // İzinler atlanmıyor: yalnızca becerinin gerektirdiği araçlara izin var.
      const passed = liveSmoke("claude", bridge, (workspace) =>
        run(claude, ["-p", LIVE_PROMPT, "--output-format", "text", "--no-session-persistence", "--max-budget-usd", "1", "--allowedTools", "Skill", "Bash", "Read", "Glob", "Grep"], { env, cwd: workspace, input: "", timeout: 600_000 }),
      );
      row.live = passed ? "passed" : "failed";
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    summary.push({ ...row, failed: failures - before });
  }
}

function smokeAntigravity(agy, want) {
  const home = mkdtempSync(join(tmpdir(), "trace-smoke-agy-"));
  const env = { ...process.env, HOME: home };
  const version = run(agy, ["--version"], { env }).stdout.trim();
  console.log(`\nAntigravity CLI (${version})`);
  const before = failures;
  try {
    const validate = run(agy, ["plugin", "validate", PLUGIN_DIR], { env });
    const validated = stripAnsi(validate.stdout + validate.stderr);
    check("agy: plugin validate", validate.status === 0 && /\[ok\]/.test(validated) && /skills\s*:\s*1 processed/.test(validated), output(validate));
    const install = run(agy, ["plugin", "install", PLUGIN_DIR], { env });
    const installed = stripAnsi(install.stdout + install.stderr);
    if (!check("agy: plugin install", install.status === 0 && /\[ok\]/.test(installed) && /skills\s*:\s*1 processed/.test(installed), output(install))) return;
    const list = run(agy, ["plugin", "list"], { env });
    const imports = (() => { try { return JSON.parse(list.stdout).imports ?? []; } catch { return []; } })();
    check("agy: plugin list shows it with its skills", imports.some((item) => item.name === PLUGIN && item.components?.includes("skills")), output(list));

    const copy = join(home, ".gemini", "config", "plugins", PLUGIN);
    const manifest = existsSync(join(copy, "plugin.json")) ? readJson(join(copy, "plugin.json")) : {};
    check("agy: installed manifest as written", manifest.description === want.pluginDescription);
    const bridge = findFile(copy, "trace-agent.mjs");
    if (check("agy: the installed copy has the bridge", Boolean(bridge))) bridgeSmoke("agy", bridge);
    skip("agy: real model session", "agy -p needs a Google sign-in, not an API key");
  } finally {
    rmSync(home, { recursive: true, force: true });
    summary.push({ agent: "Antigravity CLI", version, live: "not possible: needs a Google sign-in", failed: failures - before });
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.codex && !args.claude && !args.agy) {
  console.error("Usage: node scripts/plugin-smoke.mjs [--codex <bin>] [--claude <bin>] [--agy <bin>] [--live] (at least one CLI)");
  process.exit(2);
}
const want = expected();
console.log(`Trace plugin ${want.version}: installing it into each agent and running its bridge from the installed copy.`);
if (args.codex) await smokeCodex(args.codex, want, args.live);
if (args.claude) smokeClaude(args.claude, want, args.live);
if (args.agy) smokeAntigravity(args.agy, want);
console.log(failures ? `\n${failures} check(s) failed.` : "\nEvery check passed.");
// CI'da hangi sürümlerin denendiği iş özetinde kalıyor; en son sürümle koşan haftalık çalıştırmada önemli.
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = summary.map((row) => `| ${row.agent} | ${row.version || "?"} | ${row.failed ? `${row.failed} failed` : "passed"} | ${row.live} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Trace plugin ${want.version}`, "", "| Agent | Version | Checks | Real model session |", "| --- | --- | --- | --- |", ...rows, ""].join("\n"));
}
process.exit(failures ? 1 : 0);
