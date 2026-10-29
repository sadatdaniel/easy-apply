import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../../functions/api/fetch-posting';
import { fetchPostingPage, MAX_PAGE_BYTES, privateLiteral } from '../../shared/fetchpage';

/** a fake network: url → response */
const net = (pages: Record<string, () => Response>) => {
  const seen: string[] = [];
  const get = (async (u: string) => { seen.push(u); const p = pages[u]; if (!p) throw new TypeError('no route'); return p(); }) as unknown as typeof fetch;
  return { get, seen };
};
const html = (body: string, headers: Record<string, string> = {}) => new Response(body, { headers: { 'content-type': 'text/html', ...headers } });

describe('posting fetcher (Cloudflare Pages Function)', () => {
  it('fetches a public page and follows redirects', async () => {
    const n = net({
      'https://jobs.example.com/1': () => new Response(null, { status: 302, headers: { location: '/ad/1' } }),
      'https://jobs.example.com/ad/1': () => html('<h1>Data Engineer</h1>'),
    });
    expect(await fetchPostingPage('https://jobs.example.com/1', n.get)).toEqual({ url: 'https://jobs.example.com/ad/1', html: '<h1>Data Engineer</h1>' });
  });

  it('never reaches this computer or the local network, not even through a redirect', async () => {
    for (const bad of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data',
      'http://2130706433/', 'http://0x7f.1/', 'http://printer.local/', 'file:///etc/passwd', 'https://user:pw@example.com/', 'http://example.com:8080/'])
      await expect(fetchPostingPage(bad, net({}).get), bad).rejects.toMatchObject({ status: 400 });
    const n = net({ 'https://evil.example/': () => new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/admin' } }) });
    await expect(fetchPostingPage('https://evil.example/', n.get)).rejects.toThrow(/private or local/);
    expect(n.seen).toEqual(['https://evil.example/']);
    expect(privateLiteral('jobs.example.com')).toBe(false);
    expect(privateLiteral('8.8.8.8')).toBe(false);
  });

  it('stops at too many redirects, a blocked site, a non-page or a huge page', async () => {
    const loop = net({ 'https://a.example/': () => new Response(null, { status: 302, headers: { location: 'https://a.example/' } }) });
    await expect(fetchPostingPage('https://a.example/', loop.get)).rejects.toMatchObject({ status: 508 });
    await expect(fetchPostingPage('https://b.example/', net({ 'https://b.example/': () => new Response('no', { status: 403 }) }).get)).rejects.toThrow(/Paste the posting text/);
    await expect(fetchPostingPage('https://c.example/', net({ 'https://c.example/': () => new Response('x', { headers: { 'content-type': 'application/zip' } }) }).get)).rejects.toMatchObject({ status: 415 });
    const big = new Uint8Array(MAX_PAGE_BYTES + 10);
    await expect(fetchPostingPage('https://d.example/', net({ 'https://d.example/': () => new Response(big, { headers: { 'content-type': 'text/html' } }) }).get)).rejects.toMatchObject({ status: 413 });
  });

  it('only answers the app itself, so it is no proxy for other sites', async () => {
    const req = (origin: string | null, body: string) => new Request('https://easy-apply.pages.dev/api/fetch-posting', { method: 'POST', headers: origin ? { origin, 'content-type': 'application/json' } : {}, body });
    expect((await onRequestPost({ request: req('https://other.example', '{"url":"https://jobs.example.com/"}') })).status).toBe(403);
    expect((await onRequestPost({ request: req(null, '{"url":"https://jobs.example.com/"}') })).status).toBe(403);
    expect((await onRequestPost({ request: req('https://easy-apply.pages.dev', 'not json') })).status).toBe(400);
    const r = await onRequestPost({ request: req('https://easy-apply.pages.dev', '{"url":"http://127.0.0.1/"}') });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toMatch(/private or local/);
  });
});
