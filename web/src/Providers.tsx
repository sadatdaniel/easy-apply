import { useEffect, useMemo, useRef, useState } from 'react';
import { freeAt, inWords, providerLabel, suggestedLimits, usedThisMinute, usedToday } from '@shared/chain';
import type { ProviderEntry, Usage } from '@shared/types';
import { api, type Preset } from './api';
import { useAction } from './ui';

type Data = { providers: ProviderEntry[]; usage: Usage; presets: Record<string, Preset> };

/**
  Settings › AI providers: the fallback chain. Tried top to bottom; a provider at its limit, cooling down
  or failing is skipped. Drag (or use the arrows) to reorder.
*/
export function Providers({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<ProviderEntry | null>(null);
  const [addPreset, setAddPreset] = useState('gemini');
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState<string | null>(null);
  const dragged = useRef<string | null>(null);
  const run = useAction();

  const load = () => api.providers().then(setData);
  useEffect(() => {
    load();
    // counters and "free in …" tick while the page is open
    const t = setInterval(() => { setNow(Date.now()); api.providers().then(d => setData(x => x && { ...x, usage: d.usage })); }, 5000);
    return () => clearInterval(t);
  }, []);
  if (!data) return <p className="muted">Loading…</p>;
  const { providers: list, usage, presets } = data;

  const changed = async () => { await load(); onChanged(); };
  const order = async (ids: string[]) => { setData({ ...data, providers: ids.map(id => list.find(p => p.id === id)!) }); await run(() => api.orderProviders(ids)); changed(); };
  const move = (i: number, d: number) => { const ids = list.map(p => p.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; order(ids); };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        Tried from the top. If one is slow, failing or at its limit, the next one answers. If all of them are at their limits,
        Easy Apply waits for the next free slot (up to a minute) instead of going over.
      </p>

      {list.length > 0 && <div className="plist">
        {list.map((p, i) => {
          const u = usage[p.id];
          const free = freeAt(p, u, now);
          const state = !p.enabled ? { cls: 'off', text: 'Off' }
            : free > now ? { cls: 'wait', text: `${u?.coolUntil && u.coolUntil > now ? 'Rate-limited' : 'At limit'} · free in ${inWords(free - now)}` }
            : u?.last && !u.last.ok && now - u.last.at < 10 * 60_000 ? { cls: 'err', text: 'Last try failed' }
            : { cls: 'ok', text: 'Ready' };
          return (
            <div key={p.id} className={'prow' + (p.enabled ? '' : ' disabled')} draggable
              onDragStart={() => { dragged.current = p.id; }}
              onDragOver={e => { e.preventDefault(); const from = dragged.current; if (!from || from === p.id) return; const ids = list.map(x => x.id).filter(x => x !== from); ids.splice(i, 0, from); setData({ ...data, providers: ids.map(id => list.find(x => x.id === id)!) }); }}
              onDrop={() => { dragged.current = null; order(list.map(x => x.id)); }}>
              <span className="h" title="Drag to reorder">⋮⋮</span>
              <span className="n">{i + 1}</span>
              <span className="tx">
                <b>{providerLabel(p)}</b>
                <small>{limitsText(p, u, now)} · timeout {p.timeoutSec}s</small>
                <small className={'st ' + state.cls} title={u?.last && !u.last.ok ? u.last.note : undefined}>● {state.text}{state.cls === 'err' && u?.last ? `: ${u.last.note}` : ''}</small>
              </span>
              <span className="acts">
                <button className="btn sm" disabled={i === 0} onClick={() => move(i, -1)} title="Move up" aria-label="Move up">↑</button>
                <button className="btn sm" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Move down" aria-label="Move down">↓</button>
                <label className="switch" title={p.enabled ? 'Turn off' : 'Turn on'}>
                  <input type="checkbox" checked={p.enabled} onChange={async () => { await run(() => api.saveProvider({ ...p, enabled: !p.enabled })); changed(); }} /><i />
                </label>
                <button className="btn sm" onClick={() => setEditing(p)}>Edit</button>
                {confirm === p.id
                  ? <button className="btn sm danger" onClick={async () => { await run(() => api.removeProvider(p.id), 'Provider removed'); setConfirm(null); if (editing?.id === p.id) setEditing(null); changed(); }}>Remove?</button>
                  : <button className="btn sm" onClick={() => setConfirm(p.id)} title="Remove">×</button>}
              </span>
            </div>
          );
        })}
      </div>}

      {editing
        ? <ProviderEditor key={editing.id} entry={editing} presets={presets} isNew={!list.some(p => p.id === editing.id)}
            onSaved={async () => { setEditing(null); await changed(); }} onCancel={() => setEditing(null)} />
        : <div style={{ display: 'flex', gap: 8 }}>
            <select className="input" style={{ width: 'auto' }} value={addPreset} onChange={e => setAddPreset(e.target.value)}>
              {Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
            <button className="btn" onClick={() => setEditing(api.newProvider(addPreset))}>+ Add provider</button>
          </div>}
    </div>
  );
}

function limitsText(p: ProviderEntry, u: Usage[string] | undefined, now: number) {
  const parts = [];
  if (p.perMinute) parts.push(`${usedThisMinute(u, now)}/${p.perMinute} this minute`);
  parts.push(p.perDay ? `${usedToday(u, now)}/${p.perDay} in 24 h` : `${usedToday(u, now)} in 24 h, no limit`);
  return parts.join(' · ');
}

/** Add or edit one provider: address, key, model, and its limits. */
export function ProviderEditor({ entry, presets, isNew, onSaved, onCancel, compact = false }: {
  entry: ProviderEntry; presets: Record<string, Preset>; isNew: boolean;
  onSaved: () => void; onCancel?: () => void; compact?: boolean;
}) {
  const [s, setS] = useState<ProviderEntry>(entry);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState('');
  const run = useAction();
  const preset = presets[s.preset];
  const hint = suggestedLimits(s.preset, s.model);
  const differs = hint.perMinute !== s.perMinute || hint.perDay !== s.perDay;
  const cloud = useMemo(() => s.baseURL && !/localhost|127\.0\.0\.1/.test(s.baseURL), [s.baseURL]);
  const local = s.preset === 'ollama' || s.preset === 'lmstudio';
  const choosePreset = (k: string) => {
    const p = presets[k];
    const l = suggestedLimits(k, p.model);
    setS({ ...s, provider: p.provider, preset: k, baseURL: p.baseURL, apiKey: '', model: p.model, perMinute: l.perMinute, perDay: l.perDay, timeoutSec: l.timeoutSec });
    setModels([]); setTest('');
  };
  const num = (v: string) => (v.trim() === '' ? null : Math.max(1, Math.round(Number(v)) || 1));

  return (
    <div className={compact ? '' : 'peditor'} style={{ display: 'grid', gap: 10 }}>
      {!compact && <h5 style={{ margin: 0 }}>{isNew ? 'Add provider' : `Edit ${providerLabel(entry)}`}</h5>}
      <label className="f">Provider<select className="input" value={s.preset} onChange={e => choosePreset(e.target.value)}>
        {Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
      {!compact && <label className="f">Base URL<input className="input" value={s.baseURL} onChange={e => setS({ ...s, baseURL: e.target.value })} /></label>}
      {(preset?.needsKey || s.preset === 'custom') && <label className="f">API key<input className="input" type="password" value={s.apiKey} onChange={e => setS({ ...s, apiKey: e.target.value })} placeholder="Kept in this browser only" /></label>}
      <label className="f">Model
        <div style={{ display: 'flex', gap: 8 }}>
          {models.length
            ? <select className="input" value={s.model} onChange={e => setS({ ...s, model: e.target.value })}><option value="">Choose…</option>{models.map(m => <option key={m}>{m}</option>)}</select>
            : <input className="input" value={s.model} onChange={e => setS({ ...s, model: e.target.value })} placeholder="e.g. llama3.1:8b, gemini-2.0-flash, …:free" />}
          <button className="btn" onClick={async () => { const r = await run(() => api.aiModels(s)); if (r) setModels(r.models); }}>Load models</button>
        </div></label>
      {local && <div className="muted" style={{ fontSize: 12.5 }}>{s.preset === 'ollama'
        ? <>Ollama must allow this page. If loading models fails, set <code>OLLAMA_ORIGINS={location.origin}</code> and restart Ollama.</>
        : <>In LM Studio, start the local server and turn on <b>CORS</b>.</>}</div>}

      <div className="limits">
        <label className="f">Requests per minute<input className="input" inputMode="numeric" value={s.perMinute ?? ''} placeholder="no limit" onChange={e => setS({ ...s, perMinute: num(e.target.value) })} /></label>
        <label className="f">Requests per 24 h<input className="input" inputMode="numeric" value={s.perDay ?? ''} placeholder="no limit" onChange={e => setS({ ...s, perDay: num(e.target.value) })} /></label>
        <label className="f">Give up after (s)<input className="input" inputMode="numeric" value={s.timeoutSec} onChange={e => setS({ ...s, timeoutSec: num(e.target.value) ?? 45 })} /></label>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {hint.note}{' '}
        {differs && <button className="link" onClick={() => setS({ ...s, perMinute: hint.perMinute, perDay: hint.perDay })}>
          Use {hint.perMinute || hint.perDay ? `${hint.perMinute ?? '∞'}/min · ${hint.perDay ?? '∞'}/24 h` : 'no limits'}</button>}
        {' '}Set them a little under the provider's own numbers to stay safely inside a free tier.
      </div>
      {cloud && <div className="note" style={{ fontSize: 12.5 }}>This is a cloud provider: posting text and your document text are sent to it when it answers. The key is sent only to the provider.</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" disabled={!s.model} onClick={async () => { setTest('Testing…'); const r = await run(() => api.aiTest(s)); setTest(r ? `✓ Answered "${r.reply}" in ${(r.ms / 1000).toFixed(1)}s` : ''); }}>Test</button>
        <button className="btn pri" disabled={!s.model} onClick={async () => { if (await run(() => api.saveProvider(s), isNew ? 'Provider added' : 'Provider saved')) onSaved(); }}>{isNew ? 'Add to chain' : 'Save'}</button>
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
        <span className="muted" style={{ fontSize: 12.5 }}>{test}</span>
      </div>
    </div>
  );
}

/** Onboarding: set up the first provider; more can be added in Settings. */
export function FirstProvider({ onSaved }: { onSaved: () => void }) {
  const [d, setD] = useState<{ entry: ProviderEntry; presets: Record<string, Preset>; isNew: boolean } | null>(null);
  useEffect(() => { api.providers().then(r => setD({ entry: r.providers[0] ?? api.newProvider('ollama'), presets: r.presets, isNew: !r.providers.length })); }, []);
  if (!d) return null;
  return <ProviderEditor entry={d.entry} presets={d.presets} isNew={d.isNew} onSaved={onSaved} compact />;
}
