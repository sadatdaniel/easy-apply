import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { STATUSES, type Status } from '@shared/types';

export const STATUS: Record<Status, { label: string; color: string; ask?: string; ph?: string }> = {
  saved:     { label: 'Saved',     color: 'var(--s-saved)' },
  applied:   { label: 'Applied',   color: 'var(--s-applied)' },
  interview: { label: 'Interview', color: 'var(--s-interview)', ask: 'Interview date & time', ph: 'Tue 4 Nov, 10:00' },
  offer:     { label: 'Offer',     color: 'var(--s-offer)', ask: 'Reply by', ph: '5 Nov' },
  rejected:  { label: 'Rejected',  color: 'var(--s-rejected)', ask: 'Stage (optional)', ph: 'After first interview' },
  ghosted:   { label: 'No reply',  color: 'var(--s-ghosted)' },
  withdrawn: { label: 'Withdrawn', color: 'var(--s-withdrawn)' },
};

export const Dot = ({ s }: { s: Status }) => <span className="dot" style={{ background: STATUS[s].color }} />;

/** an arrow into a tray */
export const DownloadIcon = ({ size = 15 }: { size?: number }) => (
  <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5v11.5" /><path d="m7 10.5 5 5 5-5" /><path d="M4.5 19.5h15" />
  </svg>
);

/* ---------- toast ---------- */
type ToastFn = (msg: string, err?: boolean) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err: boolean; id: number } | null>(null);
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), t.err ? 5000 : 2400); return () => clearTimeout(h); }, [t]);
  return (
    <ToastCtx.Provider value={(msg, err = false) => setT({ msg, err, id: Date.now() })}>
      {children}
      {t && <div className={'toast' + (t.err ? ' err' : '')} key={t.id}>{t.msg}</div>}
    </ToastCtx.Provider>
  );
}

/** Browser file errors in words a person can act on. */
export function friendlyError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const msg = (e as Error)?.message ?? String(e);
  switch (name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Easy Apply no longer has permission to use your folder. Reload the page and allow access again.';
    case 'NotFoundError':
      return 'A file or folder was moved or deleted outside Easy Apply. Reload the page to see the current state.';
    case 'NoModificationAllowedError': case 'InvalidModificationError': case 'InvalidStateError':
      return 'The file is locked by another program (for example Word, or OneDrive while it syncs). Close it there and try again.';
    case 'QuotaExceededError':
      return 'Your disk or the browser storage is full. Free some space and try again.';
    case 'TypeError':
      if (/dynamically imported module|importing a module script/i.test(msg))
        return 'Part of Easy Apply could not be loaded. Check your connection and reload the page.';
      if (/fetch|network/i.test(msg)) return navigator.onLine ? 'Could not reach the server.' : 'You are offline. This needs an internet connection.';
  }
  return msg;
}

/** Wraps an async action: shows errors as a toast, returns undefined on failure. */
export function useAction() {
  const toast = useToast();
  return async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    try { const r = await fn(); if (ok) toast(ok); return r; }
    catch (e) { console.error(e); toast(friendlyError(e), true); return undefined; }
  };
}

/** Asks the browser to warn before the tab closes while there are unsaved changes. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/* ---------- keywords ---------- */
export function Keywords({ value, onChange, missing = [] }: { value: string[]; onChange: (v: string[]) => void; missing?: string[] }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.split(',').map(s => s.trim()).filter(Boolean); if (v.length) onChange([...new Set([...value, ...v])]); setDraft(''); };
  return (
    <div>
      {value.map(k => (
        <span key={k} className={'kw' + (missing.includes(k) ? ' miss' : '')}>{k}<button title="Remove" onClick={() => onChange(value.filter(x => x !== k))}>×</button></span>
      ))}
      <input className="kw-input" placeholder="+ add" value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

/* ---------- status menu (anchored popover) ---------- */
/**
  Closes a popup on a click outside it or on Escape. Registered once per popup: listeners added on every
  render (onClose is a new function each time) with a delayed add could outlive the popup and close the
  next one as soon as it was clicked.
*/
function useCloseOnOutside(ref: React.RefObject<HTMLElement>, onClose: () => void) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) latest.current(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') latest.current(); };
    // after the click that opened the popup has finished
    const t = setTimeout(() => document.addEventListener('mousedown', close));
    document.addEventListener('keydown', esc);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
}

export function StatusMenu({ anchor, current, onPick, onClose }: { anchor: DOMRect; current: Status; onPick: (s: Status, note: string) => void; onClose: () => void }) {
  const [asking, setAsking] = useState<Status | null>(null);
  const [note, setNote] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setPos({ left: Math.min(anchor.left, innerWidth - 250), top: anchor.bottom + 6 + h > innerHeight ? anchor.top - h - 6 : anchor.bottom + 6 });
  }, [anchor, asking]);
  useCloseOnOutside(ref, onClose);
  const pick = (s: Status) => (STATUS[s].ask ? (setAsking(s), setNote('')) : onPick(s, ''));
  return (
    <div className="menu" ref={ref} style={pos}>
      {STATUSES.map(s => (
        <button key={s} className={(asking ?? current) === s ? 'cur' : ''} onClick={() => pick(s)}><Dot s={s} />{STATUS[s].label}{current === s && <span className="muted" style={{ marginLeft: 'auto' }}>current</span>}</button>
      ))}
      {asking && (
        <form className="extra" onSubmit={e => { e.preventDefault(); onPick(asking, note.trim()); }}>
          {STATUS[asking].ask}
          <input className="input" autoFocus placeholder={STATUS[asking].ph} value={note} onChange={e => setNote(e.target.value)} />
          <button className="btn pri sm" type="submit">Save</button>
        </form>
      )}
    </div>
  );
}

export const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–';
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; confirm?: string }

/** Right-click menu. An item with `confirm` asks again inside the menu before it runs. */
export function ContextMenu({ x, y, items, onClose, ask = null }: { x: number; y: number; items: MenuItem[]; onClose: () => void; ask?: MenuItem | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<MenuItem | null>(ask);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(x, innerWidth - r.width - 8), top: Math.min(y, innerHeight - r.height - 8) });
  }, [x, y, asking]);
  useCloseOnOutside(ref, onClose);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, []);
  return (
    <div className="menu" ref={ref} style={pos} role="menu" onContextMenu={e => e.preventDefault()}>
      {asking ? (
        <div className="extra" style={{ borderTop: 0, marginTop: 0 }}>
          <span style={{ color: 'var(--ink)' }}>{asking.confirm}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm" onClick={onClose}>Cancel</button>
            <button className={'btn sm ' + (asking.danger ? 'danger' : 'pri')} autoFocus onClick={() => { onClose(); asking.onClick(); }}>{asking.label.replace(/…$/, '')}</button>
          </div>
        </div>
      ) : items.map(it => (
        <button key={it.label} role="menuitem" className={it.danger ? 'danger-t' : ''} onClick={() => (it.confirm ? setAsking(it) : (onClose(), it.onClick()))}>{it.label}</button>
      ))}
    </div>
  );
}
