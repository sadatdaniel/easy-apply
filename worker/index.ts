// Cloudflare Worker: the posting fetcher at /api/fetch-posting; everything else is the built app's files.
import { onRequestPost } from '../functions/api/fetch-posting';

interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/fetch-posting') {
      return request.method === 'POST' ? onRequestPost({ request }) : new Response('Use POST.', { status: 405, headers: { allow: 'POST' } });
    }
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
