#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SKILL_DIRECTORY = resolve(dirname(SCRIPT_PATH), "..");

const ADVANCED_VISUALS = new Set(["architecture", "equation", "timeline", "matrix", "infographic"]);
const REPORT_KINDS = ["contribution", "mechanism", "experiment", "critique", "reproduction", "implication"];

function usage(exitCode = 0) {
  console.log(`Trace native-agent bridge

Usage:
  node trace-agent.mjs prepare --paper <paper.pdf> [--out <directory>] [--language tr|en] [--audience general|student|expert] [--depth concise|standard|deep]
  node trace-agent.mjs validate --project <project.trace.json>
  node trace-agent.mjs deliver --project <project.trace.json> [--out <site-directory>] [--no-open]

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
    if (key === "no-open") {
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

function inspectProject(args, print = true) {
  if (!args.project) throw new Error("--project <project.trace.json> gerekli.");
  const projectPath = resolve(args.project);
  if (!existsSync(projectPath)) throw new Error(`Proje bulunamadı: ${projectPath}`);
  let project;
  try {
    project = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch (error) {
    throw new Error(`Proje geçerli JSON değil: ${error instanceof Error ? error.message : String(error)}`);
  }
  const issues = [];
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const array = (value) => Array.isArray(value) ? value : [];
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const unique = (values) => new Set(values).size === values.length;
  const requireText = (value, path) => { if (!text(value)) issues.push(`${path}: dolu metin gerekli`); };
  const requireArray = (value, path, min = 0) => {
    if (!Array.isArray(value) || value.length < min) issues.push(`${path}: en az ${min} öğeli dizi gerekli`);
    return array(value);
  };

  if (!object(project)) issues.push("root: nesne gerekli");
  if (project?.version !== 1) issues.push("version: 1 olmalı");
  requireText(project?.id, "id");
  requireText(project?.createdAt, "createdAt");
  requireText(project?.updatedAt, "updatedAt");
  if (!["tr", "en"].includes(project?.language)) issues.push("language: tr veya en olmalı");
  if (!["general", "student", "expert"].includes(project?.audience)) issues.push("audience geçersiz");
  if (!["concise", "standard", "deep"].includes(project?.depth)) issues.push("depth geçersiz");

  const evidence = project?.evidence;
  if (!object(evidence)) issues.push("evidence: nesne gerekli");
  requireText(evidence?.paper?.title, "evidence.paper.title");
  requireArray(evidence?.paper?.authors, "evidence.paper.authors", 1);
  requireText(evidence?.paper?.year, "evidence.paper.year");
  requireText(evidence?.paper?.venue, "evidence.paper.venue");
  ["thesis", "plainSummary", "researchQuestion"].forEach((key) => requireText(evidence?.[key], `evidence.${key}`));
  requireArray(evidence?.methods, "evidence.methods", 1);
  requireArray(evidence?.findings, "evidence.findings", 1);
  requireArray(evidence?.limitations, "evidence.limitations", 1);
  const sources = requireArray(evidence?.sources, "evidence.sources", 1);
  const sourceIdValues = sources.map((source) => source?.id).filter(text);
  const sourceIds = new Set(sourceIdValues);
  if (!sourceIds.has("paper")) issues.push('evidence.sources: id "paper" olan ana kaynak gerekli');
  if (!unique(sourceIdValues)) issues.push("evidence.sources: source id değerleri benzersiz olmalı");
  const claims = requireArray(evidence?.claims, "evidence.claims", 4);
  const claimIds = claims.map((claim) => claim?.id).filter(text);
  if (!unique(claimIds)) issues.push("evidence.claims: claim id değerleri benzersiz olmalı");
  claims.forEach((claim, claimIndex) => {
    const path = `evidence.claims[${claimIndex}]`;
    requireText(claim?.id, `${path}.id`);
    requireText(claim?.statement, `${path}.statement`);
    if (!["reported-result", "author-interpretation", "method", "background", "limitation"].includes(claim?.kind)) issues.push(`${path}.kind geçersiz`);
    if (!["verified", "needs-review"].includes(claim?.confidence)) issues.push(`${path}.confidence geçersiz`);
    requireArray(claim?.sourceRefs, `${path}.sourceRefs`, 1).forEach((reference, refIndex) => {
      const refPath = `${path}.sourceRefs[${refIndex}]`;
      if (!sourceIds.has(reference?.sourceId)) issues.push(`${refPath}.sourceId bilinmeyen kaynak`);
      requireText(reference?.excerpt, `${refPath}.excerpt`);
      if (reference?.sourceId === "paper" && !(Number.isInteger(reference?.page) && reference.page > 0)) issues.push(`${refPath}.page pozitif tamsayı olmalı`);
    });
  });
  if (!claims.some((claim) => claim?.kind === "method")) issues.push("evidence.claims: yöntem claim’i gerekli");
  if (!claims.some((claim) => claim?.kind === "limitation")) issues.push("evidence.claims: sınırlılık claim’i gerekli");
  if (!claims.some((claim) => claim?.confidence === "verified")) issues.push("evidence.claims: verified claim gerekli");
  requireArray(evidence?.metrics, "evidence.metrics").forEach((metric, index) => {
    requireText(metric?.id, `evidence.metrics[${index}].id`);
    if (typeof metric?.value !== "number" || !Number.isFinite(metric.value)) issues.push(`evidence.metrics[${index}].value: sonlu sayı gerekli`);
    if (!sourceIds.has(metric?.sourceRef?.sourceId)) issues.push(`evidence.metrics[${index}].sourceRef: bilinmeyen kaynak`);
    requireText(metric?.sourceRef?.excerpt, `evidence.metrics[${index}].sourceRef.excerpt`);
  });
  requireArray(evidence?.glossary, "evidence.glossary");

  const story = project?.story;
  if (!object(story)) issues.push("story: nesne gerekli");
  ["title", "dek", "readingTime"].forEach((key) => requireText(story?.[key], `story.${key}`));
  if (!/^#[0-9a-f]{6}$/i.test(story?.accent ?? "")) issues.push("story.accent: #RRGGBB gerekli");
  const targetStory = project?.depth === "concise" ? 5 : project?.depth === "deep" ? 8 : 6;
  const sections = requireArray(story?.sections, "story.sections", targetStory);
  if (sections.length !== targetStory) issues.push(`story.sections: tam ${targetStory} bölüm gerekli`);
  const sectionIds = sections.map((section) => section?.id).filter(text);
  if (!unique(sectionIds)) issues.push("story.sections: section id değerleri benzersiz olmalı");
  const visualTypes = new Set();
  sections.forEach((section, index) => {
    const path = `story.sections[${index}]`;
    ["id", "kicker", "title", "body"].forEach((key) => requireText(section?.[key], `${path}.${key}`));
    if (section?.indexLabel !== String(index + 1).padStart(2, "0")) issues.push(`${path}.indexLabel yanlış`);
    requireArray(section?.claimIds, `${path}.claimIds`, 1).forEach((id) => {
      if (!claimIds.includes(id)) issues.push(`${path}.claimIds: bilinmeyen ${id}`);
    });
    requireText(section?.visual?.type, `${path}.visual.type`);
    requireText(section?.visual?.eyebrow, `${path}.visual.eyebrow`);
    requireText(section?.visual?.caption, `${path}.visual.caption`);
    if (text(section?.visual?.type)) visualTypes.add(section.visual.type);
    if (section?.visual?.type === "architecture") {
      const nodeIds = requireArray(section.visual.nodes, `${path}.visual.nodes`, 3).map((node) => node?.id);
      requireArray(section.visual.edges, `${path}.visual.edges`, 2).forEach((edge) => {
        if (!nodeIds.includes(edge?.from) || !nodeIds.includes(edge?.to)) issues.push(`${path}.visual.edges: bilinmeyen node bağlantısı`);
      });
    }
    if (section?.visual?.type === "matrix") {
      const columns = requireArray(section.visual.columns, `${path}.visual.columns`, 2);
      requireArray(section.visual.rows, `${path}.visual.rows`, 2).forEach((row) => {
        if (array(row?.cells).length !== columns.length) issues.push(`${path}.visual.rows: hücre/sütun sayısı eşleşmiyor`);
      });
    }
  });
  if (visualTypes.size < 3) issues.push("story.sections: en az 3 farklı görsel türü gerekli");
  if (![...visualTypes].some((type) => ADVANCED_VISUALS.has(type))) issues.push("story.sections: gelişmiş görsel türü gerekli");
  requireText(story?.closing?.title, "story.closing.title");
  requireText(story?.closing?.body, "story.closing.body");

  if (project?.deepReport !== undefined) {
    const report = project.deepReport;
    ["title", "dek", "readingTime"].forEach((key) => requireText(report?.[key], `deepReport.${key}`));
    const targetReport = project?.depth === "concise" ? 6 : project?.depth === "deep" ? 9 : 7;
    const reportSections = requireArray(report?.sections, "deepReport.sections", targetReport);
    if (reportSections.length !== targetReport) issues.push(`deepReport.sections: tam ${targetReport} bölüm gerekli`);
    REPORT_KINDS.forEach((kind) => {
      if (!reportSections.some((section) => section?.kind === kind)) issues.push(`deepReport.sections: ${kind} bölümü gerekli`);
    });
    reportSections.forEach((section, index) => requireArray(section?.claimIds, `deepReport.sections[${index}].claimIds`, 1).forEach((id) => {
      if (!claimIds.includes(id)) issues.push(`deepReport.sections[${index}].claimIds: bilinmeyen ${id}`);
    }));
    requireArray(report?.openQuestions, "deepReport.openQuestions", 3);
  }

  if (project?.technicalAppendix !== undefined) {
    const appendix = project.technicalAppendix;
    requireText(appendix?.title, "technicalAppendix.title");
    requireText(appendix?.overview, "technicalAppendix.overview");
    const linked = [
      ...requireArray(appendix?.equations, "technicalAppendix.equations"),
      ...requireArray(appendix?.algorithmSteps, "technicalAppendix.algorithmSteps", 2),
      ...requireArray(appendix?.codeSketches, "technicalAppendix.codeSketches"),
      ...requireArray(appendix?.complexity, "technicalAppendix.complexity"),
    ];
    linked.forEach((item, index) => requireArray(item?.claimIds, `technicalAppendix.items[${index}].claimIds`, 1).forEach((id) => {
      if (!claimIds.includes(id)) issues.push(`technicalAppendix.items[${index}].claimIds: bilinmeyen ${id}`);
    }));
    if (!linked.length) issues.push("technicalAppendix: en az bir kanıta bağlı teknik öğe gerekli");
    requireArray(appendix?.implementationNotes, "technicalAppendix.implementationNotes", 2);
  }

  if (issues.length) {
    const result = { ok: false, projectPath, issueCount: issues.length, issues };
    if (print) console.error(JSON.stringify(result, null, 2));
    return result;
  }
  const result = {
    ok: true,
    projectPath,
    title: evidence.paper.title,
    claims: claims.length,
    storySections: sections.length,
    visualTypes: [...visualTypes],
    deepReport: Boolean(project.deepReport),
    technicalAppendix: Boolean(project.technicalAppendix),
    project,
  };
  if (print) {
    const summary = {
      ok: result.ok,
      projectPath: result.projectPath,
      title: result.title,
      claims: result.claims,
      storySections: result.storySections,
      visualTypes: result.visualTypes,
      deepReport: result.deepReport,
      technicalAppendix: result.technicalAppendix,
    };
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
  const html = readFileSync(templatePath, "utf8").replace("__TRACE_PROJECT_JSON__", serializedProject);
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
