import { useEffect, useRef, useState, type ReactNode } from 'react';
import { keywordMatch, THEMES } from '@shared/render';
import type { DocMeta, VersionInfo } from '@shared/types';
import { DocEditor, type Tailor } from './DocEditor';
import { fmtDateTime, useAction, useUnsavedWarning } from './ui';

/**
  Where a document lives: an application's copy (with versions and tailoring) or one of your originals in
  My documents. The workspace only edits through this, so it works the same for both.
*/
export interface DocStore {
  save: (body: string, meta: DocMeta, version?: boolean) => Promise<{ meta: DocMeta; body: string }>;
  versions?: () => Promise<VersionInfo[]>;
  version?: (id: string) => Promise<string>;
  restore?: (id: string) => Promise<{ meta: DocMeta; body: string }>;
  tailor?: Tailor;
  /** the job's key requirements, for the match score */
  keywords?: string[];
  print?: () => void;
}

type Saved = { meta: DocMeta; body: string };

/**
  One document, ready to edit: the page, the formatting bar, its design, saving (automatic, retried when it
  fails), earlier versions and ✨ tailoring when the store has them. `head` and `tools` fill the toolbar.
*/
export function DocWorkspace({ doc: initial, store, head, tools, onSaved, margin }: {
  doc: Saved; store: DocStore;
  /** left side of the toolbar; gets the current settings and a way to change them (title, kind, language …) */
  head?: (meta: DocMeta, setMeta: (patch: Partial<DocMeta>, now?: boolean) => void) => ReactNode;
  tools?: ReactNode; onSaved?: (d: Saved) => void; margin?: ReactNode;
}) {
  const [doc, setDoc] = useState<Saved>(initial);
  const [saving, setSaving] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [preview, setPreview] = useState<{ v: VersionInfo; body: string } | null>(null);
  const [tailorMode, setTailorMode] = useState(false);
  const timer = useRef<number>();
  // the newest text and settings not saved yet; one queue for both, so a slow save never overtakes a newer one
  const pending = useRef<{ body: string; meta: DocMeta; version: boolean } | null>(null);
  const latest = useRef(initial);
  const run = useAction();

  const loadVersions = () => store.versions?.().then(setVersions).catch(() => {});
  useEffect(() => { loadVersions(); }, []);

  async function flush() {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(timer.current);
    setSaving('saving');
    const r = await run(() => store.save(p.body, p.meta, p.version));
    if (!r) {
      // keep it queued (unless something newer replaced it) and try again shortly
      pending.current ??= p;
      setSaving('dirty');
      timer.current = window.setTimeout(flush, 5000);
      return;
    }
    onSaved?.(r);
    setSaving(pending.current ? 'dirty' : 'saved');
    if (p.version || store.versions) loadVersions();
  }
  useUnsavedWarning(saving !== 'saved');
  useEffect(() => () => { flush(); }, []);

  function queue(next: Saved, opts: { version?: boolean; now?: boolean } = {}) {
    latest.current = next;
    setDoc(next);
    pending.current = { body: next.body, meta: next.meta, version: !!opts.version || !!pending.current?.version };
    setSaving('dirty');
    clearTimeout(timer.current);
    // an accepted AI change saves right away, keeping the text before it as a version
    if (opts.version || opts.now) flush();
    else timer.current = window.setTimeout(flush, 700);
  }
  const change = (body: string, opts?: { version?: boolean }) => queue({ ...latest.current, body }, opts);
  /** settings save at once; typing (a title) waits like text does */
  const setMeta = (patch: Partial<DocMeta>, now = true) => queue({ ...latest.current, meta: { ...latest.current.meta, ...patch } }, { now });

  const match = store.keywords ? keywordMatch(doc.body, store.keywords) : null;
  const unfilled = [...new Set([...doc.body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map(m => m[1]))];

  return (
    <>
      <div className="edbar">
        {head?.(doc.meta, setMeta)}
        <span className="sp" />
        <span className="muted" style={{ fontSize: 12 }}>{saving === 'saving' ? 'Saving…' : saving === 'dirty' ? 'Unsaved' : 'Saved'}</span>
        {store.tailor && <button className={'btn sm pri tailor' + (tailorMode ? ' on' : '')} disabled={!!preview} title="Click a line to get a version tailored to this job, then accept or reject it" onClick={() => setTailorMode(t => !t)}>{tailorMode ? '✨ Tailoring · click a line' : '✨ Tailor to this job'}</button>}
        <select className="input" style={{ width: 'auto', padding: '5px 8px' }} value={doc.meta.theme} onChange={e => setMeta({ theme: e.target.value })} aria-label="Design">
          {Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>Design: {t.name}</option>)}
        </select>
        {tools}
        {store.print && <button className="btn sm" onClick={async () => { await flush(); store.print!(); }}>Print / PDF</button>}
      </div>
      <div className="edwrap">
        <div style={{ minWidth: 0 }}>
          {preview ? (
            <>
              <div className="note" style={{ maxWidth: 794, margin: '0 auto 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span>Viewing the version from <b>{fmtDateTime(preview.v.at)}</b>.</span><span className="sp" />
                <button className="btn sm" onClick={() => setPreview(null)}>Back to current</button>
                {store.restore && <button className="btn sm pri" onClick={async () => {
                  await flush();
                  const r = await run(() => store.restore!(preview.v.id), 'Version restored (the current text was saved as a version first)');
                  if (r) { latest.current = r; setDoc(r); onSaved?.(r); setPreview(null); loadVersions(); }
                }}>Restore this version</button>}
              </div>
              <DocEditor body={preview.body} meta={doc.meta} readOnly />
            </>
          ) : <DocEditor body={doc.body} meta={doc.meta} onChange={change} onMeta={setMeta} tailor={store.tailor} tailorMode={tailorMode} />}
        </div>
        <div className="margin">
          {margin}
          {match && match.score !== null && (
            <div className="card"><h4>Keyword match</h4>
              <div className="meter"><i style={{ width: match.score + '%' }} /></div><b style={{ fontSize: 20 }}>{match.score}%</b>
              {match.missing.length > 0 && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Not mentioned yet:<br />{match.missing.map(k => <span key={k} className="kw miss">{k}</span>)}</p>}
            </div>
          )}
          {match && match.score === null && <div className="card muted" style={{ fontSize: 12.5 }}>Add key requirements in step 1 to see a keyword match here.</div>}
          {store.keywords && unfilled.length > 0 && <div className="note" style={{ fontSize: 12.5 }}>Not filled in: {unfilled.map(u => <code key={u}>{`{{${u}}}`} </code>)}<br />Type over them on the page.</div>}
          {store.versions && (
            <div className="card"><h4>Versions</h4>
              <div className="vlist">
                {versions.slice(0, 12).map(v => (
                  <button key={v.id} className={preview?.v.id === v.id ? 'on' : ''} onClick={async () => { const b = await run(() => store.version!(v.id)); if (b !== undefined) setPreview({ v, body: b }); }}>
                    <span>{fmtDateTime(v.at)}</span><span className="muted">view</span></button>
                ))}
                {!versions.length && <span className="muted" style={{ fontSize: 12 }}>Earlier versions appear here as you edit.</span>}
              </div>
              <button className="btn sm" style={{ marginTop: 8, width: '100%' }} onClick={async () => { queue(latest.current, { version: true }); }}>Save a version now</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
