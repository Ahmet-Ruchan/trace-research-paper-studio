import type { ResearchProject } from "../schema";
import { reportDocument, type ReportBlock } from "./report-document";

/**
 * Markdown rapor. Obsidian, Notion ve GitHub'ın hepsi bunu olduğu gibi içe
 * aktarıyor; o yüzden lehçeye özgü hiçbir şey yok — yalnızca başlık, liste,
 * alıntı, tablo ve `$$` matematik bloğu.
 */

// Yalnızca satırın anlamını değiştirecek karakterler kaçırılıyor; her şeyi kaçırmak okunmaz bir dosya üretir.
const inline = (text: string) => text.replace(/\r?\n+/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1").replace(/^(\s*)([#>+-]|\d+\.)(\s)/, "$1\\$2$3");

const cell = (text: string) => inline(text).replace(/\s+/g, " ");

function render(block: ReportBlock): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${inline(block.text)}`;
    case "paragraph":
      return inline(block.text);
    case "note":
      return `*${inline(block.text)}*`;
    case "list":
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${inline(item)}`).join("\n");
    case "quote":
      return `> “${inline(block.text)}” — ${inline(block.cite)}`;
    case "math":
      return `$$\n${block.latex.trim()}\n$$`;
    case "code":
      // İçerikte üç ters tırnak varsa çit bir uzun tutulur; blok erken kapanmasın.
      return `${"`".repeat(block.code.includes("```") ? 4 : 3)}${block.language}\n${block.code}\n${"`".repeat(block.code.includes("```") ? 4 : 3)}`;
    case "table":
      return [`| ${block.head.map(cell).join(" | ")} |`, `| ${block.head.map(() => "---").join(" | ")} |`, ...block.rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");
  }
}

export function buildMarkdownReport(project: ResearchProject): string {
  return `${reportDocument(project).map(render).join("\n\n")}\n`;
}
