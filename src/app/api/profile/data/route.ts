import { z } from "zod";
import { isProfile, profileSchema, WORK_DATA_KIND } from "@/lib/profile";
import { mergeWorkLogs, workLogSchema } from "@/lib/work-log";
import { readProfile, readWorkLog, updateProfile, updateWorkLog } from "@/lib/trace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

const importSchema = z.object({
  kind: z.literal(WORK_DATA_KIND),
  version: z.literal(1),
  profile: z.unknown().optional(),
  log: workLogSchema,
});

function noStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/** Okuyucunun bütün verisi tek dosyada: profil, ayarlar ve çalışma kaydı. */
export async function GET() {
  try {
    const [profile, log] = await Promise.all([readProfile(), readWorkLog()]);
    return noStore({ kind: WORK_DATA_KIND, version: 1, exportedAt: new Date().toISOString(), profile, log });
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Your data could not be read." }, { status: 500 });
  }
}

/**
 * İçe aktarma BİRLEŞTİRİYOR: oturumlar kimliğe göre, eski günler büyük olanla.
 * Profil yalnızca buradaki hiç doldurulmamışsa alınıyor; doldurulmuş bir
 * profilin üzerine başka bir makinenin profili yazılmıyor.
 */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return noStore({ error: "The file is larger than 20 MB." }, { status: 413 });
    const parsed = importSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return noStore({ error: "This is not a Trace work data file." }, { status: 400 });
    const before = (await readWorkLog()).sessions.length;
    const log = await updateWorkLog((current) => mergeWorkLogs(current, parsed.data.log));
    let profileAdopted = false;
    if (isProfile(parsed.data.profile)) {
      const incoming = profileSchema.parse(parsed.data.profile);
      await updateProfile((current) => {
        const untouched = !current.firstName && !current.lastName && current.createdAt === current.updatedAt;
        if (!untouched) return current;
        profileAdopted = true;
        return { ...incoming, updatedAt: new Date().toISOString() };
      });
    }
    return noStore({ ok: true, added: log.sessions.length - before, sessions: log.sessions.length, profileAdopted });
  } catch (error) {
    if (error instanceof SyntaxError) return noStore({ error: "The file is not valid JSON." }, { status: 400 });
    return noStore({ error: error instanceof Error ? error.message : "Your data could not be imported." }, { status: 500 });
  }
}
