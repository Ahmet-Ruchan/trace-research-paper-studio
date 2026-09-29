import type { AmbientId, SoundId } from "@/lib/profile";

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

/* ------------------------------------------------------------------ *
 * Arka plan sesi: odak turu sürerken beyaz, kahverengi gürültü ya da yağmur.
 * Birkaç saniyelik bir gürültü tamponu döngüde çalıyor; döngü noktası
 * çıtırdamasın diye tamponun sonu başına karıştırılıyor.
 * ------------------------------------------------------------------ */

type Ambient = { kind: AmbientId; volume: number; source: AudioBufferSourceNode; gain: GainNode };
let ambient: Ambient | undefined;
const AMBIENT_LEVEL = 0.22;

function noiseBuffer(ctx: AudioContext, kind: Exclude<AmbientId, "none">) {
  const seconds = 6;
  const length = Math.floor(ctx.sampleRate * seconds);
  const fade = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let brown = 0;
    let [b0, b1, b2, b3, b4, b5, b6] = [0, 0, 0, 0, 0, 0, 0];
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      if (kind === "white") data[index] = white * 0.5;
      else if (kind === "brown") {
        brown = (brown + 0.02 * white) / 1.02;
        data[index] = brown * 3.2;
      } else {
        // Pembe gürültü (Paul Kellet): yağmurun hışırtısına yakın.
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
    for (let index = 0; index < fade; index += 1) {
      const share = index / fade;
      data[length - fade + index] = data[length - fade + index] * (1 - share) + data[index] * share;
    }
  }
  return { buffer, loopStart: fade / ctx.sampleRate };
}

/** Arka plan sesini açar ya da düzeyini değiştirir; aynı ses zaten çalıyorsa yeniden başlatmıyor. */
export function setAmbient(kind: AmbientId, volume: number) {
  if (kind === "none" || volume <= 0) return stopAmbient();
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;
  if (ambient?.kind === kind) {
    if (ambient.volume !== volume) {
      ambient.gain.gain.setTargetAtTime(volume * AMBIENT_LEVEL, ctx.currentTime, 0.2);
      ambient.volume = volume;
    }
    return;
  }
  stopAmbient();
  const { buffer, loopStart } = noiseBuffer(ctx, kind);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = loopStart;
  source.loopEnd = buffer.duration;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = kind === "white" ? 9000 : kind === "rain" ? 7000 : 1200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.setTargetAtTime(volume * AMBIENT_LEVEL, ctx.currentTime, 0.6);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  ambient = { kind, volume, source, gain };
}

export function stopAmbient() {
  if (!ambient || !context) return;
  const { source, gain } = ambient;
  ambient = undefined;
  gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.25);
  source.stop(context.currentTime + 1.2);
}

export function ambientPlaying() {
  return ambient?.kind;
}
