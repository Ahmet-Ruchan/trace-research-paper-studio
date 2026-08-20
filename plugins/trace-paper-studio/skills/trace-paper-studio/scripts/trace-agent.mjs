#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProjectObject } from "./generated/validator.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SKILL_DIRECTORY = resolve(dirname(SCRIPT_PATH), "..");

function usage(exitCode = 0) {
  console.log(`Trace native-agent bridge

Usage:
  node trace-agent.mjs prepare --paper <paper.pdf> [--out <directory>] [--language tr|en] [--audience general|student|expert] [--depth concise|standard|deep]
  node trace-agent.mjs validate --project <project.trace.json> [--strict]
  node trace-agent.mjs deliver --project <project.trace.json> [--out <site-directory>] [--no-open] [--mode lab|story]

  --strict  Öğrenme bloklarını (ön bilgi, türetim, quiz, interaktif, uygulama
            rehberi) seçilen derinlik için ZORUNLU sayar.

The bridge never calls an LLM API. The active Codex, Claude Code, or Gemini CLI model reads the prepared paper and writes the project. Deliver keeps the JSON, builds a local Trace site, and opens it in the default browser.`);
  process.exit(exitCode);
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = values[index + 1];
    if (key === "no-open" || key === "strict") {
      args[key] = true;
      continue;
    }
    if (!value || value.startsWith("--")) throw new Error(`--${key} için değer gerekli.`);
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
  if (!choices.includes(value)) throw new Error(`${label} ${choices.join(", ")} değerlerinden biri olmalı.`);
  return value;
}

function prepare(args) {
  if (!args.paper) throw new Error("--paper <paper.pdf> gerekli.");
  const paperPath = resolve(args.paper);
  if (!existsSync(paperPath)) throw new Error(`PDF bulunamadı: ${paperPath}`);
  if (extname(paperPath).toLowerCase() !== ".pdf") throw new Error("Girdi .pdf uzantılı olmalı.");
  const size = statSync(paperPath).size;
  if (size > 35 * 1024 * 1024) throw new Error("PDF 35 MB Trace sınırını aşıyor.");
  const signature = readFileSync(paperPath).subarray(0, 5).toString("ascii");
  if (signature !== "%PDF-") throw new Error("Dosya geçerli bir PDF imzası taşımıyor.");

  const language = assertChoice(args.language ?? "tr", ["tr", "en"], "--language");
  const audience = assertChoice(args.audience ?? "student", ["general", "student", "expert"], "--audience");
  const depth = assertChoice(args.depth ?? "standard", ["concise", "standard", "deep"], "--depth");
  const jobDirectory = resolve(args.out ?? `.trace/jobs/${slugify(basename(paperPath, extname(paperPath)))}`);
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
    extractionNote = "pdftotext -layout ile sayfa sınırları korunarak çıkarıldı";
  } else {
    extractionNote = extraction.error?.code === "ENOENT"
      ? "pdftotext bulunamadı; aktif agent PDF’i kendi belge aracına yüklemeli"
      : `pdftotext başarısız: ${(extraction.stderr || extraction.error?.message || "unknown").trim()}`;
  }

  const outputPath = resolve(jobDirectory, `${slugify(basename(paperPath, extname(paperPath)))}.trace.json`);
  const job = {
    version: 1,
    createdAt: new Date().toISOString(),
    paper: { path: paperPath, fileName: basename(paperPath), sizeBytes: size, pageCount },
    extraction: { ready: Boolean(extractedText), pageTextPath: extractedText ? pageTextPath : undefined, note: extractionNote },
    outputPath,
    options: { language, audience, depth },
    targets: {
      storySections: depth === "concise" ? 5 : depth === "deep" ? 8 : 6,
      reportSections: depth === "concise" ? 6 : depth === "deep" ? 9 : 7,
    },
  };
  const jobPath = resolve(jobDirectory, "job.json");
  writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, jobPath, outputPath, pageTextPath: extractedText ? pageTextPath : null, extractionNote }, null, 2));
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
  if (!args.project) throw new Error("--project <project.trace.json> gerekli.");
  const projectPath = resolve(args.project);
  if (!existsSync(projectPath)) throw new Error(`Proje bulunamadı: ${projectPath}`);

  let raw;
  try {
    raw = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch (error) {
    throw new Error(`Proje geçerli JSON değil: ${error instanceof Error ? error.message : String(error)}`);
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
  if (!args.site) throw new Error("--site <site-directory> gerekli.");
  if (!args.port) throw new Error("--port <port> gerekli.");
  const siteDirectory = resolve(args.site);
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port geçerli bir TCP portu olmalı.");

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
    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    });
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
  throw new Error(`Yerel Trace sunucusu başlatılamadı: ${lastError instanceof Error ? lastError.message : "zaman aşımı"}`);
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
  if (!existsSync(templatePath)) throw new Error(`Trace görüntüleyici şablonu bulunamadı: ${templatePath}`);
  const serializedProject = JSON.stringify(validation.project).replaceAll("<", "\\u003c");
  // Şablon bir DERLEME ARTEFAKTIDIR (npm run build:viewer). Burada yalnızca
  // yer tutucular doldurulur; böylece plugin çalışma anında bağımlılıksız kalır.
  // `replace` yerine fonksiyon verilir: proje metni "$&" gibi diziler içerirse
  // string sürümü onları desen referansı sanıp bozar.
  const html = readFileSync(templatePath, "utf8")
    .replace("__TRACE_PROJECT_JSON__", () => serializedProject)
    .replace("__TRACE_VIEW_MODE__", () => (args.mode === "story" ? "story" : "lab"));
  const jsonPath = join(siteDirectory, `${validation.project.id || "project"}.trace.json`);
  writeFileSync(join(siteDirectory, "index.html"), html, "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(validation.project, null, 2)}\n`, "utf8");

  const port = await findOpenPort(args.port ? Number(args.port) : 4317);
  const statusPath = join(siteDirectory, ".trace-server.json");
  const child = spawn(process.execPath, [SCRIPT_PATH, "serve", "--site", siteDirectory, "--port", String(port), "--status", statusPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  const browserOpened = args["no-open"] ? false : openBrowser(url);
  console.log(JSON.stringify({
    ok: true,
    title: validation.title,
    url,
    browserOpened,
    siteDirectory,
    jsonPath,
    sourceProjectPath: projectPath,
    serverPid: child.pid,
    note: browserOpened ? "Trace yerel sitede açıldı; JSON aynı klasörde tutuluyor." : `Tarayıcı otomatik açılamadıysa bu URL'yi aç: ${url}`,
  }, null, 2));
}

try {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") usage();
  const args = parseArgs(rest);
  if (command === "prepare") prepare(args);
  else if (command === "validate") validateProject(args);
  else if (command === "deliver") await deliver(args);
  else if (command === "serve") serve(args);
  else usage(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
