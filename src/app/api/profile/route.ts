import { ZodError } from "zod";
import { acceptProfile } from "@/lib/profile";
import { readProfile, updateProfile } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fotoğraf dahil; istemci fotoğrafı 192 px'e küçültüp gönderiyor. */
const MAX_BODY_BYTES = 400 * 1024;

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/** Okuyucunun profili ve çalışma saatinin ayarları (`~/.trace/profile.json`). */
export async function GET() {
  try {
    return noStore({ profile: await readProfile() });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "The profile could not be read." }, { status: 500 });
  }
}

/** Profilin tamamı geliyor; oluşturma tarihi dosyada kalıyor, güncelleme tarihi sunucunun saati. */
export async function PUT(request: Request) {
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: "The profile is too large; use a smaller photo." }, { status: 413 });
    const body = JSON.parse(text) as { profile?: unknown };
    if (!body || typeof body.profile !== "object") return noStore({ error: "A profile is required." }, { status: 400 });
    const profile = await updateProfile((current) => acceptProfile(current, body.profile, new Date().toISOString()));
    return noStore({ profile });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The request is not valid JSON." }, { status: 400 });
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return noStore({ error: `${issue?.path.join(".") || "profile"}: ${issue?.message ?? "not valid"}` }, { status: 400 });
    }
    return noStore({ error: error instanceof Error ? error.message : "The profile could not be saved." }, { status: 500 });
  }
}
