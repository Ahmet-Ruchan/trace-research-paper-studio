import { ZodError } from "zod";
import { acceptProfile } from "@/lib/profile";
import { readProfile, updateProfile } from "@/lib/trace-storage";
import { serverText } from "@/lib/server/server-text";
import { errorMessage } from "@/lib/user-error";

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
export async function GET(request?: Request) {
  try {
    return noStore({ profile: await readProfile() });
  } catch (error) {
    const t = serverText(request);
    return noStore({ error: errorMessage(error, t.errors, t.profile.readFailed) }, { status: 500 });
  }
}

/** Profilin tamamı geliyor; oluşturma tarihi dosyada kalıyor, güncelleme tarihi sunucunun saati. */
export async function PUT(request: Request) {
  const t = serverText(request);
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: t.profile.tooLarge }, { status: 413 });
    const body = JSON.parse(text) as { profile?: unknown };
    if (!body || typeof body.profile !== "object") return noStore({ error: t.profile.required }, { status: 400 });
    const profile = await updateProfile((current) => acceptProfile(current, body.profile, new Date().toISOString()));
    return noStore({ profile });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: t.request.invalidJson }, { status: 400 });
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return noStore({ error: t.profile.fieldInvalid(issue?.path.join(".") ?? "", issue?.message) }, { status: 400 });
    }
    return noStore({ error: errorMessage(error, t.errors, t.profile.saveFailed) }, { status: 500 });
  }
}
