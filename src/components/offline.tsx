"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Trash2, WifiOff } from "lucide-react";
import { useT } from "@/i18n/client";

/**
 * Kurulabilir uygulama ve çevrimdışı okuma (`public/sw.js`, `app/manifest.ts`).
 *
 * Servis çalışanı yalnızca derlenmiş uygulamada kayıtlı: geliştirmede her
 * değişikliği eski bir kopyanın arkasında görmek kafa karıştırırdı.
 * Tarayıcının "uygulama olarak kur" isteği (`beforeinstallprompt`) sayfa
 * açılırken bir kez geliyor; burada tutuluyor, Profil'deki düğme sonra
 * kullanıyor. Safari bu isteği hiç göndermiyor; orada Paylaş → Ana Ekrana Ekle.
 */

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferredInstall: InstallPrompt | undefined;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach((listener) => listener());

export function ServiceWorkerRegistration() {
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferredInstall = event as InstallPrompt;
      notifyInstall();
    };
    const onInstalled = () => {
      deferredInstall = undefined;
      notifyInstall();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** Tarayıcı çevrimiçi mi; sunucuda ve ilk çizimde `true`. */
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Her ekranın altında: çevrimdışıyken ne gösterildiğini ve neyin kaydedilemeyeceğini söylüyor. */
export function OfflineNotice() {
  const t = useT().studio.offline;
  const online = useOnline();
  if (online) return null;
  return (
    <p className="offline-notice" role="status">
      <WifiOff size={14} aria-hidden="true" /> {t.notice}
    </p>
  );
}

function useInstallPrompt() {
  return useSyncExternalStore(
    (listener) => {
      installListeners.add(listener);
      return () => installListeners.delete(listener);
    },
    () => deferredInstall,
    () => undefined,
  );
}

/** Profil'de: uygulama olarak kurmak ve bu tarayıcıdaki çevrimdışı kopya. */
export function ThisDeviceCard() {
  const t = useT().studio.offline;
  const install = useInstallPrompt();
  const [state, setState] = useState<{ installed: boolean; worker: boolean; apple: boolean }>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const read = setTimeout(() => {
      setState({
        installed: window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
        worker: Boolean(navigator.serviceWorker?.controller),
        apple: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      });
    }, 0);
    return () => clearTimeout(read);
  }, []);

  async function forget() {
    const worker = navigator.serviceWorker?.controller;
    if (worker) worker.postMessage({ type: "trace:forget-offline-copy" });
    // Servis çalışanı olmasa da: bu sayfanın görebildiği saklanan kopyalar siliniyor.
    for (const name of (await caches.keys()).filter((key) => key.startsWith("trace-data-") || key.startsWith("trace-shell-"))) await caches.delete(name);
    setMessage(t.forgotten);
  }

  if (!state) return null;
  return (
    <section className="stats-block profile-device" aria-label={t.thisDevice}>
      <h2>{t.thisDevice}</h2>
      <p>
        {state.installed ? t.installed : t.installable}{" "}
        {state.worker ? t.workerOn : t.workerOff}
      </p>
      <div className="profile-form-actions">
        {install && !state.installed ? (
          <button
            type="button"
            className="focus-secondary"
            onClick={() => {
              void install.prompt();
              void install.userChoice.then(() => {
                deferredInstall = undefined;
                notifyInstall();
              });
            }}
          >
            <Download size={14} /> {t.install}
          </button>
        ) : null}
        {state.worker ? (
          <button type="button" className="focus-secondary" onClick={() => void forget()}>
            <Trash2 size={14} /> {t.forget}
          </button>
        ) : null}
      </div>
      {!install && !state.installed && state.apple ? <p className="stats-note">{t.apple}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
