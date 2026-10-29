import { useEffect, useRef, useState } from 'react';
import { THEMES } from '@shared/render';
import { mainIds } from '@shared/store';
import { CLOSED, STATUSES, type AppState, type DocMeta, type TemplateInfo, type Job, type Profile, type Status } from '@shared/types';
import { api, helperRunning, lastBackup } from './api';
import { download } from './exporter';
import { ACCENTS, applyAppearance, loadAppearance, LOOKS, type AccentId, type Appearance, type LookId } from './appearance';
import { DocWorkspace } from './DocWorkspace';
import { Providers } from './Providers';
import { CV_ACCEPT, ImportReview, readCvFile, type CvUpload } from './ImportCv';
import { ContextMenu, Dot, fmtDate, fmtDateTime, STATUS, StatusMenu, useAction, useToast, useUnsavedWarning, type MenuItem } from './ui';

/* ---------------- tracker ---------------- */
export function Tracker({ state, refresh, open }: { state: AppState; refresh: () => Promise<void>; open: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'active' | Status>('active');
  const [menu, setMenu] = useState<{ job: Job; rect: DOMRect } | null>(null);
  const run = useAction();
  const jobs = state.jobs;
  const sent = jobs.filter(j => j.status !== 'saved');
  const replied = sent.filter(j => !['applied', 'ghosted'].includes(j.status));
  const count = (s: Status) => jobs.filter(j => j.status === s).length;
  const shown = jobs.filter(j => filter === 'all' || (filter === 'active' ? !CLOSED.includes(j.status) : j.status === filter));
  const appliedAt = (j: Job) => j.history.find(h => h.status === 'applied')?.at ?? '';
  const upcoming = jobs.filter(j => j.next && !CLOSED.includes(j.status));

  return (
    <div className="page-v">
      <h1>Tracker</h1>
      <p className="muted" style={{ margin: 0 }}>{upcoming.length ? `${upcoming.length} thing${upcoming.length > 1 ? 's' : ''} coming up.` : 'Nothing scheduled.'} Click a status to change it.</p>
      <div className="stats">
        <div className="stat"><div className="n">{sent.length}</div><div className="l">Applications sent</div></div>
        <div className="stat"><div className="n">{count('interview')}</div><div className="l">Interviews now</div></div>
        <div className="stat"><div className="n">{count('offer')}</div><div className="l">Offers</div></div>
        <div className="stat"><div className="n">{sent.length ? Math.round(replied.length / sent.length * 100) + '%' : '–'}</div><div className="l">Response rate</div></div>
      </div>
      <div className="filters">
        {(['active', 'all'] as const).map(f => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : 'Active'} <span className="muted">{f === 'all' ? jobs.length : jobs.filter(j => !CLOSED.includes(j.status)).length}</span></button>)}
        {STATUSES.filter(count).map(s => <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}><Dot s={s} />{STATUS[s].label} <span className="muted">{count(s)}</span></button>)}
      </div>
      <table className="t">
        <thead><tr><th>Company</th><th>Role</th><th>Status</th><th>Applied</th><th>Next</th><th>Deadline</th></tr></thead>
        <tbody>
          {shown.map(j => (
            <tr key={j.id} className={CLOSED.includes(j.status) ? 'closed' : ''}>
              <td><button className="link" onClick={() => open(j.id)}>{j.company || '–'}</button></td>
              <td>{j.title}</td>
              <td><button className="pill" onClick={e => setMenu({ job: j, rect: e.currentTarget.getBoundingClientRect() })}><Dot s={j.status} />{STATUS[j.status].label} ▾</button></td>
              <td>{fmtDate(appliedAt(j))}</td><td>{j.next || '–'}</td><td>{j.deadline || '–'}</td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={6} className="muted">Nothing here.</td></tr>}
        </tbody>
      </table>
      {menu && <StatusMenu anchor={menu.rect} current={menu.job.status} onClose={() => setMenu(null)}
        onPick={async (s, note) => { const j = menu.job; setMenu(null); if (await run(() => api.setStatus(j.id, s, note), `${j.company} → ${STATUS[s].label}`)) refresh(); }} />}
    </div>
  );
}

/* ---------------- My documents (templates on disk) ---------------- */
const LANG = (l: string) => (l === 'de' ? 'Deutsch' : l === 'en' ? 'English' : l.toUpperCase());

export function MyCv({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const mains = mainIds(state.templates);
  const [id, setId] = useState<string | null>(() => [...mains][0] ?? state.templates[0]?.id ?? null);
  const [t, setT] = useState<{ meta: DocMeta; body: string } | null>(null);
  const [upload, setUpload] = useState<CvUpload | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; ask?: MenuItem } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const run = useAction();
  useEffect(() => { if (id) api.template(id).then(setT); else setT(null); }, [id]);

  async function pick(f: File | undefined) {
    if (!f) return;
    const u = await run(() => readCvFile(f));
    if (u) setUpload(u);
  }
  async function create(kind: DocMeta['kind'], from?: string) {
    const title = from ? `${t?.meta.title} (copy)` : kind === 'cover' ? 'New cover letter' : 'New CV';
    const r = await run(() => api.createTemplate({ title, kind, lang: t?.meta.lang ?? 'en', theme: t?.meta.theme ?? 'classic' }, from));
    if (r) { await refresh(); setId(r.id); }
  }
  const mainWord = (kind: string) => (kind === 'cover' ? 'main cover letter' : 'main CV');
  async function makeMain(x: { id: string; title: string; lang: string; kind: string }) {
    if (await run(() => api.setMain(x.id), `"${x.title}" is now your ${mainWord(x.kind)} (${LANG(x.lang)})`)) {
      await refresh();
      if (id) api.template(id).then(setT); // the open document's "main" flag may have changed
    }
  }
  const deleteItem = (x: { id: string; title: string }): MenuItem => ({
    label: 'Delete…', danger: true,
    confirm: `Delete "${x.title}"? It moves to the .trash folder inside your files. Applications that already use it keep their own copies.`,
    onClick: async () => {
      if (await run(() => api.trashTemplate(x.id), `Deleted "${x.title}"`)) {
        await refresh();
        if (x.id === id) setId(null);
      }
    },
  });
  const rowMenu = (x: TemplateInfo): MenuItem[] => [
    { label: 'Open', onClick: () => setId(x.id) },
    ...((x.kind === 'cv' || x.kind === 'cover') && !mains.has(x.id) ? [{ label: `Make ${mainWord(x.kind)} (${LANG(x.lang)})`, onClick: () => makeMain(x) }] : []),
    { label: 'Duplicate', onClick: () => create(x.kind, x.id) },
    deleteItem(x),
  ];
  const groups: [string, TemplateInfo[]][] = [
    ['CVs', state.templates.filter(x => x.kind === 'cv')],
    ['Cover letters', state.templates.filter(x => x.kind === 'cover')],
    ['Other', state.templates.filter(x => x.kind === 'other')],
  ];

  return (
    <div className="split">
      <div className="side-list">
        <div className="mycv-intro">
          Your CVs and cover letters. An application gets its own copy of the ones you pick, so these originals stay untouched. AI suggestions use facts from your main CV (★).
        </div>
        <button className="btn pri sm" onClick={() => file.current?.click()}>⬆ Upload CV or cover letter…</button>
        <input ref={file} type="file" accept={CV_ACCEPT} hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        {groups.map(([label, list]) => list.length > 0 && <div key={label}>
          <div className="grp">{label}</div>
          {list.map(x => (
            <button key={x.id} className={'row' + (x.id === id && !upload ? ' on' : '')} onClick={() => { setUpload(null); setId(x.id); }}
              onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: rowMenu(x) }); }} title="Right-click for more">
              <span className="tx"><div>{x.title}</div><small>{LANG(x.lang)} · {THEMES[x.theme]?.name ?? x.theme}</small></span>
              {mains.has(x.id) && <span className="main-badge" title={`${mainWord(x.kind)} for ${LANG(x.lang)}`}>★ Main</span>}
            </button>
          ))}
        </div>)}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="btn sm" style={{ flex: 1 }} onClick={() => create('cv')}>+ Blank CV</button>
          <button className="btn sm" style={{ flex: 1 }} onClick={() => create('cover')}>+ Cover letter</button>
        </div>
        <details className="muted" style={{ fontSize: 12, padding: '10px 6px' }}>
          <summary>Placeholders</summary>
          From your Profile:<br />{state.profile.fields.map(f => <code key={f.key} style={{ display: 'inline-block', marginRight: 6 }}>{`{{${f.key}}}`}</code>)}
          <br /><br />From the job:<br />{['company', 'job_title', 'job_location', 'today'].map(k => <code key={k} style={{ display: 'inline-block', marginRight: 6 }}>{`{{${k}}}`}</code>)}
        </details>
      </div>
      <div className="content" style={{ background: 'var(--bg)' }}>
        {upload ? <ImportReview upload={upload} profile={state.profile} templates={state.templates}
          onCancel={() => setUpload(null)} onDone={async newId => { setUpload(null); await refresh(); setId(newId); }} />
        : t && id ? <DocWorkspace key={id} doc={t} onSaved={d => { setT(d); refresh(); }}
            store={{ save: async (body, meta) => {
              try { const r = await api.saveTemplate(id, meta, body); return { meta: r.meta, body: r.body }; }
              catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return { meta, body }; throw e; } // deleted meanwhile
            } }}
            head={(meta, setMeta) => <>
              <input className="input" style={{ width: 220 }} value={meta.title} onChange={e => setMeta({ title: e.target.value }, false)} aria-label="Title" />
              <select className="input" style={{ width: 'auto' }} value={meta.kind} onChange={e => setMeta({ kind: e.target.value as DocMeta['kind'] })}>
                <option value="cv">CV</option><option value="cover">Cover letter</option><option value="other">Other</option></select>
              <select className="input" style={{ width: 'auto' }} value={meta.lang} onChange={e => setMeta({ lang: e.target.value })}>
                <option value="en">English</option><option value="de">Deutsch</option><option value="other">Other</option></select>
              {(meta.kind === 'cv' || meta.kind === 'cover') && (mains.has(id)
                ? <span className="main-badge" title="Marked as your main one for this language">★ {mainWord(meta.kind).replace(/^m/, 'M')} ({LANG(meta.lang)})</span>
                : <button className="btn sm" onClick={() => makeMain({ id, title: meta.title, lang: meta.lang, kind: meta.kind })}>☆ Make {mainWord(meta.kind)}</button>)}
            </>}
            tools={<button className="btn sm" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); const d = deleteItem({ id, title: t.meta.title }); setMenu({ x: r.left, y: r.bottom + 6, items: [d], ask: d }); }}>Delete…</button>}
            margin={<div className="note" style={{ fontSize: 12.5 }}>This is your original. Applications get their own copy of it, so changes here only show up in applications you start from now on.</div>} />
 : <div className="mycv-empty">
          <h2>{state.templates.some(x => x.kind === 'cv') ? 'Pick a CV or letter on the left' : 'Upload your CV and cover letter'}</h2>
          <p className="muted">Easy Apply tailors both to every job. Word and PDF files are read in this browser; nothing is uploaded anywhere.</p>
          <button className="btn pri" onClick={() => file.current?.click()}>⬆ Upload CV or cover letter…</button>
        </div>}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/* ---------------- extras library ---------------- */
