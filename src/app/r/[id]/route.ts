import { uiLanguageForRequest, type UiLanguage } from "@/i18n/languages";
import { pagesFor } from "@/i18n/messages/pages";
import { PUBLICATION_HEADERS } from "@/lib/publications";
import { readingShareHtml, readingShareState } from "@/lib/reading-share";
import { readReadingShare } from "@/lib/reading-share-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paylaşılan okuma listesinin sayfası. Bulunamayan, yayından kaldırılmış ve
 * süresi dolmuş liste aynı yanıtı alıyor: hangi kimliklerin bir zamanlar var
 * olduğu söylenmiyor.
 *
 * Liste, onu paylaşanın dilinde (kayıttaki `language`; eski kayıtlarda
 * İngilizce). Bulunamadı sayfasının ise kaydı yok: ziyaretçinin dilinde.
 */
function notAvailable(language: UiLanguage) {
  const t = pagesFor(language).notAvailable;
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${t.title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2efe7;color:#191b18;font:16px/1.6 Georgia,serif}main{max-width:32rem;padding:24px}h1{font-weight:500;margin:0 0 8px}p{color:#71766f;margin:0}</style></head><body><main><h1>${t.readingListHeading}</h1><p>${t.readingListBody}</p></main></body></html>`;
  return new Response(html, { status: 404, headers: { ...PUBLICATION_HEADERS, Vary: "Accept-Language, Cookie" } });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const share = await readReadingShare(id).catch(() => undefined);
  if (!share || readingShareState(share, new Date().toISOString()) !== "live") return notAvailable(uiLanguageForRequest(request));
  return new Response(readingShareHtml(share, pagesFor(share.language).readingShare), { status: 200, headers: PUBLICATION_HEADERS });
}
