import { uiLanguageForRequest, type UiLanguage } from "@/i18n/languages";
import { messagesFor } from "@/i18n/messages";
import { pagesFor } from "@/i18n/messages/pages";
import { buildStandaloneStory } from "@/lib/export-story";
import { PUBLICATION_HEADERS, publicationState, withPublishedNotes } from "@/lib/publications";
import { researchProjectSchema } from "@/lib/schema";
import { readPublication } from "@/lib/trace-storage";
import { stringsFor } from "@/visuals/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Okuyucunun gördüğü yayın sayfası.
 *
 * Bulunamayan, yayından kaldırılmış ve süresi dolmuş yayınlar AYNI yanıtı
 * alıyor. Farklı yanıtlar, bağlantıyı tahmin etmeye çalışan birine hangi
 * kimliklerin bir zamanlar var olduğunu söylerdi.
 *
 * Yayının kendi etiketleri, yazarın notları dahil, makalenin dilini izliyor
 * (`stringsFor`); bulunamadı sayfasının makalesi yok, ziyaretçinin dilinde.
 */
function notAvailable(language: UiLanguage) {
  const t = pagesFor(language).notAvailable;
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${t.title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2efe7;color:#191b18;font:16px/1.6 Georgia,serif}main{max-width:32rem;padding:24px}h1{font-weight:500;margin:0 0 8px}p{color:#71766f;margin:0}</style></head><body><main><h1>${t.storyHeading}</h1><p>${t.storyBody}</p></main></body></html>`;
  return new Response(html, { status: 404, headers: { ...PUBLICATION_HEADERS, Vary: "Accept-Language, Cookie" } });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await readPublication(id).catch(() => undefined);
  if (!record || publicationState(record, new Date().toISOString()) !== "live") return notAvailable(uiLanguageForRequest(request));
  const project = researchProjectSchema.safeParse(record.project);
  if (!project.success) return notAvailable(uiLanguageForRequest(request));
  // Not bölümü görüntüleyiciyle aynı dilde: makale Türkçeyse Türkçe, değilse İngilizce.
  const notes = messagesFor(stringsFor(project.data.language).chrome).paper.sharedNotes;
  return new Response(withPublishedNotes(buildStandaloneStory(project.data, { surface: "published" }), record.notes, notes), {
    status: 200,
    headers: PUBLICATION_HEADERS,
  });
}
