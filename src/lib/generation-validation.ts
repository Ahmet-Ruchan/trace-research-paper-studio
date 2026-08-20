import { ZodError } from "zod";
import { LEARNING_REQUIREMENTS } from "./schema";
import type {
  DeepReport,
  PaperEvidence,
  ResearchProject,
  SourceReference,
  StorySpec,
  TechnicalAppendix,
} from "./schema";
import { FormulaError, collectParams, evaluateNode, parseFormula } from "./formula";

export class IntegrityError extends Error {
  readonly issues: string[];

  constructor(stage: string, issues: string[]) {
    super(`${stage} bütünlük denetimi başarısız: ${issues.join("; ")}`);
    this.name = "IntegrityError";
    this.issues = issues;
  }
}

function duplicates(values: string[]) {
  const seen = new Set<string>();
  return [...new Set(values.filter((value) => (seen.has(value) ? true : !seen.add(value))))];
}

function checkReference(
  reference: SourceReference,
  owner: string,
  sourceIds: Set<string>,
  issues: string[],
) {
  if (!sourceIds.has(reference.sourceId)) {
    issues.push(`${owner} bilinmeyen kaynak kullanıyor: ${reference.sourceId}`);
  }
  if (!reference.excerpt.trim()) issues.push(`${owner} için doğrulanabilir excerpt eksik`);
  if (reference.sourceId === "paper" && !reference.page) {
    issues.push(`${owner} için PDF sayfası eksik`);
  }
}

export function validateEvidenceIntegrity(evidence: PaperEvidence) {
  const issues: string[] = [];
  const sourceIds = new Set(evidence.sources.map((source) => source.id));
  const duplicateSources = duplicates(evidence.sources.map((source) => source.id));
  const duplicateClaims = duplicates(evidence.claims.map((claim) => claim.id));
  const duplicateMetrics = duplicates(evidence.metrics.map((metric) => metric.id));

  if (!sourceIds.has("paper")) issues.push('Ana PDF kaynağı "paper" eksik');
  if (duplicateSources.length) issues.push(`Tekrarlanan source ID: ${duplicateSources.join(", ")}`);
  if (duplicateClaims.length) issues.push(`Tekrarlanan claim ID: ${duplicateClaims.join(", ")}`);
  if (duplicateMetrics.length) issues.push(`Tekrarlanan metric ID: ${duplicateMetrics.join(", ")}`);

  evidence.claims.forEach((claim) => {
    claim.sourceRefs.forEach((reference) =>
      checkReference(reference, `Claim ${claim.id}`, sourceIds, issues),
    );
    if (claim.confidence === "verified" && claim.sourceRefs.every((reference) => !reference.excerpt.trim())) {
      issues.push(`Verified claim ${claim.id} için doğrulanabilir excerpt eksik`);
    }
  });
  evidence.metrics.forEach((metric) =>
    checkReference(metric.sourceRef, `Metric ${metric.id}`, sourceIds, issues),
  );
  evidence.glossary.forEach((item) => {
    if (item.sourceRef) checkReference(item.sourceRef, `Terim ${item.term}`, sourceIds, issues);
  });

  if (!evidence.claims.some((claim) => claim.kind === "method")) {
    issues.push("En az bir yöntem claim’i gerekli");
  }
  if (!evidence.claims.some((claim) => claim.kind === "limitation")) {
    issues.push("En az bir sınırlılık claim’i gerekli");
  }
  if (!evidence.claims.some((claim) => claim.confidence === "verified")) {
    issues.push("En az bir doğrudan doğrulanmış claim gerekli");
  }

  if (issues.length) throw new IntegrityError("Evidence", issues);
}

