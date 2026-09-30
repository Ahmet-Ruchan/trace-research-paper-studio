import { z } from "zod";
import { focusColorSchema, type FocusColorId } from "./focus-colors";

/**
 * Okuyucunun profili: kim olduğu ve çalışma saatinin ayarları.
 *
 * `~/.trace/profile.json` içinde, makinede duruyor; hiçbir projeye ya da
 * yayınlanan sayfaya girmiyor. Zamanlayıcı ayarları, alarmlar ve renkler de
 * burada: tarayıcının verisi silinince kaybolmasınlar, başka bir tarayıcıda
 * da aynı olsunlar. Çalışılan zamanın kaydı ayrı dosyada (`work-log.ts`).
 */

export const PROFILE_VERSION = 1;
/** "Download my data" dosyasının türü: profil ve çalışma kaydı birlikte. */
export const WORK_DATA_KIND = "trace-work-data";
/** Profil fotoğrafı istemcide 192 px'e küçültülüp JPEG olarak geliyor; bu sınır bol. */
export const MAX_PHOTO_CHARS = 200_000;
export const MAX_ALARMS = 20;

const text = (max: number) => z.string().trim().max(max).default("");

export const SOUNDS = [
  { id: "chime", label: "Chime" },
  { id: "bell", label: "Bell" },
  { id: "beep", label: "Soft beep" },
  { id: "none", label: "No sound" },
] as const;
export type SoundId = (typeof SOUNDS)[number]["id"];

/** Odak turu sürerken çalan arka plan sesi; ses dosyası yok, tarayıcıda üretiliyor. */
export const AMBIENT_SOUNDS = [
  { id: "none", label: "None" },
  { id: "white", label: "White noise" },
  { id: "brown", label: "Brown noise" },
  { id: "rain", label: "Rain" },
] as const;
export type AmbientId = (typeof AMBIENT_SOUNDS)[number]["id"];
export const ambientSchema = z.enum(AMBIENT_SOUNDS.map((sound) => sound.id) as [AmbientId, ...AmbientId[]]);
export const soundSchema = z.enum(SOUNDS.map((sound) => sound.id) as [SoundId, ...SoundId[]]);

export const TIMER_MODES = ["focus", "timer", "stopwatch", "alarm"] as const;
export type TimerMode = (typeof TIMER_MODES)[number];

export const alarmSchema = z.object({
  id: z.string().min(1).max(60),
  /** Yerel saat, "HH:MM". */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  label: text(80),
  /** Tekrarlanan günler (0 pazar … 6 cumartesi); boşsa bir kez çalıyor ve kapanıyor. */
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  enabled: z.boolean().default(true),
  color: focusColorSchema.default("purple"),
});
export type Alarm = z.infer<typeof alarmSchema>;

export const focusSettingsSchema = z.object({
  /** Dakika. */
  work: z.number().int().min(1).max(240).default(25),
  shortBreak: z.number().int().min(1).max(60).default(5),
  longBreak: z.number().int().min(1).max(120).default(15),
  /** Kaç odak turundan sonra uzun mola. */
  longEvery: z.number().int().min(1).max(12).default(4),
  /** Kaç tur; 0: durdurulana kadar sürüyor. */
  rounds: z.number().int().min(0).max(24).default(0),
  autoStartBreaks: z.boolean().default(true),
  autoStartWork: z.boolean().default(true),
});
export type FocusSettings = z.infer<typeof focusSettingsSchema>;

export const preferencesSchema = z.object({
  /** Profilin ve çalışma takviminin rengi. */
  color: focusColorSchema.default("green"),
  colors: z
    .object({
      focus: focusColorSchema.default("red"),
      timer: focusColorSchema.default("orange"),
      stopwatch: focusColorSchema.default("blue"),
      alarm: focusColorSchema.default("purple"),
    })
    .default({ focus: "red", timer: "orange", stopwatch: "blue", alarm: "purple" }),
  focus: focusSettingsSchema.default(focusSettingsSchema.parse({})),
  /** Geri sayımın son ayarı, saniye. */
  timerSeconds: z.number().int().min(1).max(24 * 3600 - 1).default(10 * 60),
  /** Geri sayım ve kronometre çalışma süresi sayılsın mı. */
  timerCountsAsWork: z.boolean().default(true),
  stopwatchCountsAsWork: z.boolean().default(true),
  /** Tekrar ekranında geçen süre çalışma sayılsın mı. */
  reviewCountsAsWork: z.boolean().default(true),
  /** Günlük hedef, dakika; takvimin en koyu tonu hedefe ulaşılan gün. */
  dailyGoalMinutes: z.number().int().min(15).max(24 * 60).default(4 * 60),
  /** Haftanın ilk günü: 1 pazartesi, 0 pazar. */
  weekStart: z.union([z.literal(0), z.literal(1)]).default(1),
  clock: z.enum(["24h", "12h"]).default("24h"),
  sound: soundSchema.default("chime"),
  volume: z.number().min(0).max(1).default(0.6),
  /** Sekme arka plandayken masaüstü bildirimi. */
  notifications: z.boolean().default(false),
  /** Odak turlarında arka plan sesi ve düzeyi. */
  ambient: ambientSchema.default("none"),
  ambientVolume: z.number().min(0).max(1).default(0.35),
  /** Kısa molada vadesi gelmiş birkaç tekrar kartı önerilsin mi. */
  breakReview: z.boolean().default(true),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const profileSchema = z.object({
  version: z.literal(PROFILE_VERSION),
  firstName: text(60),
  lastName: text(60),
  /** "PhD student", "Research engineer". */
  title: text(80),
  institution: text(120),
  field: text(120),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || z.email().safeParse(value).success, "Enter an email address, or leave it empty.")
    .default(""),
  bio: text(400),
  photo: z.string().max(MAX_PHOTO_CHARS).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  preferences: preferencesSchema.default(preferencesSchema.parse({})),
  alarms: z.array(alarmSchema).max(MAX_ALARMS).default([]),
});
export type Profile = z.infer<typeof profileSchema>;

export function emptyProfile(now: string): Profile {
  return profileSchema.parse({ version: PROFILE_VERSION, createdAt: now, updatedAt: now });
}

export function isProfile(raw: unknown) {
  return profileSchema.safeParse(raw).success;
}

/** Okunamayan ya da tanınmayan dosya boş profille karşılanıyor (depolama onu kenara alıyor, silmiyor). */
export function parseProfile(raw: unknown, now: string): Profile {
  const parsed = profileSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyProfile(now);
}

export function displayName(profile: Pick<Profile, "firstName" | "lastName">) {
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ");
}

/** Avatarın harfleri: ad ve soyadın ilk harfleri; ad yoksa boş (arayüz simge gösteriyor). */
export function initials(profile: Pick<Profile, "firstName" | "lastName">) {
  return [profile.firstName, profile.lastName]
    .map((part) => [...part.trim()][0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

export function modeColor(profile: Profile | undefined, mode: TimerMode): FocusColorId {
  return profile?.preferences.colors[mode] ?? preferencesSchema.parse({}).colors[mode];
}

/**
 * İstemciden gelen profil: kimlik alanları ve ayarlar okuyucunun, oluşturma
 * tarihi dosyanın. Güncelleme tarihi sunucunun saati.
 */
export function acceptProfile(current: Profile, incoming: unknown, now: string): Profile {
  const next = profileSchema.parse({ ...(incoming as object), version: PROFILE_VERSION, createdAt: current.createdAt, updatedAt: now });
  return next;
}
