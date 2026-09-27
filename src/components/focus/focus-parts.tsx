"use client";

import { useId, type KeyboardEvent, type ReactNode } from "react";
import { Check, Minus, Plus, UserRound } from "lucide-react";
import { FOCUS_COLORS, focusColorStyle, type FocusColorId } from "@/lib/focus-colors";
import { initials, type Profile } from "@/lib/profile";

/** Renk seçimi: on bir renk, radyo grubu; oklarla da geziliyor. */
export function ColorPicker({ value, onChange, label }: { value: FocusColorId; onChange: (color: FocusColorId) => void; label: string }) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = FOCUS_COLORS[(index + step + FOCUS_COLORS.length) % FOCUS_COLORS.length];
    onChange(next.id);
    const group = event.currentTarget.parentElement;
    window.requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>(`[data-color="${next.id}"]`)?.focus());
  };
  return (
    <div className="color-picker" role="radiogroup" aria-label={label}>
      {FOCUS_COLORS.map((color, index) => (
        <button
          key={color.id}
          type="button"
          role="radio"
          data-color={color.id}
          aria-checked={value === color.id}
          aria-label={color.label}
          title={color.label}
          tabIndex={value === color.id ? 0 : -1}
          style={focusColorStyle(color.id)}
          onClick={() => onChange(color.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {value === color.id ? <Check size={14} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

/** Halka: ilerleme rengin kendisiyle, zemin izi soluk. */
export function Dial({ progress, children, label }: { progress: number; children: ReactNode; label: string }) {
  const radius = 108;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <div className="focus-dial" role="timer" aria-label={label}>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <circle className="focus-dial-track" cx="120" cy="120" r={radius} />
        <circle
          className="focus-dial-progress"
          cx="120"
          cy="120"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform="rotate(-90 120 120)"
        />
      </svg>
      <div className="focus-dial-face">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="focus-toggle">
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
        <span aria-hidden="true" />
      </button>
      <label htmlFor={id}>
        {label}
        {hint ? <small>{hint}</small> : null}
      </label>
    </div>
  );
}

/** Sayı alanı, − ve + ile; değer sınırlar içinde kalıyor. */
export function NumberField({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit?: string; onChange: (value: number) => void }) {
  const id = useId();
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next))));
  return (
    <div className="focus-number">
      <label htmlFor={id}>{label}</label>
      <div>
        <button type="button" aria-label={`Less ${label.toLowerCase()}`} onClick={() => set(value - 1)} disabled={value <= min}>
          <Minus size={14} />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next) && event.target.value !== "") set(next);
          }}
        />
        {unit ? <span aria-hidden="true">{unit}</span> : null}
        <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => set(value + 1)} disabled={value >= max}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

/** Profil resmi ya da adın baş harfleri, profil renginde. */
export function Avatar({ profile, size = "small" }: { profile: Profile; size?: "small" | "large" }) {
  const letters = initials(profile);
  return (
    <span className={`focus-avatar focus-avatar-${size}`} style={focusColorStyle(profile.preferences.color)} aria-hidden="true">
      {profile.photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- veri adresi; next/image bunu optimize edemez
        <img src={profile.photo} alt="" />
      ) : letters ? (
        letters
      ) : (
        <UserRound size={size === "large" ? 34 : 15} />
      )}
    </span>
  );
}
