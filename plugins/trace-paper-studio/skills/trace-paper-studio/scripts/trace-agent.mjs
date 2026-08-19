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
  const requireArray = (value, path, min = 0, max = Infinity) => {
    if (!Array.isArray(value)) {
      issues.push(`${path}: dizi gerekli`);
      return [];
    }
    if (value.length < min) issues.push(`${path}: en az ${min} öğe gerekli (bulunan ${value.length})`);
    if (value.length > max) issues.push(`${path}: en fazla ${max} öğe olabilir (bulunan ${value.length})`);
    return value;
  };
  const requireStrings = (value, path, min = 0, max = Infinity) =>
    requireArray(value, path, min, max).forEach((entry, index) => requireText(entry, `${path}[${index}]`));
  const requireEnum = (value, path, allowed) => {
    if (!allowed.includes(value)) issues.push(`${path}: ${allowed.join(" | ")} değerlerinden biri olmalı`);
  };
  const requireOptionalText = (value, path) => {
    if (value !== undefined && !text(value)) issues.push(`${path}: verildiyse dolu metin olmalı`);
  };
  const requireItems = (value, path, shape, min = 0, max = Infinity) => {
    requireArray(value, path, min, max).forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!object(item)) {
        issues.push(`${itemPath}: nesne gerekli`);
        return;
      }
      shape(item, itemPath);
    });
  };
  const TONES = ["paper", "accent", "ink"];
  const CELL_TONES = ["low", "medium", "high", "neutral"];
  const NODE_GROUPS = ["input", "core", "output", "evidence"];
  const VISUAL_TYPES = [
    "metric", "flow", "comparison", "concept", "layers",
    "quote", "architecture", "equation", "timeline", "matrix", "infographic",
  ];
  const requireSourceRef = (reference, path, sourceIds) => {
    if (!object(reference)) {
      issues.push(`${path}: nesne gerekli`);
      return;
    }
    if (!sourceIds.has(reference.sourceId)) issues.push(`${path}.sourceId: bilinmeyen kaynak`);
    requireText(reference.excerpt, `${path}.excerpt`);
    requireOptionalText(reference.locator, `${path}.locator`);
    if (reference.page !== undefined && !(Number.isInteger(reference.page) && reference.page > 0)) {
      issues.push(`${path}.page: pozitif tamsayı olmalı`);
    }
    if (reference.sourceId === "paper" && reference.page === undefined) {
      issues.push(`${path}.page: paper kaynağı için PDF sayfası zorunlu`);
    }
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
  requireOptionalText(evidence?.paper?.doi, "evidence.paper.doi");
  requireStrings(evidence?.paper?.authors, "evidence.paper.authors", 1);
  const sources = requireArray(evidence?.sources, "evidence.sources", 1);
  requireItems(evidence?.sources, "evidence.sources", (source, path) => {
    requireText(source.id, `${path}.id`);
    requireEnum(source.type, `${path}.type`, ["paper", "web"]);
    requireText(source.title, `${path}.title`);
    requireOptionalText(source.url, `${path}.url`);
    requireOptionalText(source.fileName, `${path}.fileName`);
  }, 1);
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
      requireSourceRef(reference, `${path}.sourceRefs[${refIndex}]`, sourceIds);
    });
  });
  if (!claims.some((claim) => claim?.kind === "method")) issues.push("evidence.claims: yöntem claim’i gerekli");
  if (!claims.some((claim) => claim?.kind === "limitation")) issues.push("evidence.claims: sınırlılık claim’i gerekli");
  if (!claims.some((claim) => claim?.confidence === "verified")) issues.push("evidence.claims: verified claim gerekli");
  const metrics = requireArray(evidence?.metrics, "evidence.metrics");
  const metricIdValues = metrics.map((metric) => metric?.id).filter(text);
  if (!unique(metricIdValues)) issues.push("evidence.metrics: metric id değerleri benzersiz olmalı");
  requireItems(evidence?.metrics, "evidence.metrics", (metric, path) => {
    requireText(metric.id, `${path}.id`);
    requireText(metric.label, `${path}.label`);
    if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) issues.push(`${path}.value: sonlu sayı gerekli`);
    requireText(metric.displayValue, `${path}.displayValue`);
    requireText(metric.unit, `${path}.unit`);
    requireText(metric.context, `${path}.context`);
    requireSourceRef(metric.sourceRef, `${path}.sourceRef`, sourceIds);
  });
  const metricValues = metrics.map((metric) => metric?.value).filter((value) => typeof value === "number");
  requireItems(evidence?.glossary, "evidence.glossary", (item, path) => {
    requireText(item.term, `${path}.term`);
    requireText(item.definition, `${path}.definition`);
    if (item.sourceRef !== undefined) requireSourceRef(item.sourceRef, `${path}.sourceRef`, sourceIds);
  });

  const story = project?.story;
  if (!object(story)) issues.push("story: nesne gerekli");
  ["title", "dek", "readingTime"].forEach((key) => requireText(story?.[key], `story.${key}`));
  if (!/^#[0-9a-f]{6}$/i.test(story?.accent ?? "")) issues.push("story.accent: #RRGGBB gerekli");
  const targetStory = project?.depth === "concise" ? 5 : project?.depth === "deep" ? 8 : 6;
  const sections = requireArray(story?.sections, "story.sections", 5, 8);
  if (sections.length !== targetStory) issues.push(`story.sections: tam ${targetStory} bölüm gerekli (bulunan ${sections.length})`);
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
    const visual = section?.visual;
    const vPath = `${path}.visual`;
    if (!object(visual)) {
      issues.push(`${vPath}: nesne gerekli`);
      return;
    }
    requireEnum(visual.type, `${vPath}.type`, VISUAL_TYPES);
    requireText(visual.eyebrow, `${vPath}.eyebrow`);
    requireText(visual.caption, `${vPath}.caption`);
    if (text(visual.type)) visualTypes.add(visual.type);

    const labelDetail = (item, itemPath) => {
      requireText(item.label, `${itemPath}.label`);
      requireText(item.detail, `${itemPath}.detail`);
    };

    switch (visual.type) {
      case "metric":
        requireItems(visual.items, `${vPath}.items`, (item, itemPath) => {
          requireText(item.label, `${itemPath}.label`);
          requireText(item.value, `${itemPath}.value`);
          requireText(item.note, `${itemPath}.note`);
        }, 1);
        break;
      case "flow":
        requireItems(visual.items, `${vPath}.items`, labelDetail, 1);
        break;
      case "comparison":
        requireItems(visual.items, `${vPath}.items`, (item, itemPath) => {
          requireText(item.label, `${itemPath}.label`);
          if (typeof item.value !== "number" || !Number.isFinite(item.value)) {
            issues.push(`${itemPath}.value: sonlu sayı gerekli`);
          } else if (!metricValues.some((value) => Math.abs(value - item.value) < 1e-9)) {
            issues.push(`${itemPath}.value: ${item.value} evidence.metrics içinde yok`);
          }
          requireText(item.displayValue, `${itemPath}.displayValue`);
          if (typeof item.highlight !== "boolean") issues.push(`${itemPath}.highlight: boolean gerekli`);
        }, 1);
        break;
      case "concept":
        requireText(visual.center, `${vPath}.center`);
        requireItems(visual.items, `${vPath}.items`, labelDetail, 1);
        break;
      case "layers":
        requireItems(visual.items, `${vPath}.items`, (item, itemPath) => {
          labelDetail(item, itemPath);
          requireEnum(item.tone, `${itemPath}.tone`, TONES);
        }, 1);
        break;
      case "quote":
        requireText(visual.quote, `${vPath}.quote`);
        requireText(visual.attribution, `${vPath}.attribution`);
        break;
      case "architecture": {
        const nodeIds = [];
        requireItems(visual.nodes, `${vPath}.nodes`, (node, nodePath) => {
          requireText(node.id, `${nodePath}.id`);
          requireText(node.label, `${nodePath}.label`);
          requireText(node.detail, `${nodePath}.detail`);
          requireEnum(node.group, `${nodePath}.group`, NODE_GROUPS);
          if (text(node.id)) nodeIds.push(node.id);
        }, 3, 8);
        if (!unique(nodeIds)) issues.push(`${vPath}.nodes: node id değerleri benzersiz olmalı`);
        requireItems(visual.edges, `${vPath}.edges`, (edge, edgePath) => {
          if (!nodeIds.includes(edge.from)) issues.push(`${edgePath}.from: bilinmeyen node`);
          if (!nodeIds.includes(edge.to)) issues.push(`${edgePath}.to: bilinmeyen node`);
          requireText(edge.label, `${edgePath}.label`);
        }, 2, 12);
        break;
      }
      case "equation":
        requireText(visual.formula, `${vPath}.formula`);
        requireItems(visual.terms, `${vPath}.terms`, (term, termPath) => {
          requireText(term.symbol, `${termPath}.symbol`);
          requireText(term.label, `${termPath}.label`);
          requireText(term.detail, `${termPath}.detail`);
        }, 2, 7);
        requireStrings(visual.steps, `${vPath}.steps`, 2, 5);
        break;
      case "timeline":
        requireItems(visual.items, `${vPath}.items`, (item, itemPath) => {
          labelDetail(item, itemPath);
          requireEnum(item.tone, `${itemPath}.tone`, TONES);
        }, 3, 7);
        break;
      case "matrix": {
        const columns = requireArray(visual.columns, `${vPath}.columns`, 2, 5);
        requireStrings(visual.columns, `${vPath}.columns`, 2, 5);
        requireItems(visual.rows, `${vPath}.rows`, (row, rowPath) => {
          requireText(row.label, `${rowPath}.label`);
          requireItems(row.cells, `${rowPath}.cells`, (cell, cellPath) => {
            requireText(cell.label, `${cellPath}.label`);
            requireEnum(cell.tone, `${cellPath}.tone`, CELL_TONES);
          }, 2, 5);
          if (Array.isArray(row.cells) && row.cells.length !== columns.length) {
            issues.push(`${rowPath}.cells: sütun sayısıyla eşleşmiyor (${row.cells.length} ≠ ${columns.length})`);
          }
        }, 2, 6);
        break;
      }
      case "infographic":
        requireItems(visual.items, `${vPath}.items`, (item, itemPath) => {
          labelDetail(item, itemPath);
          requireText(item.badge, `${itemPath}.badge`);
        }, 3, 6);
        break;
      default:
        break;
    }
  });
  const linkedStoryKinds = new Set(
    sections.flatMap((section) => array(section?.claimIds))
      .map((id) => claims.find((claim) => claim?.id === id)?.kind)
      .filter(Boolean),
  );
  if (!linkedStoryKinds.has("method")) issues.push("story.sections: en az bir yöntem claim’ine bağlanmalı");
  if (!linkedStoryKinds.has("limitation")) issues.push("story.sections: en az bir sınırlılık claim’ine bağlanmalı");
  if (visualTypes.size < 3) issues.push("story.sections: en az 3 farklı görsel türü gerekli");
  if (![...visualTypes].some((type) => ADVANCED_VISUALS.has(type))) issues.push("story.sections: gelişmiş görsel türü gerekli");
  requireText(story?.closing?.title, "story.closing.title");
  requireText(story?.closing?.body, "story.closing.body");

  if (project?.deepReport !== undefined) {
    const report = project.deepReport;
    ["title", "dek", "readingTime"].forEach((key) => requireText(report?.[key], `deepReport.${key}`));
    const targetReport = project?.depth === "concise" ? 6 : project?.depth === "deep" ? 9 : 7;
    const reportSections = requireArray(report?.sections, "deepReport.sections", 6, 9);
    if (reportSections.length !== targetReport) issues.push(`deepReport.sections: tam ${targetReport} bölüm gerekli (bulunan ${reportSections.length})`);
    const reportIdValues = reportSections.map((section) => section?.id).filter(text);
    if (!unique(reportIdValues)) issues.push("deepReport.sections: section id değerleri benzersiz olmalı");
    REPORT_KINDS.forEach((kind) => {
      if (!reportSections.some((section) => section?.kind === kind)) issues.push(`deepReport.sections: ${kind} bölümü gerekli`);
    });
    requireItems(report?.sections, "deepReport.sections", (section, path) => {
      requireText(section.id, `${path}.id`);
      requireEnum(section.kind, `${path}.kind`, REPORT_KINDS);
      requireText(section.title, `${path}.title`);
      requireText(section.summary, `${path}.summary`);
      requireStrings(section.analysis, `${path}.analysis`, 2, 5);
      requireArray(section.claimIds, `${path}.claimIds`, 1).forEach((id) => {
        if (!claimIds.includes(id)) issues.push(`${path}.claimIds: bilinmeyen ${id}`);
      });
    }, 6, 9);
    requireStrings(report?.openQuestions, "deepReport.openQuestions", 3, 8);
  }

  if (project?.technicalAppendix !== undefined) {
    const appendix = project.technicalAppendix;
    requireText(appendix?.title, "technicalAppendix.title");
    requireText(appendix?.overview, "technicalAppendix.overview");
    const requireClaimLinks = (item, path) => {
      requireArray(item.claimIds, `${path}.claimIds`, 1).forEach((id) => {
        if (!claimIds.includes(id)) issues.push(`${path}.claimIds: bilinmeyen ${id}`);
      });
    };
    requireItems(appendix?.equations, "technicalAppendix.equations", (item, path) => {
      requireText(item.id, `${path}.id`);
      requireText(item.label, `${path}.label`);
      requireText(item.expression, `${path}.expression`);
      requireText(item.explanation, `${path}.explanation`);
      requireItems(item.variables, `${path}.variables`, (variable, variablePath) => {
        requireText(variable.symbol, `${variablePath}.symbol`);
        requireText(variable.meaning, `${variablePath}.meaning`);
      }, 0, 10);
      requireClaimLinks(item, path);
    }, 0, 8);
    const equationIdValues = array(appendix?.equations).map((item) => item?.id).filter(text);
    if (!unique(equationIdValues)) issues.push("technicalAppendix.equations: equation id değerleri benzersiz olmalı");
    requireItems(appendix?.algorithmSteps, "technicalAppendix.algorithmSteps", (item, path) => {
      requireText(item.label, `${path}.label`);
      requireText(item.detail, `${path}.detail`);
      requireClaimLinks(item, path);
    }, 2, 10);
    requireItems(appendix?.codeSketches, "technicalAppendix.codeSketches", (item, path) => {
      requireText(item.title, `${path}.title`);
      requireText(item.language, `${path}.language`);
      requireText(item.code, `${path}.code`);
      requireText(item.explanation, `${path}.explanation`);
      requireClaimLinks(item, path);
    }, 0, 3);
    requireItems(appendix?.complexity, "technicalAppendix.complexity", (item, path) => {
      requireText(item.operation, `${path}.operation`);
      requireText(item.cost, `${path}.cost`);
      requireText(item.context, `${path}.context`);
      requireClaimLinks(item, path);
    }, 0, 6);
    const linked = [
      ...array(appendix?.equations),
      ...array(appendix?.algorithmSteps),
      ...array(appendix?.codeSketches),
      ...array(appendix?.complexity),
    ];
    if (!linked.length) issues.push("technicalAppendix: en az bir kanıta bağlı teknik öğe gerekli");
    requireStrings(appendix?.implementationNotes, "technicalAppendix.implementationNotes", 2, 10);
  }

  if (project?.generation !== undefined) {
    requireText(project.generation?.provider, "generation.provider");
    requireText(project.generation?.model, "generation.model");
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
