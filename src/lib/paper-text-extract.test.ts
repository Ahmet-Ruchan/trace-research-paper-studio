import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { extractPaperPages, PaperTextError } from "./server/paper-text-extract";

/** Elle kurulmuş, tek sayfalık geçerli bir PDF; `xref` konumları hesaplanıyor. */
function tinyPdf(lines: string[]) {
  // Her satır ayrı yazılıyor: tek bir uzun satır sayfanın dışına taşar ve çıkarılmaz.
  const stream = `BT /F1 10 Tf 12 TL 72 760 Td ${lines.map((line) => `(${line}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([body], "tiny.pdf", { type: "application/pdf" });
}

const hasPdftotext = !spawnSync("pdftotext", ["-v"]).error;

describe.skipIf(!hasPdftotext)("extractPaperPages", () => {
  it("neredeyse hiç metni olmayan PDF'i tarama sayar ve ne yapılacağını söyler", async () => {
    const attempt = extractPaperPages(tinyPdf(["Only a few words."]));
    await expect(attempt).rejects.toBeInstanceOf(PaperTextError);
    await expect(attempt).rejects.toThrow(/probably a scan/);
  });

  it("sayfa metnini çıkarır", async () => {
    const sentence = "The Transformer relies entirely on attention.";
    const pages = await extractPaperPages(tinyPdf(Array.from({ length: 50 }, () => sentence)));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("The Transformer relies entirely on attention.");
  });
});
