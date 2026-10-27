import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { JSDOM } from 'jsdom';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePosting } from '../../shared/posting';
import { fetchPublicPage } from './net';
import { htmlToPdf } from './pdf';

/*
  Optional local helper. The app itself runs entirely in the browser; browsers may not read
  other sites (CORS), so fetching a job posting from a link goes through this helper when it runs, and so does turning
  documents into PDFs with selectable text (pdf.ts).
  It also serves the built app (web/dist) for people who prefer `npm start` over hosting.
*/

// not PORT: dev tools set PORT for the web server, and the helper must stay on its own port
const PORT = Number(process.env.EASYCV_PORT ?? 4317);
// pages allowed to use the helper: local ones, plus a hosted copy of the app if you add its origin
const ORIGINS = [/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/, ...(process.env.EASYCV_ORIGINS ?? '').split(',').filter(Boolean).map(o => new RegExp(`^${o.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))];

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 8 * 1024 * 1024 });

app.addHook('onRequest', async (req, reply) => {
  // only answer when addressed as localhost: a web page that re-points its own domain at 127.0.0.1
  // ("DNS rebinding") arrives with that domain in the Host header
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host ?? '')) return reply.code(403).send({ error: 'Wrong host.' });
  const origin = req.headers.origin;
  if (!origin) return;
  if (!ORIGINS.some(r => r.test(origin))) return reply.code(403).send({ error: 'This page may not use the Easy Apply helper.' });
  reply.header('access-control-allow-origin', origin).header('vary', 'origin')
    .header('access-control-allow-methods', 'GET, POST').header('access-control-allow-headers', 'content-type')
    // Chrome asks public pages for permission before they talk to localhost; this answers its preflight
    .header('access-control-allow-private-network', 'true');
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  reply.code(err.statusCode && err.statusCode >= 400 ? err.statusCode : 500).send({ error: err.message });
});

app.get('/api/helper', async () => ({ ok: true, app: 'easy-cv', pdf: true }));

// one document's HTML (built by the app, fonts and styles inlined) → an A4 PDF with selectable text
app.post<{ Body: { html: string } }>('/api/pdf', async (req, reply) => {
  const html = String(req.body?.html ?? '');
  if (!html.includes('class="sheet')) throw Object.assign(new Error('Expected a document page.'), { statusCode: 400 });
  return reply.type('application/pdf').send(await htmlToPdf(html));
});

app.post<{ Body: { url: string } }>('/api/fetch-posting', async req => {
  const url = String(req.body?.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error('Enter a full link starting with http:// or https://'), { statusCode: 400 });
  const page = await fetchPublicPage(url);
  return parsePosting(page.html, page.url, (html, u) => new JSDOM(html, u ? { url: u } : {}).window.document);
});

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (await access(dist).then(() => true, () => false)) {
  await app.register(fastifyStatic, { root: dist });
  // pages (no file extension) fall back to the app; a missing file is a real 404. Answering a missing
  // /assets/… file with index.html would let a half-finished update cache a web page as code.
  app.setNotFoundHandler((req, reply) => {
    const p = req.url.split('?')[0];
    if (p.startsWith('/api/') || /\.[a-z0-9]+$/i.test(p)) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

// localhost only
await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`Easy Apply helper on http://localhost:${PORT}`);
