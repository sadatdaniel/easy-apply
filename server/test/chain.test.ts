import { afterEach, describe, expect, it, vi } from 'vitest';
import { chainAsk, freeAt, type UsageStore } from '../../shared/chain';
import type { ProviderEntry, Usage } from '../../shared/types';

const entry = (id: string, preset: string, extra: Partial<ProviderEntry> = {}): ProviderEntry => ({
  id, enabled: true, provider: preset === 'gemini' ? 'gemini' : 'openai', preset,
  baseURL: `https://${id}.test/v1`, apiKey: 'k', model: 'm', timeoutSec: 1, perMinute: null, perDay: null, ...extra,
});
/** usage kept in memory; `.u` shows what was last saved */
function memory(initial: Usage = {}) {
  let u = initial;
  const s: UsageStore & { readonly u: Usage } = { get u() { return u; }, load: async () => structuredClone(u), update: async fn => { const x = structuredClone(u); fn(x); u = x; } };
  return s;
}
let store: ReturnType<typeof memory>;

/** fake providers: each base URL answers the way the test says */
function fakeFetch(answers: Record<string, 'ok' | 'rate' | 'hang' | 'down' | 'auth'>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const host = new URL(url).host.replace('.test', '');
    calls.push(host);
    const a = answers[host];
    if (a === 'down') throw new TypeError('Failed to fetch');
    if (a === 'hang') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
    if (a === 'rate') return new Response('{"error":{"details":[{"retryDelay":"2s"}]}}', { status: 429 });
    if (a === 'auth') return new Response('bad key', { status: 401 });
    return new Response(JSON.stringify({ choices: [{ message: { content: `hi from ${host}` } }] }), { status: 200 });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('fallback chain', () => {
  it('skips a rate-limited and a hanging provider, then answers from the next', async () => {
    store = memory();
    const calls = fakeFetch({ a: 'rate', b: 'hang', c: 'ok' });
    const status: string[] = [];
    const ask = chainAsk([entry('a', 'openrouter'), entry('b', 'openai'), entry('c', 'ollama')], store, s => status.push(s));
    expect(await ask('sys', 'user', { json: false })).toBe('hi from c');
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(store.u.a.coolUntil).toBeGreaterThan(Date.now()); // cools down for the 2s the provider asked for
    expect(store.u.b.last?.note).toMatch(/did not answer in time/);
    expect(status.at(-1)).toBe('');
  });

  it('does not count a request that never reached the provider', async () => {
    store = memory();
    fakeFetch({ a: 'down', b: 'ok' });
    await chainAsk([entry('a', 'ollama'), entry('b', 'openai')], store)('s', 'u', { json: false });
    expect(store.u.a.at).toHaveLength(0);
    expect(store.u.b.at).toHaveLength(1);
  });

  it('respects a per-minute limit by skipping, without calling the provider', async () => {
    const now = Date.now();
    store = memory({ a: { at: [now - 5_000, now - 3_000] } });
    const calls = fakeFetch({ a: 'ok', b: 'ok' });
    const out = await chainAsk([entry('a', 'gemini', { perMinute: 2 }), entry('b', 'openai')], store)('s', 'u', { json: false });
    expect(out).toBe('hi from b');
    expect(calls).toEqual(['b']);
  });

  it('waits for the next free slot instead of going over', async () => {
    const now = Date.now();
    store = memory({ a: { at: [now - 58_500] } }); // free again in ~1.5s
    fakeFetch({ a: 'ok' });
    const status: string[] = [];
    const t0 = Date.now();
    const out = await chainAsk([entry('a', 'openrouter', { perMinute: 1 })], store, s => status.push(s))('s', 'u', { json: false });
    expect(out).toBe('hi from a');
    expect(Date.now() - t0).toBeGreaterThan(1000);
    expect(status.some(s => s.startsWith('Waiting'))).toBe(true);
  });

  it('explains every reason when nobody can answer', async () => {
    const now = Date.now();
    store = memory({ c: { at: Array.from({ length: 3 }, (_, i) => now - 1000 * (i + 1)) } });
    fakeFetch({ a: 'auth', b: 'down', c: 'ok' });
    const ask = chainAsk([entry('a', 'openai'), entry('b', 'ollama'), entry('c', 'gemini', { perDay: 3 })], store, () => {}, 5_000);
    await expect(ask('s', 'u', { json: false })).rejects.toThrow(/refused the key.*could not reach.*at your limit, free in/);
  });

  it('freeAt: the per-day limit frees one slot 24 h after the oldest counted request', () => {
    const now = Date.now();
    const p = entry('a', 'gemini', { perDay: 2 });
    expect(freeAt(p, { at: [now - 1000] }, now)).toBe(0);
    expect(freeAt(p, { at: [now - 3_600_000, now - 1000] }, now)).toBe(now - 3_600_000 + 86_400_000);
  });
});