export function validateStoryIntegrity(
  story: StorySpec,
  evidence: PaperEvidence,
  expectedSectionCount: number,
) {
  const issues: string[] = [];
  const claims = new Map(evidence.claims.map((claim) => [claim.id, claim]));
  const metricValues = evidence.metrics.map((metric) => metric.value);
  const duplicateSections = duplicates(story.sections.map((section) => section.id));

  if (story.sections.length !== expectedSectionCount) {
    issues.push(`${expectedSectionCount} yerine ${story.sections.length} bölüm üretildi`);
  }
  if (duplicateSections.length) issues.push(`Tekrarlanan section ID: ${duplicateSections.join(", ")}`);

  story.sections.forEach((section, index) => {
    const expectedIndex = String(index + 1).padStart(2, "0");
    if (section.indexLabel !== expectedIndex) {
      issues.push(`${section.id} indexLabel değeri ${expectedIndex} olmalı`);
    }
    section.claimIds.forEach((claimId) => {
      if (!claims.has(claimId)) issues.push(`${section.id} bilinmeyen claim kullanıyor: ${claimId}`);
    });
    if (section.visual.type === "comparison") {
      section.visual.items.forEach((item) => {
        const exists = metricValues.some((value) => Math.abs(value - item.value) < 1e-9);
        if (!exists) issues.push(`${section.id} görselindeki ${item.value} evidence metrics içinde yok`);
      });
    }
    if (section.visual.type === "architecture") {
      const nodeIds = new Set(section.visual.nodes.map((node) => node.id));
      section.visual.edges.forEach((edge) => {
        if (!nodeIds.has(edge.from)) issues.push(`${section.id} bilinmeyen edge başlangıcı: ${edge.from}`);
        if (!nodeIds.has(edge.to)) issues.push(`${section.id} bilinmeyen edge bitişi: ${edge.to}`);
      });
    }
    if (section.visual.type === "matrix") {
      const matrix = section.visual;
      matrix.rows.forEach((row) => {
        if (row.cells.length !== matrix.columns.length) {
          issues.push(`${section.id} matrix satırı sütun sayısıyla eşleşmiyor: ${row.label}`);
        }
      });
    }
  });

  const visualTypes = new Set(story.sections.map((section) => section.visual.type));
  const advancedVisuals = new Set(["architecture", "equation", "timeline", "matrix", "infographic"]);
  if (visualTypes.size < 3) issues.push("Story en az üç farklı görsel gramer kullanmalı");
  if (![...visualTypes].some((type) => advancedVisuals.has(type))) {
    issues.push("Story en az bir gelişmiş mimari, denklem, timeline, matrix veya infographic görseli içermeli");
  }

  const linkedClaims = story.sections.flatMap((section) =>
    section.claimIds.map((claimId) => claims.get(claimId)).filter(Boolean),
  );
  if (!linkedClaims.some((claim) => claim?.kind === "method")) {
    issues.push("Story bir yöntem claim’ine bağlanmalı");
  }
  if (!linkedClaims.some((claim) => claim?.kind === "limitation")) {
    issues.push("Story bir sınırlılık claim’ine bağlanmalı");
  }

  if (issues.length) throw new IntegrityError("Story", issues);
}

export function validateDeepReportIntegrity(
  report: DeepReport,
  evidence: PaperEvidence,
  expectedSectionCount: number,
) {
  const issues: string[] = [];
  const claimIds = new Set(evidence.claims.map((claim) => claim.id));
  const duplicateSections = duplicates(report.sections.map((section) => section.id));
  if (report.sections.length !== expectedSectionCount) {
    issues.push(`${expectedSectionCount} yerine ${report.sections.length} rapor bölümü üretildi`);
  }
  if (duplicateSections.length) issues.push(`Tekrarlanan report ID: ${duplicateSections.join(", ")}`);
  report.sections.forEach((section) => section.claimIds.forEach((claimId) => {
    if (!claimIds.has(claimId)) issues.push(`${section.id} bilinmeyen claim kullanıyor: ${claimId}`);
  }));
  const kinds = new Set(report.sections.map((section) => section.kind));
  ["contribution", "mechanism", "experiment", "critique", "reproduction", "implication"].forEach((kind) => {
    if (!kinds.has(kind as DeepReport["sections"][number]["kind"])) issues.push(`Report ${kind} bölümü içermeli`);
  });
  if (issues.length) throw new IntegrityError("DeepReport", issues);
}

