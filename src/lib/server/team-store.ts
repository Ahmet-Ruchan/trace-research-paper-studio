import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MAX_APPROVALS, memberNameSchema, nameKey, passwordSchema, type MemberRole, type TeamMember } from "../team";
import { traceDataDirectory } from "./data-directory";

/**
 * Ekip kipinin kaydı: `~/.trace/team.json` (`team.ts`).
 *
 * Parolalar scrypt ile, üye başına tuzla özetleniyor; dosyada parola yok.
 * Oturum anahtarı tarayıcıda HttpOnly bir çerezde, dosyada yalnızca SHA-256
 * özeti. Art arda yanlış parola bir ada on beş dakika giriş kapatıyor.
 * Dosya küçük ve her istekte okunuyor (proxy de okuyor); değişmediyse
 * bellekteki kopya kullanılıyor.
 */

export const SESSION_COOKIE = "trace_session";
const SESSION_DAYS = 30;
const MAX_SESSIONS = 2000;
const FAILURES_BEFORE_PAUSE = 5;
const PAUSE_MS = 15 * 60_000;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

const memberRecord = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(60),
  role: z.enum(["owner", "member"]),
  salt: z.string().min(16).max(64),
  hash: z.string().min(32).max(256),
  createdAt: z.string().max(40),
});
const sessionRecord = z.object({ hash: z.string().length(64), memberId: z.string().min(1).max(80), expiresAt: z.string().max(40) });
const teamFileSchema = z.object({
  version: z.literal(1),
  approvalsNeeded: z.number().int().min(1).max(MAX_APPROVALS).default(1),
  members: z.array(memberRecord).max(200).default([]),
  sessions: z.array(sessionRecord).max(MAX_SESSIONS).default([]),
});
type TeamFile = z.infer<typeof teamFileSchema>;
type MemberRecord = z.infer<typeof memberRecord>;

const EMPTY: TeamFile = { version: 1, approvalsNeeded: 1, members: [], sessions: [] };

export const teamFilePath = () => join(traceDataDirectory(), "team.json");

let cache: { path: string; mtimeMs: number; size: number; file: TeamFile } | undefined;

/** Kayıt; yoksa ya da okunamıyorsa ekip kipi kapalı (boş). */
export function readTeam(): TeamFile {
  const path = teamFilePath();
  try {
    const stat = statSync(path);
    if (cache && cache.path === path && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.file;
    const parsed = teamFileSchema.safeParse((() => {
      try {
        return JSON.parse(readFileSync(path, "utf8")) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code) throw error;
        return undefined;
      }
    })());
    // Bozuk bir dosya ekip kipini sessizce kapatmasın: kimse giremez, sahip dosyayı onarır.
    const file = parsed.success ? parsed.data : { ...EMPTY, members: [{ id: "damaged", name: "damaged", role: "owner" as const, salt: "0".repeat(32), hash: "0".repeat(128), createdAt: "" }] };
    cache = { path, mtimeMs: stat.mtimeMs, size: stat.size, file };
    return file;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw error;
  }
}

export const teamEnabled = () => readTeam().members.length > 0;

const publicMember = (record: MemberRecord): TeamMember => ({ id: record.id, name: record.name, role: record.role });

/** Ekipten önceki notların ve kararların sahibi: ilk açılan sahip hesabı. */
export function firstOwnerId(file = readTeam()) {
  return file.members.find((member) => member.role === "owner")?.id;
}

export function memberNames(file = readTeam()) {
  return new Map(file.members.map((member) => [member.id, member.name]));
}

