import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

/*
  Production only (the dev server needs inline scripts): only the app's own scripts may run, so even a
  rendering bug can't execute injected code. AI calls may go to any http(s) address the user configures
  (local models, cloud providers, the local helper); PDF previews are blob: frames.
*/
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", "connect-src 'self' http: https: blob: data:", "frame-src blob:", "worker-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'none'",
].join('; ');
const csp = { name: 'csp', apply: 'build' as const, transformIndexHtml: (html: string) => html.replace('<head>', `<head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`) };

// where the app is served: "/" locally, "/easy-apply/" on GitHub Pages
const BASE = process.env.EASYCV_BASE ?? '/';

export default defineConfig({
  base: BASE,
  // shown in Settings, so you can tell which version is running (and that an update arrived)
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 19).replace('T', ' ')) },
  plugins: [
    react(),
    csp,
    // installable, offline after the first visit; new versions wait for the user's "Reload"
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Easy Apply',
        short_name: 'Easy Apply',
        description: 'Tailor your CV and cover letter for every job, and keep track of your applications.',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#f4f5f7',
        theme_color: '#eceef1',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // .woff2 is what pages show; .woff is what PDFs embed (the PDF library reads it reliably)
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,woff}'],
        navigateFallback: `${BASE}index.html`, // deep links work offline too
        // control the page from the very first visit, so on-demand code (PDF export, Word import) works offline
        // even in the tab that installed the app; later updates still wait for the user's "Reload"
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared') } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
  },
});
