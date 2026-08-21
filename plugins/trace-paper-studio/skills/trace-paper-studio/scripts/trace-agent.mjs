#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProjectObject } from "./generated/validator.mjs";
import { extractFigures } from "./lib/figures.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SKILL_DIRECTORY = resolve(dirname(SCRIPT_PATH), "..");

function usage(exitCode = 0) {
  console.log(`Trace native-agent bridge

Usage:
  node trace-agent.mjs prepare (--paper <paper.pdf> | --title "<paper name>" | --arxiv <id>) --language <bcp47> [--pick <n>] [--out <directory>] [--audience general|student|expert] [--depth concise|standard|deep]
  node trace-agent.mjs validate --project <project.trace.json> [--strict]
  node trace-agent.mjs deliver --project <project.trace.json> [--out <site-directory>] [--mode lab|story]
                              [--no-open] [--no-app] [--install-app] [--app <trace-repo>] [--app-url <http://...>]
  node trace-agent.mjs stop --site <site-directory>

  --language  Required. BCP-47 tag for the language the analysis prose is
            written in (en, tr, de, pt-BR, …). Pass the language the user is
            writing to you in — the bridge cannot see the conversation, so it
            has no safe default to guess. There is no list of allowed
            languages; only the tag format is checked.
  --title   When the user has no PDF: searches arXiv for the paper, downloads
            it, and collects current metadata (version history, DOI, where it
            was published, citations). If the match is not certain the
            alternatives are reported; choose one with --pick.
  --strict  Treats the learning blocks (primer, derivations, quiz,
            interactives, application guide) as REQUIRED for the chosen depth.

  --no-app  Do not start or open the main Trace app; deliver only the
            standalone site.
  --install-app
            Runs "npm install" when the studio's dependencies are missing.
            This can take minutes, which is why it never happens on its own.
  --app     Root of the Trace repository (default: found automatically,
            TRACE_APP_DIR).
  --app-url Address of a Trace app that is already running (TRACE_APP_URL).

The bridge never calls an LLM API. The active Codex, Claude Code, or Antigravity CLI model reads the prepared paper and writes the project.

Deliver brings everything up in one command: it keeps the JSON, builds the
standalone local site, readies the main Trace app (starting its dev server if
it is not already running), hands the project over to the library, and opens
both in the browser. The user never has to import anything by hand. Servers
that were started this way are shut down with "stop --site".

If the studio does not come up the delivery still succeeded: the standalone
site works, and its "Open in Studio" button shows the command that installs
the studio. PASS THE "appNote" AND "studioCommand" FIELDS ON TO THE USER.`);
  process.exit(exitCode);
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = values[index + 1];
    if (key === "no-open" || key === "no-app" || key === "install-app" || key === "strict") {
      args[key] = true;
      continue;
    }
    if (!value || value.startsWith("--")) throw new Error(`--${key} needs a value.`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "paper";
}

function assertChoice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label} must be one of: ${choices.join(", ")}.`);
  return value;
}

/**
 * Kullanıcının elinde PDF olmayabilir. `--title` veya `--arxiv` verildiğinde
 * makale arXiv'de bulunur, indirilir ve hakkındaki güncel/resmi üstveri
 * toplanır. Sonuç job dizinine yazılır; agent bunu anlatıyı zenginleştirmek
 * için kullanır.
 */
async function resolvePaper(args) {
  if (args.paper) return { paperPath: resolve(args.paper), resolution: null };

  const query = args.title ?? args.arxiv;
  if (!query) throw new Error("One of --paper <file.pdf>, --title \"<paper name>\" or --arxiv <id> is required.");

  const { searchArxiv, fetchArxivById, rankByTitle, downloadPdf, collectContext } = await import(
    "./lib/paper-source.mjs"
  );

  let chosen;
  let candidates = [];
  if (args.arxiv) {
    chosen = await fetchArxivById(args.arxiv);
  } else {
    const results = await searchArxiv(args.title, 8);
    if (!results.length) throw new Error(`No arXiv result for: "${args.title}"`);
    candidates = rankByTitle(results, args.title);
    const index = args.pick ? Number(args.pick) - 1 : 0;
    chosen = candidates[index];
    if (!chosen) throw new Error(`--pick ${args.pick} is out of range (${candidates.length} candidates).`);
  }

  const directory = resolve(args.out ?? `.trace/jobs/${slugify(chosen.title ?? chosen.arxivId)}`);
  mkdirSync(directory, { recursive: true });
  const paperPath = join(directory, `${slugify(chosen.title ?? chosen.arxivId)}.pdf`);

  const download = await downloadPdf(chosen.pdfUrl, paperPath);
  const context = await collectContext(chosen);
  writeFileSync(join(directory, "context.json"), `${JSON.stringify(context, null, 2)}\n`, "utf8");

  return {
    paperPath,
    jobDirectoryOverride: directory,
    resolution: {
      matchedBy: args.arxiv ? "arxiv-id" : "title-search",
      arxivId: chosen.arxivId,
      title: chosen.title,
      matchScore: chosen.matchScore,
      pdfUrl: download.url,
      sizeBytes: download.sizeBytes,
      contextPath: join(directory, "context.json"),
      // Eşleşme kesin değilse agent kullanıcıya doğrulatabilsin diye
      // alternatifler her zaman raporlanır.
      alternatives: candidates.slice(0, 5).map((entry, index) => ({
        pick: index + 1,
        arxivId: entry.arxivId,
        title: entry.title,
        matchScore: entry.matchScore,
      })),
      // Güven, yakın eşleşmeyle YETİNMEZ. "denoising diffusion probabilistic
      // models" aramasında üç türev makale 0.889'da berabere kalıp orijinali
      // hiç listeye girmiyordu; 0.85 eşiği bunu "kesin" sayıyordu. Artık hem
      // neredeyse birebir başlık hem de ikinciye açık fark aranıyor.
      confident: args.arxiv
        ? true
        : (chosen.matchScore ?? 0) >= 0.95 &&
          (chosen.matchScore ?? 0) - (candidates[1]?.matchScore ?? 0) >= 0.05,
    },
  };
}

async function prepare(args) {
  /**
   * Seçenekler PDF'ten ÖNCE doğrulanıyor: `resolvePaper` arXiv'e gidip
   * megabaytlarca dosya indiriyor ve bunu eksik bir bayrak için yapmanın
   * anlamı yok. Ayrıca hatayı ajana anında geri veriyor.
   *
   * `--language` bu köprü kullanıcının hangi dilde yazdığını göremediği için
   * zorunlu. Buradaki her sessiz varsayılan kullanıcıların bir kısmı için
   * sessizce yanlış dilde çıktı üretir; tam olarak bu yaşandı: varsayılan
   * "tr" idi ve İngilizce yazan kullanıcı Türkçe analiz aldı.
   */
  if (args.language === undefined) {
    throw new Error(
      "--language is required. Pass a BCP-47 tag for the language the user is writing in (en, tr, de, pt-BR, …): it decides the language of the analysis prose, and this bridge cannot see the conversation to infer it.",
    );
  }
  // Etiket biçimi doğrulanıyor ama dil listesi YOK: Trace çıktıyı kullanıcının
  // dilinde üretiyor ve buraya konacak her liste birilerini dışarıda bırakır.
  // Biçim yine de denetleniyor, çünkü bu değer `Intl` API'lerine gidiyor.
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(args.language)) {
    throw new Error(`--language must be a BCP-47 tag such as "en", "tr" or "pt-BR"; received "${args.language}".`);
  }
  const language = args.language;
  const audience = assertChoice(args.audience ?? "student", ["general", "student", "expert"], "--audience");
  const depth = assertChoice(args.depth ?? "standard", ["concise", "standard", "deep"], "--depth");

  const { paperPath, jobDirectoryOverride, resolution } = await resolvePaper(args);
  if (!existsSync(paperPath)) throw new Error(`PDF not found: ${paperPath}`);
  if (extname(paperPath).toLowerCase() !== ".pdf") throw new Error("The input must have a .pdf extension.");
  const size = statSync(paperPath).size;
  if (size > 35 * 1024 * 1024) throw new Error("The PDF exceeds the 35 MB Trace limit.");
  const signature = readFileSync(paperPath).subarray(0, 5).toString("ascii");
  if (signature !== "%PDF-") throw new Error("The file does not carry a valid PDF signature.");

  const jobDirectory =
    jobDirectoryOverride ??
    resolve(args.out ?? `.trace/jobs/${slugify(basename(paperPath, extname(paperPath)))}`);
  mkdirSync(jobDirectory, { recursive: true });

  const rawTextPath = resolve(jobDirectory, "paper.raw.txt");
  const pageTextPath = resolve(jobDirectory, "paper.pages.txt");
  const extraction = spawnSync("pdftotext", ["-layout", paperPath, rawTextPath], { encoding: "utf8" });
  let pageCount;
  let extractedText;
  let extractionNote;
  if (!extraction.error && extraction.status === 0 && existsSync(rawTextPath)) {
    const raw = readFileSync(rawTextPath, "utf8");
    const pages = raw.split("\f").filter((page, index, all) => page.trim() || index < all.length - 1);
    extractedText = pages.map((page, index) => `--- PAGE ${index + 1} ---\n${page.trimEnd()}`).join("\n\n");
    writeFileSync(pageTextPath, `${extractedText}\n`, "utf8");
    pageCount = pages.length;
    extractionNote = "extracted with pdftotext -layout, page boundaries preserved";
  } else {
    extractionNote = extraction.error?.code === "ENOENT"
      ? "pdftotext not found; the active agent must load the PDF with its own document tool"
      : `pdftotext failed: ${(extraction.stderr || extraction.error?.message || "unknown").trim()}`;
  }

  const outputPath = resolve(jobDirectory, `${slugify(basename(paperPath, extname(paperPath)))}.trace.json`);
  /**
   * Makalenin kendi şekilleri çıkarılır. Hangisinin anlatıya girdiğine AJAN
   * karar verir — bir makalede sekiz şekil bulunabiliyor ve çoğu tablo ya da
   * ek bölüm grafiği oluyor. Burada yalnızca aday üretiliyor.
   *
   * Şekil çıkarılamaması hazırlığı düşürmez: metin zaten elimizde ve görsel
   * bir ek, zorunluluk değil.
   */
  const figureDirectory = resolve(jobDirectory, "figures");
  let figures = [];
  let figureNote;
  try {
    const extracted = extractFigures(paperPath, figureDirectory, { limit: 10 });
    figures = extracted.figures;
    figureNote = extracted.note;
  } catch (error) {
    figureNote = error instanceof Error ? error.message : String(error);
  }

  const job = {
    version: 1,
    createdAt: new Date().toISOString(),
    paper: { path: paperPath, fileName: basename(paperPath), sizeBytes: size, pageCount },
    extraction: { ready: Boolean(extractedText), pageTextPath: extractedText ? pageTextPath : undefined, note: extractionNote },
    outputPath,
    figures: figures.map((figure) => ({
      id: figure.id,
      label: figure.label,
      caption: figure.caption,
      page: figure.page,
      path: figure.file,
      widthPx: figure.widthPx,
      heightPx: figure.heightPx,
      bytes: figure.bytes,
    })),
    figureNote,
    options: { language, audience, depth },
    targets: {
      storySections: depth === "concise" ? 5 : depth === "deep" ? 8 : 6,
      reportSections: depth === "concise" ? 6 : depth === "deep" ? 9 : 7,
    },
    resolution: resolution ?? undefined,
  };
  const jobPath = resolve(jobDirectory, "job.json");
  writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        jobPath,
        outputPath,
        pageTextPath: extractedText ? pageTextPath : null,
        extractionNote,
        figureCount: figures.length,
        figureDirectory: figures.length ? figureDirectory : null,
        figureNote,
        resolution: resolution ?? undefined,
      },
      null,
      2,
    ),
  );
}

/**
 * Proje doğrulama.
 *
 * Buradaki kurallar ELLE YAZILMAZ. `scripts/generated/validator.mjs`
 * uygulamanın gerçek Zod şemasını ve bütünlük fonksiyonlarını içeren derlenmiş
 * bir pakettir (`npm run build:validator`). Eskiden bu dosyada ~380 satırlık
 * bir kopya vardı ve sapmıştı: üst sınırlar denetlenmediği için `validate`
 * "ok" derken web uygulaması aynı dosyayı reddediyordu. Kopya kaldırıldı;
 * parite artık yapısal bir garanti.
 */
function inspectProject(args, print = true) {
  if (!args.project) throw new Error("--project <project.trace.json> is required.");
  const projectPath = resolve(args.project);
  if (!existsSync(projectPath)) throw new Error(`Project not found: ${projectPath}`);

  let raw;
  try {
    raw = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch (error) {
    throw new Error(`The project is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  // --strict: öğrenme bloklarının `depth` için zorunlu olanlarını da arar.
  // Varsayılan kapalı, böylece öğrenme katmanından önce üretilmiş projeler
  // doğrulanmaya devam eder.
  const outcome = validateProjectObject(raw, { requireDepthBlocks: Boolean(args.strict) });

  if (!outcome.ok) {
    const result = { ok: false, projectPath, issueCount: outcome.issues.length, issues: outcome.issues };
    if (print) console.error(JSON.stringify(result, null, 2));
    return result;
  }

  const project = outcome.project;
  const result = {
    ok: true,
    projectPath,
    title: project.evidence.paper.title,
    claims: project.evidence.claims.length,
    storySections: project.story.sections.length,
    visualTypes: [...new Set(project.story.sections.map((section) => section.visual.type))],
    deepReport: Boolean(project.deepReport),
    technicalAppendix: Boolean(project.technicalAppendix),
    learning: {
      primerConcepts: project.primer?.concepts.length ?? 0,
      derivations: project.derivations?.length ?? 0,
      interactives: project.interactives?.length ?? 0,
      quizQuestions: project.quiz?.questions.length ?? 0,
      applicationGuide: Boolean(project.applicationGuide),
    },
    project,
  };

  if (print) {
    // Projenin tamamı çağırana döner ama konsola basılmaz; özet okunabilir kalsın.
    const summary = { ...result };
    delete summary.project;
    console.log(JSON.stringify(summary, null, 2));
  }
  return result;
}
function validateProject(args) {
  const result = inspectProject(args);
  if (!result.ok) process.exitCode = 1;
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const APP_HEALTH_MARKER = "trace-research-studio";
const APP_BOOT_TIMEOUT_MS = 180_000;

/**
 * "Bu porttaki uygulama gerçekten Trace mi?" — sağlık ucu bir protokol imzası.
 * Sadece portun açık olmasına bakmak yetmez: 3000 bambaşka bir dev sunucusu
 * olabilir ve projeyi oraya devretmek sessizce boşa giderdi.
 */
async function probeTraceApp(baseUrl, timeoutMs = 1_500) {
  try {
    const response = await fetch(new URL("/api/health", baseUrl), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.app === APP_HEALTH_MARKER;
  } catch {
    return false;
  }
}

/**
 * Trace deposunun kökünü arar. İşaret olarak `trace:agent` betiği kullanılıyor;
 * ada bakmak sahte eşleşme üretir, bu betik yalnızca bu projede var.
 *
 * Birden çok aday çıkabiliyor — plugin klonu deponun tamamını taşıdığı için
 * kendisi de bir adaydır, ama bağımlılıkları kurulu değildir. Bu yüzden
 * BAĞIMLILIKLARI KURULU olan aday tercih edilir: kullanıcının çalışan bir
 * kopyası varsa yüzlerce megabaytlık ikinci bir kurulum gereksizdir.
 */
function findAppRoots(startDirectories) {
  const found = [];
  for (const start of startDirectories) {
    if (!start) continue;
    let current = resolve(start);
    for (let depth = 0; depth < 8; depth += 1) {
      const manifest = join(current, "package.json");
      if (existsSync(manifest)) {
        try {
          const parsed = JSON.parse(readFileSync(manifest, "utf8"));
          if (parsed?.scripts?.["trace:agent"] && !found.includes(current)) found.push(current);
        } catch {
          // bozuk package.json: yukarı çıkmayı sürdür
        }
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return found;
}

const STUDIO_MEMO = join(homedir(), ".trace", "studio.json");

/**
 * Çalışır durumda bir stüdyo bir kez bulunduğunda yeri hatırlanır.
 *
 * Sebebi somut: ajan çoğu zaman kullanıcının BAŞKA bir projesinin dizininde
 * çalışıyor ve yukarı doğru arama Trace deposuna hiç rastlamıyor. Bir kez
 * depodan çalıştırmak, sonraki bütün teslimatların stüdyoyu bulmasına yetiyor.
 */
function readRememberedAppRoot() {
  try {
    const { appRoot } = JSON.parse(readFileSync(STUDIO_MEMO, "utf8"));
    return typeof appRoot === "string" && existsSync(join(appRoot, "package.json")) ? appRoot : undefined;
  } catch {
    return undefined;
  }
}

function rememberAppRoot(appRoot) {
  try {
    mkdirSync(dirname(STUDIO_MEMO), { recursive: true });
    writeFileSync(STUDIO_MEMO, `${JSON.stringify({ appRoot }, null, 2)}\n`, "utf8");
  } catch {
    // hatırlamak bir kolaylık; başarısız olması teslimatı etkilemez
  }
}

function findAppRoot(startDirectories) {
  const roots = findAppRoots([readRememberedAppRoot(), ...startDirectories]);
  return roots.find((root) => existsSync(join(root, "node_modules", "next"))) ?? roots[0];
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * Stüdyonun bağımlılıklarını kurar. Yüzlerce megabayt indirip dakikalar
 * sürebildiği için KENDİLİĞİNDEN çalışmaz: bir makaleyi anlatma isteği,
 * kullanıcının diskine bu boyutta bir şey yazma izni değildir. `--install-app`
 * ile açıkça istenir.
 */
function installAppDependencies(appRoot, logDirectory) {
  const logPath = join(logDirectory, "trace-app-install.log");
  const log = openSync(logPath, "a");
  const result = spawnSync(npmCommand(), ["install", "--no-audit", "--no-fund"], {
    cwd: appRoot,
    stdio: ["ignore", log, log],
    timeout: 15 * 60 * 1000,
  });
  if (result.status === 0) return { ok: true, logPath };
  return { ok: false, reason: `npm install failed (${result.status ?? result.signal}); log: ${logPath}`, logPath };
}

async function startTraceApp(appRoot, logDirectory, args) {
  if (!existsSync(join(appRoot, "node_modules", "next"))) {
    if (!args["install-app"]) {
      return {
        ok: false,
        appRoot,
        command: `cd "${appRoot}" && npm install && npm run dev`,
        reason: `Trace Studio dependencies are not installed. Run once: cd "${appRoot}" && npm install — or re-run deliver with --install-app.`,
      };
    }
    const installed = installAppDependencies(appRoot, logDirectory);
    if (!installed.ok) return { ok: false, appRoot, command: `cd "${appRoot}" && npm install && npm run dev`, reason: installed.reason };
  }
  const port = await findOpenPort(3000);
  const url = `http://127.0.0.1:${port}`;
  const logPath = join(logDirectory, "trace-app.log");
  const log = openSync(logPath, "a");
  const child = spawn(npmCommand(), ["run", "dev", "--", "--port", String(port)], {
    cwd: appRoot,
    detached: true,
    stdio: ["ignore", log, log],
  });
  let exited = false;
  child.on("error", () => { exited = true; });
  child.on("exit", () => { exited = true; });
  child.unref();

  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeTraceApp(url, 2_000)) {
      rememberAppRoot(appRoot);
      return { ok: true, url, port, pid: child.pid, logPath, started: true, appRoot };
    }
    if (exited) {
      return { ok: false, appRoot, command: `cd "${appRoot}" && npm run dev`, reason: `The dev server exited; log: ${logPath}`, logPath };
    }
    await new Promise((wait) => setTimeout(wait, 500));
  }
  return { ok: false, appRoot, command: `cd "${appRoot}" && npm run dev`, reason: `The dev server did not answer within ${APP_BOOT_TIMEOUT_MS / 1000}s; log: ${logPath}`, logPath };
}

/**
 * Ana uygulamayı hazır hale getirir: ayaktaysa onu kullanır, değilse başlatır.
 * Başarısızlık teslimatı DÜŞÜRMEZ — bağımsız site zaten çalışıyor ve JSON
 * diskte duruyor; ana uygulama bir ek yüzey.
 */
async function ensureTraceApp(args, logDirectory) {
  if (args["no-app"]) return { ok: false, skipped: "--no-app was passed." };

  const explicitUrl = args["app-url"] ?? process.env.TRACE_APP_URL;
  if (explicitUrl) {
    const url = explicitUrl.replace(/\/+$/, "");
    if (await probeTraceApp(url, 4_000)) return { ok: true, url, started: false, reused: true };
    return { ok: false, reason: `No Trace app answered at ${url}.` };
  }

  for (const port of [3000, 3001, 3002]) {
    const url = `http://127.0.0.1:${port}`;
    if (await probeTraceApp(url)) return { ok: true, url, port, started: false, reused: true };
  }

  const appRoot = args.app ?? process.env.TRACE_APP_DIR
    ?? findAppRoot([SKILL_DIRECTORY, process.cwd()]);
  if (!appRoot) {
    return { ok: false, reason: "The Trace repository was not found; point at it with --app <dir> or TRACE_APP_DIR." };
  }
  if (!existsSync(join(resolve(appRoot), "package.json"))) {
    return { ok: false, reason: `${appRoot} is not a Node project.` };
  }
  return startTraceApp(resolve(appRoot), logDirectory, args);
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Aynı proje ikinci kez teslim edildiğinde yeni sunucu açmaz. Aksi halde her
 * çalıştırma bir port daha tutar ve kullanıcı hangi sekmenin güncel olduğunu
 * bilemez.
 */
async function reuseViewerServer(statusPath, projectId) {
  if (!existsSync(statusPath)) return undefined;
  try {
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    if (!isAlive(status.pid)) return undefined;
    const response = await fetch(`${status.url}/${encodeURIComponent(projectId)}.trace.json`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return undefined;
    const served = await response.json();
    return served?.id === projectId ? status : undefined;
  } catch {
    return undefined;
  }
}

function findOpenPort(start = 4317) {
  return new Promise((resolvePort, reject) => {
    const tryPort = (port) => {
      const probe = createNetServer();
      probe.unref();
      probe.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port < start + 100) tryPort(port + 1);
        else reject(error);
      });
      probe.listen({ host: "127.0.0.1", port }, () => {
        const selected = probe.address().port;
        probe.close(() => resolvePort(selected));
      });
    };
    tryPort(start);
  });
}

function contentType(pathname) {
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".html") || pathname === "/") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function serve(args) {
  if (!args.site) throw new Error("--site <site-directory> is required.");
  if (!args.port) throw new Error("--port <port> is required.");
  const siteDirectory = resolve(args.site);
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a valid TCP port.");

  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relativePath = requested === "/" ? "index.html" : decodeURIComponent(requested).replace(/^\/+/, "");
    const filePath = resolve(siteDirectory, normalize(relativePath));
    if (filePath !== siteDirectory && !filePath.startsWith(`${siteDirectory}/`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    const headers = {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    };
    // Ana uygulama (localhost:3000) projeyi buradan çekip kütüphanesine alıyor.
    // İzin YALNIZCA loopback kaynaklara ve YALNIZCA proje dosyasına veriliyor:
    // sitenin geri kalanı hiçbir sayfaya açılmıyor.
    const origin = request.headers.origin;
    if (origin && LOOPBACK_ORIGIN.test(origin) && filePath.endsWith(".trace.json")) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
    response.writeHead(200, headers);
    response.end(readFileSync(filePath));
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    if (args.status) {
      writeFileSync(resolve(args.status), `${JSON.stringify({ pid: process.pid, port, url, siteDirectory }, null, 2)}\n`, "utf8");
    }
  });
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 125));
  }
  throw new Error(`The local Trace server could not be started: ${lastError instanceof Error ? lastError.message : "timed out"}`);
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const values = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const opened = spawnSync(command, values, { stdio: "ignore" });
  return !opened.error && opened.status === 0;
}

