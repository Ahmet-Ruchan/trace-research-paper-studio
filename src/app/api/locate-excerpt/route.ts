import { locateExcerpt } from "@/lib/server/excerpt-locator";
import { PaperTextError } from "@/lib/server/paper-text-extract";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PDF_BYTES = 35 * 1024 * 1024;

/**
 * Bir alıntıyı sayfasının görüntüsü üzerinde gösterir. Model çağrısı yok;
 * PDF saklanmaz. Alıntı bulunamazsa sayfa yine döner — okuyucu en azından
 * doğru sayfaya bakıyor olur ve alıntının orada OLMADIĞINI kendi gözüyle görür.
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
  const page = Number(form.get("page"));
  const excerpt = String(form.get("excerpt") ?? "").slice(0, 4_000);
  if (!(file instanceof File) || file.size > MAX_PDF_BYTES) return Response.json({ error: t.excerpts.pdfWithLimit }, { status: 400 });
  if (!Number.isInteger(page) || page < 1 || page > 5_000 || !excerpt.trim()) {
    return Response.json({ error: t.excerpts.pageAndQuote }, { status: 400 });
  }
  try {
    return Response.json(await locateExcerpt(file, page, excerpt, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaperTextError) return Response.json({ error: errorMessage(error, t.errors, t.excerpts.locateFailed) }, { status: 422 });
    return Response.json({ error: t.excerpts.locateFailed }, { status: 500 });
  }
}
