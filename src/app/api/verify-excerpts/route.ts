import { applyExcerptCheck } from "@/lib/paper-text";
import { paperEvidenceSchema } from "@/lib/schema";
import { extractPaperPages, PaperTextError } from "@/lib/server/paper-text-extract";

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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "The submitted form data could not be read." }, { status: 400 });
  }
  const file = form.get("paper");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return Response.json({ error: "Upload the paper's PDF." }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) return Response.json({ error: "The PDF exceeds the 35 MB limit." }, { status: 413 });

  const rawEvidence = String(form.get("evidence") ?? "");
  if (!rawEvidence || rawEvidence.length > MAX_EVIDENCE_BYTES) {
    return Response.json({ error: "The project's evidence is missing or too large." }, { status: 400 });
  }
  let evidence;
  try {
    evidence = paperEvidenceSchema.parse(JSON.parse(rawEvidence));
  } catch {
    return Response.json({ error: "The project's evidence is not valid." }, { status: 400 });
  }

  try {
    const pages = await extractPaperPages(file, request.signal);
    const result = applyExcerptCheck({ evidence }, pages);
    const check = result.project.excerptCheck;
    if (check.checked >= 5 && check.unlocated.length / check.checked > 0.8) {
      return Response.json(
        { error: `Only ${check.checked - check.unlocated.length} of ${check.checked} quotes were found in this PDF. It is probably a different paper or a different version, so nothing was changed.` },
        { status: 422 },
      );
    }
    return Response.json(
      { excerptCheck: check, downgradedIds: result.downgradedIds },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PaperTextError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "The quotes could not be checked." }, { status: 500 });
  }
}
