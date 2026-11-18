import { useEffect, useState, useSyncExternalStore } from 'react';

// ---- Installed-app support (see public/sw.js and public/manifest.webmanifest) ----
// The service worker is only used in a production build: in development it would serve stale code.

let waitingWorker = null;
let installEvent = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // The browser offers to install the app: keep the offer for our own "Install app" button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    notify();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const offer = (worker) => {
        // Only an update: on the first install there's nothing older to replace.
        if (worker && navigator.serviceWorker.controller) {
          waitingWorker = worker;
          notify();
        }
      };
      offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => worker.state === 'installed' && offer(worker));
      });
      // Long-open tabs and installed apps look for a new version every hour, and when brought back to the front.
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
    } catch (err) {
      console.warn('Service worker not registered:', err);
    }
  });

  // Once the new worker has taken over, reload once so the page runs the new version.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

// A new version is ready: applyUpdate() switches to it and reloads.
export const useUpdateReady = () => useSyncExternalStore(subscribe, () => Boolean(waitingWorker));
export const applyUpdate = () => waitingWorker?.postMessage('skip-waiting');

// The browser's install offer, when there is one (Chrome, Edge, Samsung Internet; not iOS Safari).
export const useCanInstall = () => useSyncExternalStore(subscribe, () => Boolean(installEvent));
export async function promptInstall() {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  notify();
}

// Running as the installed app (its own window), rather than in a browser tab.
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// iPhone and iPad have no install button; people add the app with Share → Add to Home Screen.
export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
