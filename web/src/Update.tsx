/// <reference types="vite-plugin-pwa/react" />
import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_EVERY = 60 * 60 * 1000; // also checks on every launch

/**
  The app is cached for offline use. When a new version is published it downloads in the background
  and waits; this banner lets the user switch when it suits them, so nothing reloads mid-edit.
*/
export function UpdateBanner() {
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => { if (navigator.onLine) reg.update(); }, CHECK_EVERY);
    },
  });
  if (needRefresh) return (
    <div className="update" role="status">
      <span>A new version of Easy Apply is ready.</span>
      <button className="btn pri" onClick={() => updateServiceWorker(true)}>Reload</button>
      <button className="btn" onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  );
  if (offlineReady) return (
    <div className="update" role="status">
      <span>Easy Apply now works offline.</span>
      <button className="btn" onClick={() => setOfflineReady(false)}>OK</button>
    </div>
  );
  return null;
}
