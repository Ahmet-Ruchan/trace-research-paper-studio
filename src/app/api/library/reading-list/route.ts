import { z } from "zod";
import { addAllToReadingList, addToReadingList, MAX_READING_ITEMS, readingItemSchema, removeFromReadingList } from "@/lib/reading-list";
import { readReadingList, updateReadingList } from "@/lib/trace-storage";

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

export async function GET() {
  try {
    return noStore({ items: await readReadingList() });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The reading list could not be read." }, { status: 500 });
  }
}

/** Bir çalışma (`item`) ya da birçoğu (`items`) ekler; zaten listedeyse nereden geldiği birleşiyor. */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    const size = Buffer.byteLength(text, "utf8");
    const tooLarge = () => noStore({ error: "The paper's details are too large." }, { status: 413 });
    if (size > MAX_BULK_BYTES) return tooLarge();
    const json = JSON.parse(text) as unknown;
    if (size > MAX_BODY_BYTES && !(json && typeof json === "object" && "items" in json)) return tooLarge();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return noStore({ error: parsed.error.issues[0]?.message ?? "The paper's details are not valid." }, { status: 400 });
    const body = parsed.data;
    return noStore({ ok: true, items: await updateReadingList((items) => ("items" in body ? addAllToReadingList(items, body.items) : addToReadingList(items, body.item))) });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    const message = error instanceof Error ? error.message : "The reading list could not be saved.";
    return noStore({ error: message }, { status: message.startsWith("The reading list holds") ? 409 : 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return noStore({ error: "A paper id is required." }, { status: 400 });
  try {
    return noStore({ ok: true, items: await updateReadingList((items) => removeFromReadingList(items, id)) });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The reading list could not be saved." }, { status: 500 });
  }
}
