"use client";

import { useState } from "react";
import { ALargeSmall, Check, Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/i18n/client";
import { applyTextSize, currentTextSize, textSizes, type TextSize } from "@/lib/text-size";
import { applyTheme, currentTheme, themes, type Theme } from "@/lib/theme";

const themeIcons = { light: Sun, dark: Moon, system: Monitor } satisfies Record<Theme, unknown>;

/**
 * Başlıktaki görünüm menüsü: yazı boyutu ve tema. Menü, dışa aktarma
 * menüsüyle aynı kalıp: arkadaki görünmez düğme dışarı tıklamayı yakalıyor,
 * Escape kapatıyor. İki seçim de yalnızca bu tarayıcıda saklanıyor.
 */
export function DisplayControl({ className }: { className?: string }) {
  const t = useT().studio.display;
  // Stüdyo içeriği yalnızca istemcide, açılış ekranından sonra çiziliyor;
  // o anda kök öğedeki seçimler zaten okunabilir durumda.
  const [size, setSize] = useState<TextSize>(currentTextSize);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [open, setOpen] = useState(false);

  return (
    <div className={`export-menu text-size-menu ${className ?? ""}`} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <button
        className="text-size-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.button}
        title={t.button}
        onClick={() => setOpen((value) => !value)}
      >
        <ALargeSmall size={17} />
      </button>
      {open && (
        <>
          <button className="export-menu-backdrop" aria-label={t.close} onClick={() => setOpen(false)} />
          <div className="export-menu-list text-size-list" role="menu" aria-label={t.button}>
            <div role="group" aria-label={t.textSize}>
              <small className="display-group-label" aria-hidden="true">{t.textSize}</small>
              {textSizes.map((option) => (
                <button
                  key={option.id}
                  role="menuitemradio"
                  aria-checked={size === option.id}
                  onClick={() => { applyTextSize(option.id); setSize(option.id); setOpen(false); }}
                >
                  {/* px bilerek: rem olsaydı seçili boyut örnekleri ikinci kez büyütürdü.
                      span değil: başlıktaki düğme metnini gizleyen kural span'ları yakalıyor. */}
                  <i className="text-size-sample" aria-hidden="true" style={{ fontSize: `${(16 * option.percent) / 100}px` }}>{t.sample}</i>
                  <strong>{t.textSizes[option.id]}</strong>
                  <small>{t.percent(option.percent)}</small>
                  {size === option.id && <Check size={15} />}
                </button>
              ))}
            </div>
            <div role="group" aria-label={t.theme}>
              <small className="display-group-label" aria-hidden="true">{t.theme}</small>
              {themes.map((option) => {
                const Icon = themeIcons[option.id];
                return (
                  <button
                    key={option.id}
                    role="menuitemradio"
                    aria-checked={theme === option.id}
                    onClick={() => { applyTheme(option.id); setTheme(option.id); setOpen(false); }}
                  >
                    <i className="text-size-sample" aria-hidden="true"><Icon size={16} /></i>
                    <strong>{t.themes[option.id]}</strong>
                    <small>{option.id === "system" ? t.followsDevice : ""}</small>
                    {theme === option.id && <Check size={15} />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
