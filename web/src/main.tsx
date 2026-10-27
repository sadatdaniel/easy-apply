import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyAppearance, loadAppearance } from './appearance';
import { PrintView } from './PrintView';
import { ToastProvider } from './ui';
import './fonts';
import './styles.css';
import './themes.css';

// After an update accepted in another tab, code this tab loads on demand (PDF export, Word import) may no
// longer exist; reload into the new version instead of failing. At most once a minute, so it can't loop.
addEventListener('vite:preloadError', e => {
  // only when the offline cache serves the page: then a reload brings the new version, even offline
  if (!navigator.serviceWorker?.controller) return;
  try {
    const last = Number(sessionStorage.getItem('easy-apply.reloaded') ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('easy-apply.reloaded', String(Date.now()));
  } catch { return; }
  e.preventDefault();
  location.reload();
});

// look and accent before the first paint, so the app never flashes the default colours
applyAppearance(loadAppearance());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>{location.pathname === '/print' ? <PrintView /> : <App />}</ToastProvider>
  </StrictMode>,
);
