/*
  Fetching a job posting's page for the browser, which may not read other sites itself. Runs as a Cloudflare
  Pages Function (functions/api/fetch-posting.ts), next to the hosted app. Only the posting's link goes out;
  never a document. A link is untrusted input, so: only http(s), no user names or passwords, no local or
  private addresses (checked again at every redirect), a time limit and a size limit. Cloudflare itself
  refuses connections to private networks, so a public name that points to one fails there too.
*/

export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

/** an IP address written in the link (not a name) that is not on the public internet */
export function privateLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b, c] = m.slice(1).map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (h.includes(':')) {
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateLiteral(mapped[1]);
    return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || /^ff/.test(h) || h.startsWith('64:ff9b:') || h.startsWith('2001:db8');
  }
  // numbers written another way ("2130706433", "0x7f.1") are refused rather than decoded
  return /^[0-9x.]+$/.test(h) || /(^|\.)(localhost|local|internal|home\.arpa)$/.test(h);
}

/** GET a public web page as text, following up to 5 redirects, at most MAX_PAGE_BYTES */
export async function fetchPostingPage(raw: string, get: typeof fetch = fetch): Promise<{ url: string; html: string }> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw fail('That is not a valid link.', 400); }
  for (let hop = 0; hop <= 5; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw fail('Only http:// and https:// links can be fetched.', 400);
    if (url.username || url.password) throw fail('Links with a user name or password are not supported.', 400);
    if (url.port && !['80', '443'].includes(url.port)) throw fail('Only links on the usual web ports can be fetched.', 400);
    if (privateLiteral(url.hostname)) throw fail(`Only public web addresses can be fetched (${url.hostname} is a private or local address).`, 400);
    let r: Response;
    try {
      r = await get(url.toString(), {
        redirect: 'manual', signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'accept-language': 'en,de;q=0.8', accept: 'text/html,application/xhtml+xml' },
      });
    } catch (e) {
      throw (e as Error).name === 'TimeoutError' ? fail('The site took too long to answer. Paste the posting text instead.', 504)
        : fail('Could not load the page. Paste the posting text instead.', 502);
    }
    const next = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (next) { await r.body?.cancel(); url = new URL(next, url); continue; }
    if (!r.ok) {
      await r.body?.cancel();
      throw fail(r.status === 403 || r.status === 401 || r.status === 429
        ? 'This site does not let other programs read its job ads. Paste the posting text instead.'
        : `The site answered ${r.status}. Paste the posting text instead.`, 502);
    }
    const type = r.headers.get('content-type') ?? '';
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) { await r.body?.cancel(); throw fail('That link is not a web page. Paste the posting text instead.', 415); }
    // read at most MAX_PAGE_BYTES, whatever the page says about its length
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) { await reader.cancel(); throw fail('That page is too large. Paste the posting text instead.', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    return { url: url.toString(), html: new TextDecoder().decode(bytes) };
  }
  throw fail('The link redirects too often. Paste the posting text instead.', 508);
}
