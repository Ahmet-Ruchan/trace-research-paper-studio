import { renderToMathML } from "../../visuals/mathml";
import type { ResearchProject } from "../schema";
import { reportDocument, type ReportBlock } from "./report-document";

/**
 * Yazdırılabilir rapor — PDF'e giden yol.
 *
 * Ayrı bir PDF motoru yok: bu, tarayıcının "PDF olarak kaydet"i için
 * düzenlenmiş tek dosyalık bir HTML. Betik yok, dış kaynak yok; proje metni
 * kaçırılarak yazılıyor, çünkü içe aktarılmış bir `.trace.json` güvenilmez girdi.
 */

export const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function render(block: ReportBlock): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    case "paragraph":
      return `<p>${escapeHtml(block.text)}</p>`;
    case "note":
      return `<p class="note">${escapeHtml(block.text)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
    }
    case "quote":
      return `<blockquote>“${escapeHtml(block.text)}” <cite>${escapeHtml(block.cite)}</cite></blockquote>`;
    case "math":
      return `<div class="math">${renderToMathML(block.latex, true) ?? `<code>${escapeHtml(block.latex)}</code>`}</div>`;
    case "code":
      return `<pre><code>${escapeHtml(block.code)}</code></pre>`;
    case "table":
      return `<table><thead><tr>${block.head.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead><tbody>${block.rows
        .map((row) => `<tr>${row.map((item) => `<td>${escapeHtml(item)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
  }
}

const STYLE = `
  @page { size: A4; margin: 22mm 20mm; }
  body { max-width: 760px; margin: 40px auto; padding: 0 24px; color: #191b18; font: 11.5pt/1.6 Georgia, "Times New Roman", serif; }
  h1 { font-size: 24pt; line-height: 1.15; margin: 0 0 8pt; font-weight: 400; }
  h2 { font-size: 15pt; margin: 26pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #beb9af; font-weight: 400; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 16pt 0 4pt; font-family: Helvetica, Arial, sans-serif; break-after: avoid; }
  p { margin: 0 0 8pt; }
  .note { color: #5d625a; font: 9pt/1.5 Helvetica, Arial, sans-serif; }
  blockquote { margin: 4pt 0 8pt; padding-left: 10pt; border-left: 2px solid #e75b37; color: #3b3f39; font-size: 10.5pt; break-inside: avoid; }
  cite { color: #5d625a; font: normal 9pt Helvetica, Arial, sans-serif; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font: 9.5pt/1.45 Helvetica, Arial, sans-serif; }
  th, td { padding: 5pt 6pt; border-bottom: 1px solid #ddd8cd; text-align: left; vertical-align: top; }
  pre { padding: 8pt; background: #f2efe7; font-size: 9pt; white-space: pre-wrap; break-inside: avoid; }
  .math { margin: 8pt 0; text-align: center; overflow-x: auto; }
  .print-hint { margin-bottom: 24pt; padding: 8pt 10pt; background: #f2efe7; font: 9.5pt/1.5 Helvetica, Arial, sans-serif; }
  @media print { body { margin: 0; max-width: none; padding: 0; } .print-hint { display: none; } }
`;

export function buildPrintableReport(project: ResearchProject): string {
  const title = escapeHtml(project.evidence.paper.title);
  return `<!doctype html>
<html lang="${escapeHtml(project.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Trace report</title>
<style>${STYLE}</style>
</head>
<body>
<p class="print-hint" lang="en">To save this as a PDF, print the page (Ctrl/Cmd + P) and choose “Save as PDF”. This note is not printed.</p>
${reportDocument(project).map(render).join("\n")}
</body>
</html>
`;
}
