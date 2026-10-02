"use client";

import { useState } from "react";
import { AlarmClock, BarChart3, BellRing, Coffee, PartyPopper, PauseCircle } from "lucide-react";
import { useT } from "@/i18n/client";
import { focusColorStyle } from "@/lib/focus-colors";
import { MAX_SESSION_NOTE } from "@/lib/work-log";
import { alertCopy, useFocus, useFocusClock } from "./focus-provider";

const icons = { phase: Coffee, done: PartyPopper, timer: BellRing, alarm: AlarmClock, notice: PauseCircle, summary: BarChart3 } as const;

/**
 * Tur bitince tek satır: "ne yaptın?". İsteğe bağlı; yazılan, turun
 * oturumuna gidiyor ve takvimde, haftalık raporda görünüyor.
 */
function RoundNote({ endAt }: { endAt: number }) {
  const messages = useT();
  const t = messages.focus.alerts;
  const { noteRound } = useFocus();
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<string>();
  if (saved) return <p className="focus-alert-note-saved" role="status">{t.noted(saved)}</p>;
  return (
    <form
      className="focus-alert-note"
      onSubmit={(event) => {
        event.preventDefault();
        if (noteRound(endAt, draft)) setSaved(draft.trim());
      }}
    >
      <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MAX_SESSION_NOTE} placeholder={t.notePlaceholder} aria-label={t.noteLabel} />
      <button type="submit" disabled={!draft.trim()}>{messages.common.save}</button>
    </form>
  );
}

/**
 * Zamanlayıcının bildirimleri, her ekranda: tur bitti, mola başladı, süre
 * doldu, alarm çalıyor. Zil çalarken "Stop" hem zili hem bildirimi kapatıyor.
 */
export function FocusAlerts({ onOpen, onReport }: { onOpen: () => void; onReport?: () => void }) {
  const messages = useT();
  const t = messages.focus.alerts;
  const { store, dismissAlert, runAlert } = useFocus();
  const now = useFocusClock();
  if (!store.alerts.length) return null;
  return (
    <div className="focus-alerts">
      {store.alerts.map((alert) => {
        const Icon = icons[alert.kind];
        const ringing = alert.ringUntil > now;
        // Saklanan metin çaldığı anın dilinde; ileti varsa bugünkü dille yeniden yazılıyor.
        const copy = alert.message ? alertCopy(alert.message, messages) : alert;
        return (
          <section
            key={alert.id}
            className={`focus-alert${ringing ? " is-ringing" : ""}`}
            style={focusColorStyle(alert.color)}
            role={ringing ? "alert" : "status"}
            aria-label={copy.title}
          >
            <span className="focus-alert-icon" aria-hidden="true"><Icon size={18} /></span>
            <div className="focus-alert-copy">
              <strong>{copy.title}</strong>
              {copy.body ? <p>{copy.body}</p> : null}
              {alert.roundEnd ? <RoundNote endAt={alert.roundEnd} /> : null}
              <div className="focus-alert-actions">
                {alert.action ? (
                  <button
                    type="button"
                    className="focus-alert-primary"
                    onClick={() => {
                      if (alert.action === "report") {
                        dismissAlert(alert.id);
                        onReport?.();
                      } else runAlert(alert);
                    }}
                  >
                    {copy.actionLabel ?? t.actions[alert.action]}
                  </button>
                ) : null}
                <button type="button" onClick={() => dismissAlert(alert.id)}>{ringing ? t.stop : t.dismiss}</button>
                {alert.kind !== "summary" ? <button type="button" className="focus-alert-open" onClick={() => { dismissAlert(alert.id); onOpen(); }}>{t.openTimer}</button> : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
