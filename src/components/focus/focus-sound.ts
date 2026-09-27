import type { SoundId } from "@/lib/profile";

/**
 * Zamanlayıcının sesleri, ses dosyası olmadan: Web Audio ile birkaç yumuşak
 * ton. Tarayıcılar sesi ancak bir kullanıcı hareketinden sonra açıyor; bu
 * yüzden "Start" gibi her düğme `unlockAudio`'yu çağırıyor, zil daha sonra
 * arka planda da çalabiliyor.
 */

let context: AudioContext | undefined;

function audio() {
  if (typeof window === "undefined") return undefined;
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return undefined;
  context ??= new Context();
  return context;
}

export function unlockAudio() {
  const ctx = audio();
  if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, volume: number, type: OscillatorType = "sine") {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

export function playSound(sound: SoundId, volume: number) {
  if (sound === "none" || volume <= 0) return;
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  const start = ctx.currentTime + 0.03;
  const level = Math.min(1, volume) * 0.35;
  if (sound === "chime") {
    [659.25, 880, 1318.5].forEach((frequency, index) => tone(ctx, frequency, start + index * 0.16, 1.1, level));
  } else if (sound === "bell") {
    tone(ctx, 523.25, start, 2.2, level);
    tone(ctx, 1046.5, start, 1.6, level * 0.45);
    tone(ctx, 1567.98, start, 1.1, level * 0.2);
  } else {
    for (let index = 0; index < 3; index += 1) tone(ctx, 740, start + index * 0.24, 0.13, level * 0.8, "triangle");
  }
}
