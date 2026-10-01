"use client";

import { useState } from "react";
import { AlarmClock, BellRing, Coffee, PartyPopper, PauseCircle } from "lucide-react";
import { focusColorStyle } from "@/lib/focus-colors";
import { MAX_SESSION_NOTE } from "@/lib/work-log";
import { useFocus, useFocusClock, type FocusAlert } from "./focus-provider";

const actionLabel: Record<NonNullable<FocusAlert["action"]>, string> = {
  "start-next": "Start",
  "skip-break": "Skip the break",
  restart: "Start again",
  extend: "One more minute",
  snooze: "Snooze 5 minutes",
  resume: "Resume",
};

const icons = { phase: Coffee, done: PartyPopper, timer: BellRing, alarm: AlarmClock, notice: PauseCircle } as const;

/**
 * Tur bitince tek satır: "ne yaptın?". İsteğe bağlı; yazılan, turun
 * oturumuna gidiyor ve takvimde, haftalık raporda görünüyor.
 */
function RoundNote({ endAt }: { endAt: number }) {
  const { noteRound } = useFocus();
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<string>();
  if (saved) return <p className="focus-alert-note-saved" role="status">Noted: {saved}</p>;
  return (
    <form
      className="focus-alert-note"
      onSubmit={(event) => {
        event.preventDefault();
        if (noteRound(endAt, draft)) setSaved(draft.trim());
      }}
    >
      <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MAX_SESSION_NOTE} placeholder="What did you do? (optional)" aria-label="What did you do in this round?" />
      <button type="submit" disabled={!draft.trim()}>Save</button>
    </form>
  );
}

/**
 * Zamanlayıcının bildirimleri, her ekranda: tur bitti, mola başladı, süre
 * doldu, alarm çalıyor. Zil çalarken "Stop" hem zili hem bildirimi kapatıyor.
 */
export function FocusAlerts({ onOpen }: { onOpen: () => void }) {
  const { store, dismissAlert, runAlert } = useFocus();
  const now = useFocusClock();
  if (!store.alerts.length) return null;
  return (
    <div className="focus-alerts">
      {store.alerts.map((alert) => {
        const Icon = icons[alert.kind];
        const ringing = alert.ringUntil > now;
        return (
          <section
            key={alert.id}
            className={`focus-alert${ringing ? " is-ringing" : ""}`}
            style={focusColorStyle(alert.color)}
            role={ringing ? "alert" : "status"}
            aria-label={alert.title}
          >
            <span className="focus-alert-icon" aria-hidden="true"><Icon size={18} /></span>
            <div className="focus-alert-copy">
              <strong>{alert.title}</strong>
              {alert.body ? <p>{alert.body}</p> : null}
              {alert.roundEnd ? <RoundNote endAt={alert.roundEnd} /> : null}
              <div className="focus-alert-actions">
                {alert.action ? (
                  <button type="button" className="focus-alert-primary" onClick={() => runAlert(alert)}>
                    {alert.actionLabel ?? actionLabel[alert.action]}
                  </button>
                ) : null}
                <button type="button" onClick={() => dismissAlert(alert.id)}>{ringing ? "Stop" : "Dismiss"}</button>
                <button type="button" className="focus-alert-open" onClick={() => { dismissAlert(alert.id); onOpen(); }}>Open the timer</button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
