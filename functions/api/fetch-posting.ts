// Cloudflare Pages Function: POST /api/fetch-posting { url } → { url, html } (see shared/fetchpage.ts).
// Only the app's own pages may use it, so it can't serve as a free proxy for other sites.
import { fetchPostingPage } from '../../shared/fetchpage';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'This page may not use the posting fetcher.' }, 403);
  let body: { url?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Send { "url": "https://…" }.' }, 400); }
  try {
    return json(await fetchPostingPage(String(body.url ?? '')));
  } catch (e) {
    return json({ error: (e as Error).message }, (e as { status?: number }).status ?? 502);
  }
}
