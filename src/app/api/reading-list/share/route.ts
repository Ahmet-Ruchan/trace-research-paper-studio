import { z } from "zod";
import { expiryFromDays } from "@/lib/publications";
import { createReadingShare, deleteReadingShare, listReadingShares, updateReadingShare } from "@/lib/reading-share-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paylaşılan okuma listelerini yönetmek (`reading-share.ts`). Okuyucunun
 * gördüğü sayfa `/r/<kimlik>`; bu uç kayıtları, durumlarını ve süreleri
 * döndürüyor.
 */

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function failure(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return noStore({ error: error.issues[0]?.message ?? "The request is not valid." }, { status: 400 });
  if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
  return noStore({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

const idFrom = (request: Request) => new URL(request.url).searchParams.get("id") ?? "";
const expiry = z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable();

export async function GET() {
  try {
    return noStore({ shares: await listReadingShares() });
  } catch (error) {
    return failure(error, "The shared lists could not be read.");
  }
}

const createSchema = z.object({ title: z.string().max(120).default(""), expiresInDays: expiry.default(null), includePapers: z.boolean().default(false) });

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(JSON.parse((await request.text()) || "{}"));
    const share = await createReadingShare({ title: body.title, includePapers: body.includePapers, expiresAt: expiryFromDays(body.expiresInDays, new Date().toISOString()) });
    if (!share) return noStore({ error: "Save a work to read later before sharing the list." }, { status: 400 });
    return noStore({ share });
  } catch (error) {
    return failure(error, "The list could not be shared.");
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
  try {
    const body = patchSchema.parse(JSON.parse(await request.text()));
    const share = await updateReadingShare(idFrom(request), {
      ...body,
      ...(body.expiresInDays !== undefined ? { expiresAt: expiryFromDays(body.expiresInDays, new Date().toISOString()) } : {}),
    });
    return share ? noStore({ share }) : noStore({ error: "The shared list was not found." }, { status: 404 });
  } catch (error) {
    return failure(error, "The shared list could not be updated.");
  }
}

export async function DELETE(request: Request) {
  try {
    return (await deleteReadingShare(idFrom(request))) ? noStore({ ok: true }) : noStore({ error: "The shared list was not found." }, { status: 404 });
  } catch (error) {
    return failure(error, "The shared list could not be deleted.");
  }
}
