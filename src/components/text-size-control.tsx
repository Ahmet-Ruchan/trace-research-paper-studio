"use client";

import { useState } from "react";
import { ALargeSmall, Check } from "lucide-react";
import { applyTextSize, currentTextSize, textSizes, type TextSize } from "@/lib/text-size";

/**
 * Başlıktaki yazı boyutu düğmesi. Menü, dışa aktarma menüsüyle aynı kalıp:
 * arkadaki görünmez düğme dışarı tıklamayı yakalıyor, Escape kapatıyor.
 */
export function TextSizeControl({ className }: { className?: string }) {
  // Stüdyo içeriği yalnızca istemcide, açılış ekranından sonra çiziliyor;
  // o anda kök öğedeki seçim zaten okunabilir durumda.
  const [size, setSize] = useState<TextSize>(currentTextSize);
  const [open, setOpen] = useState(false);

  function choose(next: TextSize) {
    applyTextSize(next);
    setSize(next);
    setOpen(false);
  }

  return (
    <div className={`export-menu text-size-menu ${className ?? ""}`} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <button
        className="text-size-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Text size"
        title="Text size"
        onClick={() => setOpen((value) => !value)}
      >
        <ALargeSmall size={17} />
      </button>
      {open && (
        <>
          <button className="export-menu-backdrop" aria-label="Close the text size menu" onClick={() => setOpen(false)} />
          <div className="export-menu-list text-size-list" role="menu" aria-label="Text size">
            {textSizes.map((option) => (
              <button
                key={option.id}
                role="menuitemradio"
                aria-checked={size === option.id}
                onClick={() => choose(option.id)}
              >
                {/* px bilerek: rem olsaydı seçili boyut örnekleri ikinci kez büyütürdü.
                    span değil: başlıktaki düğme metnini gizleyen kural span'ları yakalıyor. */}
                <i className="text-size-sample" aria-hidden="true" style={{ fontSize: `${(16 * option.percent) / 100}px` }}>Aa</i>
                <strong>{option.label}</strong>
                <small>{option.percent}%</small>
                {size === option.id && <Check size={15} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
