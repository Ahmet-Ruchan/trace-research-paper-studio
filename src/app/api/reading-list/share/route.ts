import { z } from "zod";
import { uiLanguageForRequest } from "@/i18n/languages";
import { pagesFor } from "@/i18n/messages/pages";
import { expiryFromDays } from "@/lib/publications";
import { createReadingShare, deleteReadingShare, listReadingShares, updateReadingShare } from "@/lib/reading-share-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paylaşılan okuma listelerini yönetmek (`reading-share.ts`). Okuyucunun
 * gördüğü sayfa `/r/<kimlik>`; bu uç kayıtları, durumlarını ve süreleri
 * döndürüyor.
 *
 * Hatalar isteği yapanın dilinde; yeni paylaşılan liste de o dilde
 * kaydediliyor (sayfası paylaşanın dilinde açılıyor).
 */

type ShareApiWords = ReturnType<typeof pagesFor>["shareApi"];

const wordsFor = (request: Request) => pagesFor(uiLanguageForRequest(request)).shareApi;

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function failure(error: unknown, fallback: string, t: ShareApiWords) {
  if (error instanceof z.ZodError) return noStore({ error: error.issues[0]?.message ?? t.invalidRequest }, { status: 400 });
  if (error instanceof SyntaxError) return noStore({ error: t.invalidJson }, { status: 400 });
  return noStore({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

const idFrom = (request: Request) => new URL(request.url).searchParams.get("id") ?? "";
const expiry = z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable();

export async function GET(request: Request) {
  const t = wordsFor(request);
  try {
    return noStore({ shares: await listReadingShares() });
  } catch (error) {
    return failure(error, t.readFailed, t);
  }
}

const createSchema = z.object({ title: z.string().max(120).default(""), expiresInDays: expiry.default(null), includePapers: z.boolean().default(false) });

export async function POST(request: Request) {
  const language = uiLanguageForRequest(request);
  const t = pagesFor(language).shareApi;
  try {
    const body = createSchema.parse(JSON.parse((await request.text()) || "{}"));
    const share = await createReadingShare({ title: body.title, includePapers: body.includePapers, expiresAt: expiryFromDays(body.expiresInDays, new Date().toISOString()), language });
    if (!share) return noStore({ error: t.nothingToShare }, { status: 400 });
    return noStore({ share });
  } catch (error) {
    return failure(error, t.shareFailed, t);
  }
}

const patchSchema = z.object({
  status: z.enum(["live", "unpublished"]).optional(),
  expiresInDays: expiry.optional(),
  title: z.string().max(120).optional(),
  includePapers: z.boolean().optional(),
  refresh: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const t = wordsFor(request);
  try {
    const body = patchSchema.parse(JSON.parse(await request.text()));
    const share = await updateReadingShare(idFrom(request), {
      ...body,
      ...(body.expiresInDays !== undefined ? { expiresAt: expiryFromDays(body.expiresInDays, new Date().toISOString()) } : {}),
    });
    return share ? noStore({ share }) : noStore({ error: t.notFound }, { status: 404 });
  } catch (error) {
    return failure(error, t.updateFailed, t);
  }
}

export async function DELETE(request: Request) {
  const t = wordsFor(request);
  try {
    return (await deleteReadingShare(idFrom(request))) ? noStore({ ok: true }) : noStore({ error: t.notFound }, { status: 404 });
  } catch (error) {
    return failure(error, t.deleteFailed, t);
  }
}