export function Extras({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const run = useAction();
  async function upload(files: FileList | null) { for (const f of files ?? []) await run(() => api.uploadExtra(f), `Added ${f.name}`); refresh(); }
  return (
    <div className="page-v">
      <h1>Extras</h1>
      <p className="muted">Certificates, references, transcripts. Attach them to any application in step 4.</p>
      <div className="xlist" style={{ marginTop: 18 }}>
        {state.extras.map(x => <a key={x.name} className="x" href="#" onClick={e => { e.preventDefault(); run(() => api.openExtra(x.name)); }} style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="ic">{x.name.split('.').pop()?.toUpperCase().slice(0, 4)}</span><span className="tx"><b>{x.name}</b><small>{(x.size / 1024).toFixed(0)} KB · {fmtDate(x.updatedAt)}</small></span></a>)}
      </div>
      <div className="drop" onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        Drop files here, or <u>browse</u>.<input ref={input} type="file" multiple hidden onChange={e => upload(e.target.files)} />
      </div>
    </div>
  );
}

/* ---------------- profile ---------------- */
export function ProfileView({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const [p, setP] = useState<Profile>(state.profile);
  const run = useAction();
  const set = (i: number, k: 'key' | 'label' | 'value', v: string) => setP(x => ({ fields: x.fields.map((f, j) => j === i ? { ...f, [k]: v } : f) }));
  return (
    <div className="page-v">
      <h1>Profile</h1>
      <p className="muted" style={{ maxWidth: 640 }}>These values fill the <code>{'{{placeholders}}'}</code> in your CV and letters when they are copied into an application. After that, each application's copy is plain text you can change freely, e.g. a different headline or German level for one job.</p>
      <div style={{ marginTop: 20, maxWidth: 900 }}>
        <div className="fieldrow muted" style={{ fontSize: 12 }}><span>Placeholder</span><span>Label</span><span>Value</span><span /></div>
        {p.fields.map((f, i) => (
          <div className="fieldrow" key={i}>
            <input className="input" value={f.key} onChange={e => set(i, 'key', e.target.value)} />
            <input className="input" value={f.label} onChange={e => set(i, 'label', e.target.value)} />
            <input className="input" value={f.value} onChange={e => set(i, 'value', e.target.value)} />
            <button className="btn sm" title="Remove" onClick={() => setP(x => ({ fields: x.fields.filter((_, j) => j !== i) }))}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={() => setP(x => ({ fields: [...x.fields, { key: 'new_field', label: 'New field', value: '' }] }))}>+ Add placeholder</button>
          <button className="btn pri" onClick={async () => { const r = await run(() => api.saveProfile(p), 'Profile saved'); if (r) { setP(r); refresh(); } }}>Save profile</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- settings ---------------- */
/** Download everything as one zip, or put a backup back (adds and replaces, never deletes). */
export function Backup({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const [last, setLast] = useState<string | undefined>();
  const [pending, setPending] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = useAction();
  const toast = useToast();
  useEffect(() => { lastBackup().then(setLast).catch(() => {}); }, []);
  async function down() {
    const zip = await run(() => api.backup());
    if (!zip) return;
    download(zip, `easy-apply-backup-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
    setLast(new Date().toISOString());
  }
  async function restore(f: File) {
    setPending(null);
    const r = await run(() => api.restoreBackup(f));
    if (!r) return;
    await refresh();
    toast(`Restored ${r.written} files from the backup${r.replaced ? `. The ${r.replaced} files it replaced are kept in .trash/${r.savedTo.split('/').pop()}` : ''}.`);
  }
  return (
    <>
      <h4 style={{ marginTop: 18 }}>Backup</h4>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
        {last ? <>Last backup on this device: <b>{fmtDateTime(last)}</b>. </> : 'No backup made on this device yet. '}
        {state.root === 'this browser' ? 'Your files live only in this browser and are lost if its site data is cleared, so download a backup now and then.' : 'One zip with your profile, CVs and letters, extras and every application with its versions.'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={down}>⬇ Download backup (.zip)</button>
        <button className="btn" onClick={() => input.current?.click()}>Restore from backup…</button>
        <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={e => { setPending(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      </div>
      {pending && <div className="note" style={{ fontSize: 12.5, marginTop: 10 }}>
        Restore <b>{pending.name}</b>? Its files are added, or replace files with the same name. Nothing is deleted, and every replaced file is kept in .trash.
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button className="btn sm" onClick={() => setPending(null)}>Cancel</button><button className="btn sm pri" onClick={() => restore(pending)}>Restore</button></div>
      </div>}
    </>
  );
}

export function Settings({ state, refresh, changeFolder }: { state: AppState; refresh: () => Promise<void>; changeFolder: () => void }) {
  const [helper, setHelper] = useState<boolean | null>(null);
  useEffect(() => { helperRunning().then(setHelper); }, []);
  return (
    <div className="page-v">
      <h1>Settings</h1>
      <p className="muted" style={{ fontSize: 12, margin: 0 }} data-build={__BUILD__}>Easy Apply · version {__BUILD__}</p>
      <div className="settings-grid" style={{ marginTop: 20 }}>
        <div className="card"><h4>Appearance</h4><AppearancePicker /></div>
        <div className="card">
          <h4>Your files</h4>
          <p style={{ marginTop: 0 }}>Stored in <b>{state.root}</b>.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>{state.root === 'this browser'
            ? 'Applications, your CVs and letters, and extras are kept in this browser\'s private storage. Choose a folder to get plain files you can back up or sync.'
            : 'Applications, your CVs and letters, and extras are plain files there. A folder can sit in OneDrive or Dropbox for backup.'} AI keys stay in this browser and are never written to the folder.</p>
          <button className="btn" onClick={changeFolder}>Use another folder…</button>
          <Backup state={state} refresh={refresh} />
          <h4 style={{ marginTop: 18 }}>Fetching postings from links</h4>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            {helper === null ? 'Checking…' : helper
              ? '✓ The local helper is running, so links can be fetched.'
              : <>Browsers may not read other websites, so most links need the small local helper. Run <code>npm start</code> in the app folder, or paste the posting text instead.</>}
          </p>
        </div>
        <div className="card"><h4>AI providers</h4><Providers onChanged={refresh} /></div>
      </div>
    </div>
  );
}

/** Look and accent colour, applied at once and remembered on this device. */
export function AppearancePicker() {
  const [a, setA] = useState<Appearance>(loadAppearance);
  const pick = (patch: Partial<Appearance>) => { const next = { ...a, ...patch }; setA(next); applyAppearance(next, true); };
  const accent = ACCENTS[a.accent];
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="looks">
        {(Object.entries(LOOKS) as [LookId, typeof LOOKS[LookId]][]).map(([id, l]) => (
          <button key={id} className={'look' + (a.look === id ? ' on' : '')} onClick={() => pick({ look: id })} aria-pressed={a.look === id}>
            <span className="mini" style={{ background: l.bg }}>
              <i style={{ background: l.side }} /><i style={{ background: l.side, opacity: id === 'midnight' ? 1 : .6, borderRight: '1px solid rgba(0,0,0,.06)' }} />
              <b style={{ background: l.paper }}><u style={{ background: accent.accent }} /><s /><s /><s /></b>
            </span>
            <span className="nm" style={{ fontFamily: `'${l.font}', system-ui, sans-serif` }}>{l.name}</span>
            <small>{l.note}</small>
          </button>
        ))}
      </div>
      <div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Accent colour · <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{accent.name}</b></div>
        <div className="swatches">
          {(Object.entries(ACCENTS) as [AccentId, typeof ACCENTS[AccentId]][]).map(([id, c]) => (
            <button key={id} className={a.accent === id ? 'on' : ''} title={c.name} aria-label={c.name} aria-pressed={a.accent === id}
              style={{ background: c.accent }} onClick={() => pick({ accent: id })} />
          ))}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>Only the app changes. Your documents keep their own resume theme. Every accent is checked for readable contrast in every look, including Midnight's dark columns.</p>
    </div>
  );
}

