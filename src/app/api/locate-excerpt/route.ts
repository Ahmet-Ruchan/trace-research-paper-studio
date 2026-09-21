import { locateExcerpt } from "@/lib/server/excerpt-locator";
import { PaperTextError } from "@/lib/server/paper-text-extract";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PDF_BYTES = 35 * 1024 * 1024;

/**
 * Bir alıntıyı sayfasının görüntüsü üzerinde gösterir. Model çağrısı yok;
 * PDF saklanmaz. Alıntı bulunamazsa sayfa yine döner — okuyucu en azından
 * doğru sayfaya bakıyor olur ve alıntının orada OLMADIĞINI kendi gözüyle görür.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "The submitted form data could not be read." }, { status: 400 });
  }
  const file = form.get("paper");
  const page = Number(form.get("page"));
  const excerpt = String(form.get("excerpt") ?? "").slice(0, 4_000);
  if (!(file instanceof File) || file.size > MAX_PDF_BYTES) return Response.json({ error: "Upload the paper's PDF (max. 35 MB)." }, { status: 400 });
  if (!Number.isInteger(page) || page < 1 || page > 5_000 || !excerpt.trim()) {
    return Response.json({ error: "A page number and a quote are required." }, { status: 400 });
  }
  try {
    return Response.json(await locateExcerpt(file, page, excerpt, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaperTextError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "The quote could not be located." }, { status: 500 });
  }
}
