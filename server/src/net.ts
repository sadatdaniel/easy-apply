import { lookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch } from 'undici';

/*
  Fetching job postings for the browser. A link is untrusted input, so the helper must never be usable to
  reach this computer or the local network ("SSRF"). Checking the typed host isn't enough: a public name can
  resolve to 127.0.0.1, and a public page can redirect to a private one. So the address is checked at the
  moment each connection is made (every redirect is a new connection), on the IPs DNS actually returned.
*/

const v4 = (ip: string) => ip.split('.').map(Number);

/** true only for addresses on the public internet */
export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = v4(ip);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 // this network, private, loopback, multicast + reserved
      || (a === 100 && b >= 64 && b <= 127)                // carrier-grade NAT
      || (a === 169 && b === 254)                          // link-local (incl. cloud metadata 169.254.169.254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && v4(ip)[2] === 0)         // IETF protocol assignments
      || (a === 198 && (b === 18 || b === 19)));           // benchmarking
  }
  if (kind === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    return !(s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8'));
  }
  return false;
}

export class BlockedAddress extends Error { statusCode = 400; constructor(host: string) { super(`Only public web addresses can be fetched (${host} points to a private or local address).`); } }

/** DNS lookup that refuses private answers; used for every connection the agent opens */
function safeLookup(hostname: string, options: { all?: boolean; family?: number }, cb: (err: Error | null, address?: string | LookupAddress[], family?: number) => void) {
  lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some(a => !isPublicIp(a.address))) return cb(new BlockedAddress(hostname));
    if (options.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup as never }, headersTimeout: 15_000, bodyTimeout: 15_000 });

export const MAX_PAGE_BYTES = 5 * 1024 * 1024;

/** GET a public web page as text, following up to 5 redirects, at most MAX_PAGE_BYTES. */
export async function fetchPublicPage(raw: string): Promise<{ url: string; html: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('That is not a valid link.'), { statusCode: 400 }); }
  for (let hop = 0; hop <= 5; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Only http:// and https:// links can be fetched.'), { statusCode: 400 });
    if (url.username || url.password) throw Object.assign(new Error('Links with a user name or password are not supported.'), { statusCode: 400 });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // IP literals never go through DNS, so check them here; names are checked by safeLookup
    if (isIP(host) && !isPublicIp(host)) throw new BlockedAddress(host);
    if (!isIP(host) && /(^|\.)(localhost|local|internal|home\.arpa)$/i.test(host)) throw new BlockedAddress(host);

    let r;
    try {
      r = await fetch(url, {
        dispatcher: agent, redirect: 'manual', signal: AbortSignal.timeout(20_000),
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'accept-language': 'en,de;q=0.8', accept: 'text/html,application/xhtml+xml' },
      });
    } catch (e) {
      const cause = (e as { cause?: unknown }).cause;
      if (cause instanceof BlockedAddress) throw cause;
      if ((e as Error).name === 'TimeoutError') throw Object.assign(new Error('The site took too long to answer. Paste the posting text instead.'), { statusCode: 504 });
      throw Object.assign(new Error(`Could not load the page (${(cause as Error)?.message ?? (e as Error).message}). Paste the posting text instead.`), { statusCode: 502 });
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      await r.body?.cancel();
      url = new URL(r.headers.get('location')!, url);
      continue;
    }
    if (!r.ok) { await r.body?.cancel(); throw Object.assign(new Error(`The site answered ${r.status}. Paste the posting text instead.`), { statusCode: 502 }); }
    const type = r.headers.get('content-type') ?? '';
    if (type && !/html|xml|text\/plain/i.test(type)) { await r.body?.cancel(); throw Object.assign(new Error(`That link is not a web page (${type.split(';')[0]}). Paste the posting text instead.`), { statusCode: 415 }); }
    return { url: url.href, html: await readCapped(r.body, MAX_PAGE_BYTES) };
  }
  throw Object.assign(new Error('Too many redirects. Paste the posting text instead.'), { statusCode: 502 });
}

type ByteStream = AsyncIterable<Uint8Array> & { cancel(reason?: unknown): Promise<void> };
async function readCapped(body: ByteStream | null, max: number): Promise<string> {
  if (!body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of body) {
    size += c.byteLength;
    if (size > max) { await body.cancel().catch(() => {}); throw Object.assign(new Error('That page is too large to read. Paste the posting text instead.'), { statusCode: 413 }); }
    chunks.push(c);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
