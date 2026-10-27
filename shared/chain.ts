import { AiError, call, PRESETS, type Ask } from './ai';
import type { ProviderEntry, ProviderUsage, Usage } from './types';

/*
  The fallback chain. Every AI request walks the user's providers in order:
  - a provider at its own per-minute or per-24-hour limit, or cooling down after a 429, is skipped;
  - one that times out, can't be reached, refuses the key or errors is skipped for this request;
  - the first answer wins.
  If nobody can answer only because of limits, it waits for the earliest free slot (up to a minute)
  rather than going over a free tier. Usage is counted locally, so limits hold across reloads.
*/
const MIN = 60_000, DAY = 86_400_000;

/** `update` must be atomic: requests running in parallel each count, none overwrites another */
export interface UsageStore { load(): Promise<Usage>; update(fn: (u: Usage) => void): Promise<void> }
export type OnStatus = (msg: string) => void;

export const providerLabel = (p: ProviderEntry) => `${PRESETS[p.preset]?.label.replace(/ \(local\)$/, '') ?? p.preset} · ${p.model}`;
const shortName = (p: ProviderEntry) => PRESETS[p.preset]?.label.replace(/ \(local\)$/, '') ?? p.preset;

const recent = (u: ProviderUsage | undefined, now: number) => (u?.at ?? []).filter(t => now - t < DAY).sort((a, b) => a - b);

/** When this provider may be asked again: 0 = now. */
export function freeAt(p: ProviderEntry, u: ProviderUsage | undefined, now = Date.now()): number {
  const at = recent(u, now);
  let t = u?.coolUntil && u.coolUntil > now ? u.coolUntil : 0;
  if (p.perMinute) {
    const lastMin = at.filter(x => now - x < MIN);
    if (lastMin.length >= p.perMinute) t = Math.max(t, lastMin[lastMin.length - p.perMinute] + MIN);
  }
  if (p.perDay && at.length >= p.perDay) t = Math.max(t, at[at.length - p.perDay] + DAY);
  return t;
}

export const usedToday = (u: ProviderUsage | undefined, now = Date.now()) => recent(u, now).length;
export const usedThisMinute = (u: ProviderUsage | undefined, now = Date.now()) => recent(u, now).filter(x => now - x < MIN).length;

export function inWords(ms: number) {
  const s = Math.ceil(ms / 1000);
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

/** Free-tier numbers to start from. Providers change these, so they are only suggestions the user can edit. */
export function suggestedLimits(preset: string, model: string): { perMinute: number | null; perDay: number | null; timeoutSec: number; note: string } {
  const local = preset === 'ollama' || preset === 'lmstudio';
  const timeoutSec = local ? 180 : 45;
  if (preset === 'gemini') return /pro/i.test(model)
    ? { perMinute: 5, perDay: 100, timeoutSec, note: 'Gemini free tier for Pro models. Check your current limits in Google AI Studio.' }
    : { perMinute: 10, perDay: 250, timeoutSec, note: 'Gemini free tier for Flash models. Check your current limits in Google AI Studio.' };
  if (preset === 'openrouter' && /:free$/.test(model))
    return { perMinute: 20, perDay: 50, timeoutSec, note: 'OpenRouter free models: 20 a minute, 50 a day (1000 a day once you have bought $10 of credits).' };
  return { perMinute: null, perDay: null, timeoutSec, note: local ? 'Runs on this computer: no limits.' : 'Paid API: set limits only if you want a budget.' };
}

export function chainAsk(providers: ProviderEntry[], store: UsageStore, onStatus: OnStatus = () => {}, maxWaitMs = 65_000): Ask {
  return async (system, user, opts) => {
    const list = providers.filter(p => p.enabled && p.model);
    if (!list.length) throw new Error('Set up an AI provider in Settings first.');
    const failedNow = new Set<string>(); // gave a real error during this request: don't ask again
    const notes = new Map<string, string>();
    const started = Date.now();

    try {
      for (;;) {
        let soonest: { at: number; p: ProviderEntry } | null = null;
        for (const p of list) {
          if (failedNow.has(p.id)) continue;
          const now = Date.now();
          const usage = await store.load();
          const u = usage[p.id] ?? { at: [] };
          const free = freeAt(p, u, now);
          if (free > now) {
            notes.set(p.id, `${shortName(p)}: ${u.coolUntil && u.coolUntil > now ? 'cooling down after a rate limit' : 'at your limit'}, free in ${inWords(free - now)}`);
            if (!soonest || free < soonest.at) soonest = { at: free, p };
            continue;
          }
          // count the request before sending it, so parallel requests see it too
          await record(store, p.id, x => { x.at = [...recent(x, now), now]; });
          onStatus(`Asking ${shortName(p)}…`);
          try {
            const text = await call(p, system, user, opts.json, p.timeoutSec * 1000, opts.temperature);
            await record(store, p.id, u => { u.last = { ok: true, at: Date.now(), note: '' }; });
            return text;
          } catch (e) {
            if (!(e instanceof AiError)) throw e;
            await record(store, p.id, u => {
              u.last = { ok: false, at: Date.now(), note: e.message };
              if (e.kind === 'rate') u.coolUntil = Date.now() + e.retryAfterMs;
              if (e.kind === 'unreachable') u.at = u.at.filter(t => t !== now); // it never reached the provider
            });
            notes.set(p.id, `${shortName(p)}: ${e.message}`);
            if (e.kind === 'rate') { if (!soonest || Date.now() + e.retryAfterMs < soonest.at) soonest = { at: Date.now() + e.retryAfterMs, p }; }
            else failedNow.add(p.id);
          }
        }
        // nobody answered; wait if a limited provider frees up soon enough, otherwise explain
        const wait = soonest ? soonest.at - Date.now() : Infinity;
        if (!soonest || Date.now() + wait - started > maxWaitMs) {
          throw new Error(`No AI provider could answer. ${[...notes.values()].join(' · ')}.`);
        }
        for (let left = wait; left > 0; left -= 1000) {
          onStatus(`Waiting ${inWords(left)} for ${shortName(soonest.p)}'s limit…`);
          await new Promise(r => setTimeout(r, Math.min(1000, left)));
        }
      }
    } finally {
      onStatus('');
    }
  };
}

const record = (store: UsageStore, id: string, fn: (u: ProviderUsage) => void) =>
  store.update(usage => { const u = usage[id] ?? { at: [] }; fn(u); usage[id] = u; });
