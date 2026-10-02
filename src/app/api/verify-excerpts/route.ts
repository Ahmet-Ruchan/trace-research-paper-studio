import { applyExcerptCheck } from "@/lib/paper-text";
import { paperEvidenceSchema } from "@/lib/schema";
import { extractPaperPages, PaperTextError } from "@/lib/server/paper-text-extract";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PDF_BYTES = 35 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

/**
 * Var olan bir projenin alıntılarını PDF'in sayfa metnine karşı denetler.
 *
 * İçe aktarılan ya da bir ajanın ürettiği projede PDF yok; kullanıcı onu
 * burada verir. Model çağrısı yok: `pdftotext` sayfaları çıkarır, her alıntı
 * atıf yaptığı sayfada aranır. PDF saklanmaz — geçici dizin iş bitince silinir.
 *
 * Yanlış PDF verilirse hiçbir alıntı bulunmaz ve her iddia düşürülürdü; bu
 * yüzden neredeyse hiçbir şey eşleşmiyorsa sonuç UYGULANMAZ, reddedilir.
 */
export async function POST(request: Request) {
  const t = serverText(request);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: t.request.formDataUnreadable }, { status: 400 });
  }
  const file = form.get("paper");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return Response.json({ error: t.excerpts.pdfRequired }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) return Response.json({ error: t.request.pdfTooLarge }, { status: 413 });

  const rawEvidence = String(form.get("evidence") ?? "");
  if (!rawEvidence || rawEvidence.length > MAX_EVIDENCE_BYTES) {
    return Response.json({ error: t.excerpts.evidenceMissing }, { status: 400 });
  }
  let evidence;
  try {
    evidence = paperEvidenceSchema.parse(JSON.parse(rawEvidence));
  } catch {
    return Response.json({ error: t.excerpts.evidenceInvalid }, { status: 400 });
  }

  try {
    const pages = await extractPaperPages(file, request.signal);
    const result = applyExcerptCheck({ evidence }, pages);
    const check = result.project.excerptCheck;
    if (check.checked >= 5 && check.unlocated.length / check.checked > 0.8) {
      return Response.json(
        { error: t.excerpts.wrongPdf(check.checked - check.unlocated.length, check.checked) },
        { status: 422 },
      );
    }
    return Response.json(
      { excerptCheck: check, downgradedIds: result.downgradedIds },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PaperTextError) return Response.json({ error: errorMessage(error, t.errors, t.excerpts.checkFailed) }, { status: 422 });
    return Response.json({ error: t.excerpts.checkFailed }, { status: 500 });
  }
}
