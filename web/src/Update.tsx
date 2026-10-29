/// <reference types="vite-plugin-pwa/react" />
import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_EVERY = 60 * 60 * 1000; // also checks on every launch

/**
  The app is cached for offline use. When a new version is published it downloads in the background
  and waits; this banner lets the user switch when it suits them, so nothing reloads mid-edit.
  On the very first visit it shows how far the offline copy has got (the app works meanwhile).
*/
export function UpdateBanner() {
  const [saving, setSaving] = useState<number | null>(null);
  const stopTracking = useRef<() => void>();
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(url, reg) {
      if (reg) setInterval(() => { if (navigator.onLine) reg.update(); }, CHECK_EVERY);
      // first visit: nothing cached yet, the offline copy is being made
      if (reg && !reg.active && !navigator.serviceWorker.controller) track(url).then(stop => { stopTracking.current = stop; });
    },
  });
  /** the share of the app's files already in the offline cache, every second, until it's complete */
  async function track(url: string) {
    const total = ((await (await fetch(url)).text()).match(/\{url:"/g) ?? []).length;
    if (!total) return () => {};
    setSaving(0);
    const t = setInterval(async () => {
      const name = (await caches.keys()).find(k => k.includes('precache'));
      const done = name ? (await (await caches.open(name)).keys()).length : 0;
      setSaving(Math.min(99, Math.round((done / total) * 100)));
    }, 1000);
    return () => clearInterval(t);
  }
  useEffect(() => { if (offlineReady) { stopTracking.current?.(); setSaving(null); } }, [offlineReady]);

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
  if (saving !== null) return (
    <div className="update" role="status" title="You can use Easy Apply meanwhile">
      <span className="spin" /><span>Saving Easy Apply for offline use… {saving}%</span>
    </div>
  );
  return null;
}
