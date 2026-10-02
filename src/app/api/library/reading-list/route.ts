import { z } from "zod";
import { addAllToReadingList, addToReadingList, MAX_READING_ITEMS, ReadingListFullError, readingItemSchema, removeFromReadingList } from "@/lib/reading-list";
import { readReadingList, updateReadingList } from "@/lib/trace-storage";
import { routeMessages, serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
// Zotero ya da .bib içe aktarımı birçok çalışmayı birden gönderiyor.
const MAX_BULK_BYTES = 2 * 1024 * 1024;
const bodySchema = z.union([z.object({ item: readingItemSchema }), z.object({ items: z.array(readingItemSchema).min(1).max(MAX_READING_ITEMS) })]);

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(request?: Request) {
  try {
    return noStore({ items: await readReadingList() });
  } catch (error) {
    const t = serverText(request);
    return noStore({ error: errorMessage(error, t.errors, t.readingList.readFailed) }, { status: 500 });
  }
}

/** Bir çalışma (`item`) ya da birçoğu (`items`) ekler; zaten listedeyse nereden geldiği birleşiyor. */
export async function POST(request: Request) {
  const messages = routeMessages(request);
  const t = messages.server;
  const limits = messages.learning.words.readingListLimits;
  try {
    const text = await request.text();
    const size = Buffer.byteLength(text, "utf8");
    const tooLarge = () => noStore({ error: t.readingList.tooLarge }, { status: 413 });
    if (size > MAX_BULK_BYTES) return tooLarge();
    const json = JSON.parse(text) as unknown;
    if (size > MAX_BODY_BYTES && !(json && typeof json === "object" && "items" in json)) return tooLarge();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return noStore({ error: parsed.error.issues[0]?.message ?? t.readingList.invalid }, { status: 400 });
    const body = parsed.data;
    return noStore({ ok: true, items: await updateReadingList((items) => ("items" in body ? addAllToReadingList(items, body.items, limits) : addToReadingList(items, body.item, limits))) });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: t.request.invalidJson }, { status: 400 });
    return noStore({ error: errorMessage(error, t.errors, t.readingList.saveFailed) }, { status: error instanceof ReadingListFullError ? 409 : 500 });
  }
}

export async function DELETE(request: Request) {
  const t = serverText(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return noStore({ error: t.readingList.paperIdRequired }, { status: 400 });
  try {
    return noStore({ ok: true, items: await updateReadingList((items) => removeFromReadingList(items, id)) });
  } catch (error) {
    return noStore({ error: errorMessage(error, t.errors, t.readingList.saveFailed) }, { status: 500 });
  }
}