export function validateTechnicalAppendixIntegrity(
  appendix: TechnicalAppendix,
  evidence: PaperEvidence,
) {
  const issues: string[] = [];
  const claimIds = new Set(evidence.claims.map((claim) => claim.id));
  const linkedItems = [
    ...appendix.equations,
    ...appendix.algorithmSteps,
    ...appendix.codeSketches,
    ...appendix.complexity,
  ];
  linkedItems.forEach((item, index) => item.claimIds.forEach((claimId) => {
    if (!claimIds.has(claimId)) issues.push(`Technical item ${index + 1} bilinmeyen claim kullanıyor: ${claimId}`);
  }));
  const duplicateEquations = duplicates(appendix.equations.map((equation) => equation.id));
  if (duplicateEquations.length) issues.push(`Tekrarlanan equation ID: ${duplicateEquations.join(", ")}`);
  if (!linkedItems.length) issues.push("Technical appendix en az bir kanıta bağlı teknik öğe içermeli");
  if (issues.length) throw new IntegrityError("TechnicalAppendix", issues);
}

/**
 * Öğrenme katmanının bütünlüğü.
 *
 * İki iş yapar: (1) `depth` için zorunlu blokların var olduğunu doğrular,
 * (2) her bloğun kendi içinde tutarlı ve ÇALIŞIR olduğunu denetler. İkincisi
 * özellikle interaktifler için kritik: bir formül ayrıştırılamıyorsa veya
 * bildirilmeyen bir parametreye atıfta bulunuyorsa, oynatıcı çalışma anında
 * kırılır. Bunu üretim anında yakalamak, kullanıcıya bozuk bir kaydırma
 * çubuğu göstermekten iyidir.
 */