async function deliver(args) {
  const validation = inspectProject(args, false);
  if (!validation.ok) {
    console.error(JSON.stringify(validation, null, 2));
    process.exitCode = 1;
    return;
  }
  const projectPath = validation.projectPath;
  const siteDirectory = resolve(args.out ?? join(dirname(projectPath), "trace-site"));
  mkdirSync(siteDirectory, { recursive: true });

  const templatePath = join(SKILL_DIRECTORY, "assets", "viewer.html");
  if (!existsSync(templatePath)) throw new Error(`The Trace viewer template could not be found: ${templatePath}`);
  const serializedProject = JSON.stringify(validation.project).replaceAll("<", "\\u003c");
  // Şablon bir DERLEME ARTEFAKTIDIR (npm run build:viewer). Burada yalnızca
  // yer tutucular doldurulur; böylece plugin çalışma anında bağımlılıksız kalır.
  // `replace` yerine fonksiyon verilir: proje metni "$&" gibi diziler içerirse
  // string sürümü onları desen referansı sanıp bozar.
  const projectId = validation.project.id || "project";
  const jsonPath = join(siteDirectory, `${projectId}.trace.json`);
  writeFileSync(jsonPath, `${JSON.stringify(validation.project, null, 2)}\n`, "utf8");

  const statusPath = join(siteDirectory, ".trace-server.json");
  // Ana uygulamanın açılışı yavaş; bağımsız site ile paralel yürütülüyor.
  const appPromise = ensureTraceApp(args, siteDirectory);

  const existing = await reuseViewerServer(statusPath, projectId);
  let url = existing?.url;
  let serverPid = existing?.pid;
  if (!existing) {
    const port = await findOpenPort(args.port ? Number(args.port) : 4317);
    const child = spawn(process.execPath, [SCRIPT_PATH, "serve", "--site", siteDirectory, "--port", String(port), "--status", statusPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    url = `http://127.0.0.1:${port}`;
    serverPid = child.pid;
    // Hazır olma denetimi PROJE DOSYASI üzerinden yapılır: `index.html` ancak
    // stüdyo devir teslimi belli olduktan sonra yazılıyor, dolayısıyla kök
    // adres bu noktada henüz 404 döner.
    await waitForServer(`${url}/${encodeURIComponent(projectId)}.trace.json`);
  }

  const jsonUrl = `${url}/${encodeURIComponent(projectId)}.trace.json`;
  const app = await appPromise;
  // Devir teslim adresi: uygulama projeyi kendisi indirip kütüphaneye yazıyor,
  // kullanıcıdan hiçbir içe aktarma adımı beklenmiyor.
  const appUrl = app.ok ? `${app.url}/?import=${encodeURIComponent(jsonUrl)}` : undefined;
  if (app.ok && app.started) {
    writeFileSync(join(siteDirectory, ".trace-app.json"), `${JSON.stringify(app, null, 2)}\n`, "utf8");
  }

  // Bağımsız sayfadaki "Open in Studio" köprüsü. Stüdyo ayaktaysa doğrudan
  // adres, değilse onu ayağa kaldıran komut gömülür — kullanıcı hangi durumda
  // olduğunu sayfadan görür, tarayıcı hata ekranından değil.
  const studio = appUrl
    ? { url: appUrl }
    : app.command
      ? { command: app.command, directory: app.appRoot }
      : {};
  const html = readFileSync(templatePath, "utf8")
    .replace("__TRACE_PROJECT_JSON__", () => serializedProject)
    .replace("__TRACE_VIEW_MODE__", () => (args.mode === "story" ? "story" : "lab"))
    .replace("__TRACE_STUDIO_JSON__", () => JSON.stringify(studio).replaceAll("<", "\\u003c"));
  writeFileSync(join(siteDirectory, "index.html"), html, "utf8");

  // Bağımsız site önce, ana uygulama sonra açılır: tarayıcı son sekmeye
  // odaklanır ve kullanıcı zengin yüzeyde başlar.
  const opened = [];
  if (!args["no-open"]) {
    if (openBrowser(url)) opened.push("viewer");
    if (appUrl && openBrowser(appUrl)) opened.push("app");
  }

  console.log(JSON.stringify({
    ok: true,
    title: validation.title,
    url,
    appUrl,
    appStarted: app.ok ? Boolean(app.started) : false,
    appNote: app.ok ? undefined : (app.reason ?? app.skipped),
    opened,
    siteDirectory,
    jsonPath,
    jsonUrl,
    sourceProjectPath: projectPath,
    serverPid,
    appPid: app.ok ? app.pid : undefined,
    studioCommand: app.ok ? undefined : app.command,
    note: opened.length > 0
      ? `Opened: ${opened.join(", ")}. The JSON stays in the same folder.`
      : `Could not open a browser. Standalone site: ${url}${appUrl ? ` · Studio: ${appUrl}` : ""}`,
  }, null, 2));
}

/** Teslimat sırasında başlatılan sunucuları kapatır. */
function stopServers(args) {
  if (!args.site) throw new Error("--site <site-directory> is required.");
  const siteDirectory = resolve(args.site);
  const stopped = [];
  for (const [name, file] of [["viewer", ".trace-server.json"], ["app", ".trace-app.json"]]) {
    const statusPath = join(siteDirectory, file);
    if (!existsSync(statusPath)) continue;
    try {
      const status = JSON.parse(readFileSync(statusPath, "utf8"));
      if (isAlive(status.pid)) {
        // Dev sunucusu alt süreçler doğuruyor; `detached` ile açıldığı için
        // süreç grubunun tamamı negatif pid ile kapatılıyor.
        try { process.kill(-status.pid, "SIGTERM"); } catch { process.kill(status.pid, "SIGTERM"); }
        stopped.push({ name, pid: status.pid, url: status.url });
      }
    } catch {
      // bozuk durum dosyası: atla
    }
  }
  console.log(JSON.stringify({ ok: true, stopped }, null, 2));
}

try {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") usage();
  const args = parseArgs(rest);
  if (command === "prepare") await prepare(args);
  else if (command === "validate") validateProject(args);
  else if (command === "deliver") await deliver(args);
  else if (command === "stop") stopServers(args);
  else if (command === "serve") serve(args);
  else usage(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