function writeTeam(change: (file: TeamFile) => TeamFile): TeamFile {
  const directory = traceDataDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "team.lock");
  let locked = false;
  for (let attempt = 0; attempt < 50 && !locked; attempt += 1) {
    try {
      mkdirSync(lock);
      locked = true;
    } catch {
      // Kısa, eşzamanlı bekleme: yazmalar milisaniyeler sürüyor.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  if (!locked) throw new Error("The team settings are busy. Please retry in a moment.");
  try {
    const next = teamFileSchema.parse(change(readTeam()));
    const path = teamFilePath();
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    cache = undefined;
    return next;
  } finally {
    rmdirSync(lock);
  }
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password.normalize("NFC"), salt, 64, SCRYPT).toString("hex");
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function newSession(file: TeamFile, memberId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const sessions = [
    ...file.sessions.filter((session) => Date.parse(session.expiresAt) > now),
    { hash: tokenHash(token), memberId, expiresAt: new Date(now + SESSION_DAYS * 86_400_000).toISOString() },
  ].slice(-MAX_SESSIONS);
  return { token, sessions };
}

function newMember(name: string, password: string, role: MemberRole): MemberRecord {
  const salt = randomBytes(16).toString("hex");
  return { id: `m_${randomUUID().replace(/-/g, "").slice(0, 16)}`, name: memberNameSchema.parse(name), role, salt, hash: hashPassword(passwordSchema.parse(password), salt), createdAt: new Date().toISOString() };
}

export class TeamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** İlk hesap: ekip kipini açıyor; açan sahip oluyor ve oturumu açılıyor. */
export function createFirstOwner(name: string, password: string) {
  let token = "";
  let member: TeamMember | undefined;
  writeTeam((file) => {
    if (file.members.length) throw new TeamError("The team already has accounts. Sign in instead.", 409);
    const record = newMember(name, password, "owner");
    const session = newSession(file, record.id);
    token = session.token;
    member = publicMember(record);
    return { ...file, members: [record], sessions: session.sessions };
  });
  return { token, member: member! };
}

const failures = new Map<string, { count: number; since: number; until: number }>();

/** Giriş: ad ve parola doğruysa yeni bir oturum anahtarı. */
export function signIn(name: string, password: string) {
  const key = nameKey(name);
  const pause = failures.get(key);
  if (pause && pause.until > Date.now()) throw new TeamError("Too many wrong passwords for this name. Try again in fifteen minutes.", 429);
  const file = readTeam();
  const record = file.members.find((member) => nameKey(member.name) === key);
  // Bilinmeyen adda da aynı iş yapılıyor: yanıt süresi adın var olup olmadığını ele vermesin.
  const expected = record ? Buffer.from(record.hash, "hex") : Buffer.alloc(64);
  const given = Buffer.from(hashPassword(password.slice(0, 1000), record?.salt ?? "0".repeat(32)), "hex");
  if (!record || !timingSafeEqual(expected, given)) {
    const now = Date.now();
    const recent = pause && now - pause.since < PAUSE_MS;
    const count = (recent ? pause.count : 0) + 1;
    failures.set(key, { count, since: recent ? pause.since : now, until: count >= FAILURES_BEFORE_PAUSE ? now + PAUSE_MS : 0 });
    throw new TeamError("The name or the password is wrong.", 401);
  }
  failures.delete(key);
  let token = "";
  writeTeam((current) => {
    const session = newSession(current, record.id);
    token = session.token;
    return { ...current, sessions: session.sessions };
  });
  return { token, member: publicMember(record) };
}

export function signOut(token: string | undefined) {
  if (!token) return;
  const hash = tokenHash(token);
  if (!readTeam().sessions.some((session) => session.hash === hash)) return;
  writeTeam((file) => ({ ...file, sessions: file.sessions.filter((session) => session.hash !== hash) }));
}

export function sessionToken(cookieHeader: string | null) {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/** Çerezdeki oturumun üyesi; süresi dolmuş ya da silinmiş üye yok sayılıyor. */
export function memberForCookie(cookieHeader: string | null, file = readTeam()): TeamMember | undefined {
  const token = sessionToken(cookieHeader);
  if (!token || !file.members.length) return undefined;
  const hash = tokenHash(token);
  const session = file.sessions.find((item) => item.hash === hash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return undefined;
  const record = file.members.find((member) => member.id === session.memberId);
  return record ? publicMember(record) : undefined;
}

export const currentMember = (request: Request) => memberForCookie(request.headers.get("cookie"));

/** `Set-Cookie`: HttpOnly, SameSite=Lax; HTTPS'te Secure. */
export function sessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? "; Secure" : ""}`;
}

export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const requireOwner = (actor: TeamMember | undefined) => {
  if (!actor) throw new TeamError("Sign in first.", 401);
  if (actor.role !== "owner") throw new TeamError("Only an owner can change the team.", 403);
};

export function listMembers() {
  const file = readTeam();
  return { members: file.members.map(publicMember), approvalsNeeded: file.approvalsNeeded };
}

export function addMember(actor: TeamMember | undefined, name: string, password: string, role: MemberRole = "member") {
  requireOwner(actor);
  let added: TeamMember | undefined;
  writeTeam((file) => {
    if (file.members.some((member) => nameKey(member.name) === nameKey(name))) throw new TeamError("Someone in the team already has this name.", 409);
    const record = newMember(name, password, role);
    added = publicMember(record);
    return { ...file, members: [...file.members, record] };
  });
  return added!;
}

/** Üyeyi ve oturumlarını siliyor; son sahip silinemiyor. Notları ve oyları kalıyor. */
export function removeMember(actor: TeamMember | undefined, id: string) {
  requireOwner(actor);
  writeTeam((file) => {
    const target = file.members.find((member) => member.id === id);
    if (!target) throw new TeamError("There is no such member.", 404);
    if (target.role === "owner" && file.members.filter((member) => member.role === "owner").length === 1) throw new TeamError("The last owner cannot be removed.", 409);
    return { ...file, members: file.members.filter((member) => member.id !== id), sessions: file.sessions.filter((session) => session.memberId !== id) };
  });
}

/** Kendi parolasını değiştirmek: eskisi doğru olmalı; öbür oturumları kapanıyor. */
export function changePassword(actor: TeamMember | undefined, current: string, next: string, keepToken: string | undefined) {
  if (!actor) throw new TeamError("Sign in first.", 401);
  const record = readTeam().members.find((member) => member.id === actor.id);
  if (!record || !timingSafeEqual(Buffer.from(record.hash, "hex"), Buffer.from(hashPassword(current.slice(0, 1000), record.salt), "hex"))) throw new TeamError("The current password is wrong.", 403);
  const salt = randomBytes(16).toString("hex");
  const hash = hashPassword(passwordSchema.parse(next), salt);
  const keep = keepToken ? tokenHash(keepToken) : undefined;
  writeTeam((file) => ({
    ...file,
    members: file.members.map((member) => (member.id === actor.id ? { ...member, salt, hash } : member)),
    sessions: file.sessions.filter((session) => session.memberId !== actor.id || session.hash === keep),
  }));
}

export function setApprovalsNeeded(actor: TeamMember | undefined, approvals: number) {
  requireOwner(actor);
  const value = z.number().int().min(1).max(MAX_APPROVALS).parse(approvals);
  writeTeam((file) => ({ ...file, approvalsNeeded: value }));
  return value;
}

/** Testler için: bellekteki deneme sayaçları. */
export function forgetFailedSignIns() {
  failures.clear();
}