export function validateLearningIntegrity(
  project: ResearchProject,
  options: { requireDepthBlocks?: boolean } = {},
) {
  const issues: string[] = [];
  const claimIds = new Set(project.evidence.claims.map((claim) => claim.id));
  const sourceIds = new Set(project.evidence.sources.map((source) => source.id));

  const checkClaims = (ids: readonly string[], owner: string) => {
    ids.forEach((id) => {
      if (!claimIds.has(id)) issues.push(`${owner}: bilinmeyen claim ${id}`);
    });
  };

  // Derinlik zorunluluğu yalnızca ÜRETİMDE geçerlidir. İçe aktarmada
  // uygulanırsa öğrenme katmanından önce üretilmiş projeler kütüphaneye
  // alınamaz; mevcut çalışmayı bozmamak için varsayılan kapalı.
  if (options.requireDepthBlocks) {
    for (const block of LEARNING_REQUIREMENTS[project.depth]) {
      const value = project[block as keyof ResearchProject];
      const missing = value === undefined || (Array.isArray(value) && value.length === 0);
      if (missing) issues.push(`${block}: "${project.depth}" derinliğinde zorunlu`);
    }
  }

  if (project.primer) {
    const conceptIds = project.primer.concepts.map((concept) => concept.id);
    const duplicateConcepts = duplicates(conceptIds);
    if (duplicateConcepts.length) issues.push(`primer: tekrarlanan kavram ID ${duplicateConcepts.join(", ")}`);
    const known = new Set(conceptIds);
    project.primer.concepts.forEach((concept) => {
      concept.prerequisiteIds.forEach((id) => {
        if (id === concept.id) issues.push(`primer.${concept.id}: kendini ön koşul gösteremez`);
        else if (!known.has(id)) issues.push(`primer.${concept.id}: bilinmeyen ön koşul ${id}`);
      });
      checkClaims(concept.claimIds, `primer.${concept.id}`);
    });
  }

  if (project.derivations) {
    const duplicateDerivations = duplicates(project.derivations.map((item) => item.id));
    if (duplicateDerivations.length) issues.push(`derivations: tekrarlanan ID ${duplicateDerivations.join(", ")}`);
    const equationIds = new Set((project.technicalAppendix?.equations ?? []).map((item) => item.id));
    project.derivations.forEach((derivation) => {
      if (derivation.equationId && !equationIds.has(derivation.equationId)) {
        issues.push(`derivations.${derivation.id}: bilinmeyen equationId ${derivation.equationId}`);
      }
      const duplicateSteps = duplicates(derivation.steps.map((step) => step.id));
      if (duplicateSteps.length) issues.push(`derivations.${derivation.id}: tekrarlanan adım ID ${duplicateSteps.join(", ")}`);
      checkClaims(derivation.claimIds, `derivations.${derivation.id}`);
    });
  }

  if (project.quiz) {
    const duplicateQuestions = duplicates(project.quiz.questions.map((question) => question.id));
    if (duplicateQuestions.length) issues.push(`quiz: tekrarlanan soru ID ${duplicateQuestions.join(", ")}`);
    project.quiz.questions.forEach((question) => {
      const correct = question.options.filter((option) => option.correct).length;
      if (correct === 0) issues.push(`quiz.${question.id}: doğru şık yok`);
      if (question.kind !== "multi" && correct !== 1) {
        issues.push(`quiz.${question.id}: "${question.kind}" sorusunda tam olarak bir doğru şık olmalı (bulunan ${correct})`);
      }
      if (question.kind === "multi" && correct < 2) {
        issues.push(`quiz.${question.id}: "multi" sorusunda en az iki doğru şık olmalı`);
      }
      if (question.kind === "true-false" && question.options.length !== 2) {
        issues.push(`quiz.${question.id}: doğru-yanlış sorusu tam iki şık içermeli`);
      }
      checkClaims(question.claimIds, `quiz.${question.id}`);
    });
  }

  if (project.interactives) {
    const duplicateInteractives = duplicates(project.interactives.map((item) => item.id));
    if (duplicateInteractives.length) issues.push(`interactives: tekrarlanan ID ${duplicateInteractives.join(", ")}`);

    project.interactives.forEach((interactive) => {
      const owner = `interactives.${interactive.id}`;
      checkClaims(interactive.claimIds, owner);

      if (interactive.kind === "formula-playground") {
        const names = interactive.parameters.map((parameter) => parameter.name);
        const duplicateParams = duplicates(names);
        if (duplicateParams.length) issues.push(`${owner}: tekrarlanan parametre ${duplicateParams.join(", ")}`);
        const declared = new Set(names);

        interactive.parameters.forEach((parameter) => {
          if (!(parameter.min < parameter.max)) {
            issues.push(`${owner}.${parameter.name}: min < max olmalı`);
          }
          if (parameter.paperValue < parameter.min || parameter.paperValue > parameter.max) {
            issues.push(`${owner}.${parameter.name}: makale değeri (${parameter.paperValue}) aralık dışında`);
          }
          if (parameter.step > parameter.max - parameter.min) {
            issues.push(`${owner}.${parameter.name}: adım aralıktan büyük`);
          }
        });

        const paperPoint: Record<string, number> = {};
        interactive.parameters.forEach((parameter) => {
          paperPoint[parameter.name] = parameter.paperValue;
        });

        const outputIds = new Set<string>();
        interactive.outputs.forEach((output) => {
          if (outputIds.has(output.id)) issues.push(`${owner}: tekrarlanan çıktı ID ${output.id}`);
          outputIds.add(output.id);
          try {
            const ast = parseFormula(output.formula);
            collectParams(ast).forEach((name) => {
              if (!declared.has(name)) {
                issues.push(`${owner}.${output.id}: formül bildirilmemiş parametre kullanıyor: ${name}`);
              }
            });
            // Makalenin kendi noktasında sonlu bir değer üretmeyen formül,
            // kullanıcı hiçbir şeye dokunmadan bozuk görünür.
            const atPaperValue = evaluateNode(ast, paperPoint);
            if (!Number.isFinite(atPaperValue)) {
              issues.push(`${owner}.${output.id}: makale değerlerinde sonlu sonuç üretmiyor`);
            }
          } catch (error) {
            const detail = error instanceof FormulaError ? error.message : String(error);
            issues.push(`${owner}.${output.id}: formül geçersiz — ${detail}`);
          }
        });

        if (interactive.chart) {
          if (!declared.has(interactive.chart.xParam)) {
            issues.push(`${owner}.chart: xParam bildirilmemiş parametre (${interactive.chart.xParam})`);
          }
          interactive.chart.series.forEach((series) => {
            if (!outputIds.has(series.outputId)) {
              issues.push(`${owner}.chart: bilinmeyen çıktı ${series.outputId}`);
            }
          });
        }
      }

      if (interactive.kind === "mechanism-simulation") {
        const nodeIds = new Set(interactive.stageNodes.map((node) => node.id));
        const duplicateNodes = duplicates(interactive.stageNodes.map((node) => node.id));
        if (duplicateNodes.length) issues.push(`${owner}: tekrarlanan düğüm ID ${duplicateNodes.join(", ")}`);
        interactive.frames.forEach((frame, index) => {
          frame.activeNodeIds.forEach((id) => {
            if (!nodeIds.has(id)) issues.push(`${owner}.frames[${index}]: bilinmeyen düğüm ${id}`);
          });
          if (frame.grid) {
            const { rowLabels, columnLabels, values } = frame.grid;
            if (values.length !== rowLabels.length) {
              issues.push(`${owner}.frames[${index}].grid: satır sayısı etiketlerle eşleşmiyor`);
            }
            values.forEach((row, rowIndex) => {
              if (row.length !== columnLabels.length) {
                issues.push(`${owner}.frames[${index}].grid: ${rowIndex}. satır sütun sayısıyla eşleşmiyor`);
              }
              row.forEach((cell) => {
                if (!Number.isFinite(cell)) {
                  issues.push(`${owner}.frames[${index}].grid: sonlu olmayan hücre değeri`);
                }
              });
            });
          }
        });
      }

      if (interactive.kind === "dataset-explorer") {
        const columnIds = interactive.columns.map((column) => column.id);
        const duplicateColumns = duplicates(columnIds);
        if (duplicateColumns.length) issues.push(`${owner}: tekrarlanan sütun ID ${duplicateColumns.join(", ")}`);
        interactive.rows.forEach((row, index) => {
          if (row.cells.length !== interactive.columns.length) {
            issues.push(`${owner}.rows[${index}]: hücre sayısı sütun sayısıyla eşleşmiyor`);
            return;
          }
          interactive.columns.forEach((column, columnIndex) => {
            const cell = row.cells[columnIndex];
            if (column.type === "number" && (typeof cell !== "number" || !Number.isFinite(cell))) {
              issues.push(`${owner}.rows[${index}].${column.id}: sayısal sütun sayı olmayan değer içeriyor`);
            }
          });
        });
        if (interactive.defaultSort && !columnIds.includes(interactive.defaultSort.columnId)) {
          issues.push(`${owner}.defaultSort: bilinmeyen sütun ${interactive.defaultSort.columnId}`);
        }
        checkReference(interactive.sourceRef, `${owner}.sourceRef`, sourceIds, issues);
      }
    });
  }

  if (project.applicationGuide) {
    const guide = project.applicationGuide;
    guide.recipe.forEach((item, index) => checkClaims(item.claimIds, `applicationGuide.recipe[${index}]`));
    guide.hyperparameters.forEach((item) => checkClaims(item.claimIds, `applicationGuide.${item.name}`));
    guide.pitfalls.forEach((item, index) => checkClaims(item.claimIds, `applicationGuide.pitfalls[${index}]`));
  }

  if (issues.length) throw new IntegrityError("Learning", issues);
}

export function describeValidationError(error: unknown) {
  if (error instanceof IntegrityError) return error.issues;
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
  }
  return [error instanceof Error ? error.message : "Bilinmeyen doğrulama hatası"];
}
