import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { THEMES } from '@shared/render';
import type { AppState, ExtractedFields, Job, JobFields } from '@shared/types';
import { api, lastBackup, type Doc, type JobDetail } from './api';
import { DocumentsStep } from './Documents';
import { buildBundle, bundleZip, download, pdfReady, safe, type Bundle } from './exporter';

/** for browser storage: one click to save a backup, right where the applications are */
function BackupNudge() {
  const run = useAction();
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div className="nudge">
      Your applications are stored only in this browser.
      <button className="link" onClick={async () => { const z = await run(() => api.backup()); if (z) { download(z, `easy-apply-backup-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip'); setDone(true); } }}>⬇ Download a backup</button>
    </div>
  );
}
import { ContextMenu, Dot, fmtDateTime, Keywords, STATUS, StatusMenu, useAction, useToast, useUnsavedWarning, type MenuItem } from './ui';

export const STEPS = ['Posting & details', 'Documents', 'Send'];

interface Props { state: AppState; refresh: () => Promise<void>; jobId: string | null; setJobId: (id: string | null) => void; step: number; setStep: (n: number) => void }

export function Applications({ state, refresh, jobId, setJobId, step, setStep }: Props) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const run = useAction();

  const load = useCallback(async () => {
    if (!jobId || jobId === 'new') { setDetail(null); return; }
    const d = await run(() => api.job(jobId));
    if (d) setDetail(d);
  }, [jobId]);
  // every step reads the folder fresh, so a change made in one step shows in the next
  useEffect(() => { load(); }, [load, step]);
  useEffect(() => { setFoldersOpen(false); }, [step, jobId]);

  // only details that belong to the application on screen: right after "+ New application" (or switching jobs)
  // the previous job's details are still loaded, and must not leak into the new form
  const current = detail && detail.job.id === jobId ? detail : null;
  const job = current?.job ?? null;
  const isNew = jobId === 'new';
  const compact = step === 1 && !foldersOpen && !!job;
  const reloadAll = async () => { await Promise.all([load(), refresh()]); };

  const goStep = (n: number) => { if (!job && n > 0) return; setStep(Math.min(n, STEPS.length - 1)); };

  return (
    <div className={'browser' + (compact ? ' compact' : '')}>
      <JobsColumn jobs={state.jobs} jobId={jobId} browserStorage={state.root === 'this browser'} onPick={id => { setJobId(id); setStep(id === 'new' ? 0 : step); setActiveDoc(null); }}
        onDiscardNew={() => setJobId(null)}
        onDelete={async j => {
          const to = await run(() => api.trashJob(j.id));
          if (!to) return;
          if (j.id === jobId) setJobId(null);
          await refresh();
          run(async () => {}, `Moved "${j.company || j.title || j.id}" to ${state.root} › ${to.split('/').slice(0, -1).join(' › ')}`);
        }} />

      <div className="col files" onClick={() => compact && setFoldersOpen(true)}>
        <div className="col-spine">📁 {job?.company || 'Job'} ›</div>
        <div className="col-h"><span>{isNew ? 'New application' : job ? job.company || job.title : 'No job selected'}</span></div>
        <div className="col-b">
          {(job || isNew) && <>
            <div className="grp">Steps</div>
            {STEPS.map((s, i) => (
              <button key={s} className={'fi' + (step === i ? ' on' : '')} onClick={() => goStep(i)} disabled={!job && i > 0}>
                <span className={'num' + (stepDone(i, job) ? ' done' : '')}>{i + 1}</span><span className="nm" style={{ opacity: !job && i > 0 ? .5 : 1 }}>{s}</span>
              </button>
            ))}
          </>}
          {job && <>
            <div className="grp">Files in this folder</div>
            <button className="fi" onClick={() => goStep(0)}><span className="ic md">MD</span><span className="nm">posting.md</span></button>
            {job.docs.map(d => <button key={d} className={'fi' + (step === 1 && activeDoc === d ? ' on' : '')} onClick={() => { setActiveDoc(d); goStep(1); }}><span className="ic md">MD</span><span className="nm">{d}</span></button>)}
            {job.extras.map(x => <button key={x} className={'fi' + (step === 1 && activeDoc === x ? ' on' : '')} onClick={() => { setActiveDoc(x); goStep(1); }}><span className="ic pdf">{x.split('.').pop()?.toUpperCase().slice(0, 4)}</span><span className="nm">{x}</span></button>)}
            <button className="fi" onClick={() => run(async () => {}, `Files are in ${api.folderOf(job.id)}`)}><span className="ic">▸</span><span className="nm muted">Where are these files?</span></button>
          </>}
        </div>
      </div>

      {!job && !isNew ? (
        <div className="stack" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div className="empty">
            <p className="serif" style={{ fontSize: 22, color: 'var(--ink)' }}>Pick an application, or start a new one.</p>
            <button className="btn pri" onClick={() => { setJobId('new'); setStep(0); }}>+ New application</button>
          </div>
        </div>
      ) : (
        <div className="stack">
          {STEPS.map((title, i) => {
            const cls = i < step ? 'spine' : i === step ? 'active' : i === step + 1 && job ? 'peek' : 'hidden';
            return (
              <section key={title} className={'pane ' + cls} onClick={() => i !== step && goStep(i)}>
                {cls === 'spine' && <div className="spine-l">{stepDone(i, job) && <span className="ok">✓</span>}{i + 1} · {title}</div>}
                {cls === 'peek' && <div className="peek-l">Next<b>{title}</b></div>}
                {cls === 'active' && (
                  <div className="content" onClick={e => e.stopPropagation()}>
                    {i === 0 && <PostingStep key={`${jobId}:${current ? 'loaded' : 'blank'}`} state={state} detail={current} onSaved={async (id, next) => { setJobId(id); await reloadAll(); if (next) setStep(1); }} />}
                    {i === 1 && job && <DocumentsStep state={state} job={job} reload={reloadAll} active={activeDoc} setActive={setActiveDoc} next={() => setStep(2)} back={() => setStep(0)} />}
                    {i === 2 && job && <SendStep job={job} docs={current!.docs} state={state} reload={reloadAll} back={() => setStep(1)} />}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function stepDone(i: number, job: Job | null) {
  if (!job) return false;
  return [true, job.docs.length + job.extras.length > 0, job.status !== 'saved'][i];
}

/* ---------------- column 1 ---------------- */
function JobsColumn({ jobs, jobId, onPick, onDelete, onDiscardNew, browserStorage }: {
  jobs: Job[]; jobId: string | null; onPick: (id: string) => void; onDelete: (job: Job) => void; onDiscardNew: () => void; browserStorage: boolean;
}) {
  // files only in this browser: remind about a backup once there is something to lose and none in two weeks
  const [remind, setRemind] = useState(false);
  useEffect(() => {
    if (!browserStorage || jobs.length < 3) { setRemind(false); return; }
    lastBackup().then(d => setRemind(!d || Date.now() - Date.parse(d) > 14 * 864e5)).catch(() => {});
  }, [browserStorage, jobs.length]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = (e: React.MouseEvent, items: MenuItem[]) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items }); };
  const jobMenu = (j: Job): MenuItem[] => [
    { label: 'Open', onClick: () => onPick(j.id) },
    { label: 'Delete application…', danger: true, onClick: () => onDelete(j),
      confirm: `Delete "${j.company || 'this application'}${j.title ? ` – ${j.title}` : ''}"? Its folder, documents and versions move to the .trash folder inside your files, so you can still get them back.` },
  ];
  const groups = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const j of jobs) {
      const k = new Date(j.createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      m.set(k, [...(m.get(k) ?? []), j]);
    }
    return [...m];
  }, [jobs]);
  return (
    <div className="col jobs">
      <div className="col-h"><span>Applications</span><span>{jobs.length}</span></div>
      <div className="col-b">
        {jobId === 'new' && <button className="row on" onContextMenu={e => open(e, [{ label: 'Discard new application', onClick: onDiscardNew }])}><span className="fold" /><span className="tx"><div>New application</div><small>not saved yet</small></span></button>}
        {groups.map(([month, list]) => (
          <div key={month}>
            <div className="grp">{month}</div>
            {list.map(j => (
              <button key={j.id} className={'row' + (j.id === jobId ? ' on' : '')} onClick={() => onPick(j.id)} onContextMenu={e => open(e, jobMenu(j))}
                title="Right-click for more">
                <span className="fold" /><span className="tx"><div>{j.company || 'Unknown company'}</div><small>{j.title || 'Untitled role'}</small></span><Dot s={j.status} />
              </button>
            ))}
          </div>
        ))}
        {!jobs.length && jobId !== 'new' && <p className="muted" style={{ padding: 10, fontSize: 12.5 }}>No applications yet.</p>}
      </div>
      {remind && <BackupNudge />}
      <button className="btn pri newjob" onClick={() => onPick('new')}>+ New application</button>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/* ---------------- step 1: posting ---------------- */
const FIELD_LABELS: [keyof JobFields, string, boolean?][] = [
  ['title', 'Job title', true], ['company', 'Company'], ['location', 'Location'], ['salary', 'Salary'],
  ['deadline', 'Deadline'], ['language', 'Posting language'],
];

function PostingStep({ state, detail, onSaved }: { state: AppState; detail: JobDetail | null; onSaved: (id: string, next: boolean) => Promise<void> }) {
  const job = detail?.job;
  const empty: JobFields = { title: '', company: '', location: '', salary: '', deadline: '', language: '', url: '', keywords: [], contact: '', notes: '' };
  const [f, setF] = useState<JobFields>(job ? pick(job) : empty);
  const [text, setText] = useState(detail?.posting ?? '');
  const [html, setHtml] = useState('');
  const [aiKeys, setAiKeys] = useState<Set<string>>(new Set());
  const [complete, setComplete] = useState<{ ok: boolean | null; msg?: string }>({ ok: job?.postingComplete ?? null });
  const [busy, setBusy] = useState<'' | 'fetch' | 'ai' | 'save'>('');
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const run = useAction();
  const toast = useToast();

  useEffect(() => { if (detail) { setF(pick(detail.job)); setText(detail.posting); setComplete({ ok: detail.job.postingComplete }); } }, [detail?.job.id]);

  const set = (k: keyof JobFields, v: string | string[]) => { setF(p => ({ ...p, [k]: v })); setAiKeys(s => { const n = new Set(s); n.delete(k); return n; }); };

  function merge(x: ExtractedFields, overwrite: boolean) {
    const filled = new Set(aiKeys);
    setF(p => {
      const n = { ...p };
      for (const [k, v] of Object.entries(x) as [keyof JobFields, unknown][]) {
        if (!(k in empty) || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
        if (k === 'keywords') { n.keywords = overwrite ? (v as string[]) : [...new Set([...p.keywords, ...(v as string[])])]; filled.add(k); }
        else if (overwrite || !p[k]) { (n as Record<string, unknown>)[k] = v; filled.add(k); }
      }
      return n;
    });
    setAiKeys(filled);
  }

  async function extract(t = text) {
    if (!state.ai.configured) { toast('Set up an AI provider in Settings to fill details automatically.'); return; }
    if (t.trim().length < 80) { toast('Paste the posting text first.', true); return; }
    setBusy('ai');
    const x = await run(() => api.extract(t));
    setBusy('');
    if (!x) return;
    merge(x, true);
    setComplete({ ok: x.complete ?? null, msg: x.missing });
  }

  async function fetchUrl() {
    setBusy('fetch');
    const r = await run(() => api.fetchPosting(f.url));
    setBusy('');
    if (!r) return;
    setText(r.text); setHtml(r.html);
    set('url', r.url);
    merge(r.fields, false);
    if (r.warning) setComplete({ ok: false, msg: r.warning });
    if (state.ai.configured) await extract(r.text);
  }

  async function save(next: boolean) {
    setBusy('save');
    const id = await run(async () => {
      if (job) { await api.updateJob(job.id, { ...f, postingComplete: complete.ok }); await api.savePosting(job.id, text); return job.id; }
      return (await api.createJob(f, text, html, complete.ok)).id;
    }, job ? 'Saved' : 'Application folder created');
    setBusy('');
    if (id) await onSaved(id, next);
  }

  const filled = !!(text.trim() || Object.values(f).some(v => (Array.isArray(v) ? v.length : String(v).trim())));
  function clearAll() {
    if (filled && !confirm(job ? 'Clear every field and the posting text? Nothing is saved until you press Save.' : 'Clear every field and the posting text?')) return;
    setF(empty); setText(''); setHtml(''); setAiKeys(new Set()); setComplete({ ok: null });
  }

  const label = (k: keyof JobFields, l: string, wide = false) => (
    <label key={k} className={'f' + (aiKeys.has(k) ? ' ai' : '') + (wide ? ' w' : '')}><span>{l}</span>
      <input className="input" value={f[k] as string} onChange={e => set(k, e.target.value)} placeholder={k === 'deadline' ? 'YYYY-MM-DD' : ''} /></label>
  );

  return (
    <>
      <div className="ph" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div><div className="step">Step 1 of 3</div><h2>Posting &amp; details</h2>
          <p>Paste a link or the full text.{state.ai.configured ? ' The AI fills in the details, and you can edit every field.' : ' Add an AI provider in Settings to fill the details automatically.'}</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm" onClick={clearAll} disabled={!filled || !!busy}>Clear all</button>
          {job && <button className="pill" onClick={e => setMenu(e.currentTarget.getBoundingClientRect())}><Dot s={job.status} />{STATUS[job.status].label} ▾</button>}
        </div>
      </div>
      <div className="pb s1">
        <div>
          <div className="urlbar">
            <input className="input" placeholder="https://… link to the job posting" value={f.url} onChange={e => set('url', e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchUrl()} />
            <button className="btn" onClick={fetchUrl} disabled={!f.url || !!busy}>{busy === 'fetch' ? 'Fetching…' : 'Fetch'}</button>
          </div>
          <textarea className="input posting-text" placeholder="…or paste the full job description here" value={text} onChange={e => setText(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => extract()} disabled={!!busy}>{busy === 'ai' ? '✨ Reading the posting…' : '✨ Fill details from text'}</button>
            {complete.ok === true && <span className="badge ok">✓ Looks like the full posting</span>}
            {complete.ok === false && <span className="badge warn" title={complete.msg}>⚠ May be incomplete{complete.msg ? `: ${complete.msg.slice(0, 90)}` : ''}</span>}
          </div>
        </div>
        <div className="form">
          {FIELD_LABELS.map(([k, l, w]) => label(k, l, w))}
          <label className={'f w' + (aiKeys.has('keywords') ? ' ai' : '')}><span>Key requirements (used for the match score)</span><Keywords value={f.keywords} onChange={v => set('keywords', v)} /></label>
          {label('contact', 'Contact', true)}
          <label className="f w"><span>Notes</span><textarea className="input" rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} /></label>
        </div>
      </div>
      <div className="pf">
        <span className="muted">{aiKeys.size ? '✨ = filled by AI, check before saving' : job ? `Folder: jobs/${job.id}` : 'Saving creates the folder for this application.'}</span>
        <span className="sp" />
        <button className="btn" onClick={() => save(false)} disabled={!!busy}>Save</button>
        <button className="btn pri" onClick={() => save(true)} disabled={!!busy || (!f.title && !f.company)}>Save &amp; choose documents →</button>
      </div>
      {menu && job && <StatusMenu anchor={menu} current={job.status} onClose={() => setMenu(null)}
        onPick={async (s, note) => { setMenu(null); if (await run(() => api.setStatus(job.id, s, note), `Marked as ${STATUS[s].label}`)) await onSaved(job.id, false); }} />}
    </>
  );
}

const pick = (j: Job): JobFields => ({ title: j.title, company: j.company, location: j.location, salary: j.salary, deadline: j.deadline, language: j.language, url: j.url, keywords: j.keywords, contact: j.contact, notes: j.notes });

/* ---------------- step 3: send ---------------- */
function SendStep({ job, docs, state, reload, back }: { job: Job; docs: Doc[]; state: AppState; reload: () => Promise<void>; back: () => void }) {
  const [order, setOrder] = useState(job.bucket);
  const [exportName, setExportName] = useState(job.exportName || defaultExportName(state, job));
  const [helper, setHelper] = useState<boolean | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const dragged = useRef<string | null>(null);
  const run = useAction();
  useEffect(() => setOrder(job.bucket), [job.bucket.join('|')]);
  useEffect(() => { pdfReady().then(setHelper); }, []);
  const all = [...job.docs, ...job.extras];
  const off = all.filter(n => !order.includes(n));
  const save = async (o: string[]) => { setOrder(o); await run(() => api.setBucket(job.id, o)); await reload(); };
  const move = (i: number, d: number) => { const o = [...order]; [o[i], o[i + d]] = [o[i + d], o[i]]; save(o); };
  const docOf = (n: string) => docs.find(d => d.name === n);
  const printable = order.filter(n => n.endsWith('.md'));
  const author = state.profile.fields.find(f => f.key === 'name')?.value ?? '';
  const file = (exportName.trim() || 'Application').replace(/[\\/:*?"<>|]+/g, '_');
  const unfilled = [...new Set(printable.flatMap(n => [...(docOf(n)?.body ?? '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map(m => m[1])))];

  // the preview is the real merged PDF; rebuilt shortly after the order or a document changes
  useEffect(() => {
    if (!helper || !order.length) { setBundle(null); return; }
    let stale = false;
    const t = setTimeout(async () => {
      setErr('');
      try { const b = await buildBundle(job.id, order, docs, { title: file, author }, m => { if (!stale) setBusy(m); }); if (!stale) setBundle(b); }
      catch (e) { if (!stale) { setErr((e as Error).message); setBundle(null); } }
      finally { if (!stale) setBusy(''); }
    }, 400);
    return () => { stale = true; clearTimeout(t); };
  }, [helper, order.join('|'), docs]);
  useEffect(() => {
    if (!bundle) { setPreviewUrl(''); return; }
    const u = URL.createObjectURL(new Blob([bundle.pdf as BlobPart], { type: 'application/pdf' }));
    setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bundle]);

  async function keepName() { if (exportName !== job.exportName) await run(() => api.updateJob(job.id, { exportName })); }
  async function printAll() {
    await keepName();
    window.open(`/print?job=${encodeURIComponent(job.id)}&docs=${encodeURIComponent(printable.join(','))}&title=${encodeURIComponent(exportName)}`, '_blank');
  }
  const skipped = bundle?.items.filter(x => x.note) ?? [];
  /** one file: a document as its PDF (as in the preview), a file as it is */
  async function downloadOne(n: string) {
    const prefix = author ? safe(author) + '_' : '';
    if (n.endsWith('.md')) {
      const part = bundle?.parts.find(p => p.name === n);
      if (part) download(part.bytes, `${prefix}${safe(docOf(n)?.meta.title ?? n.slice(0, -3))}.pdf`);
      return;
    }
    const b = await run(() => api.fileBlob(job.id, n));
    if (b) download(b, n, b.type);
  }

  return (
    <>
      <div className="ph"><div className="step">Step 3 of 3</div><h2>Send</h2><p>Drag or use the arrows to set the order. The merged PDF, the zip and the preview all follow it. Each file can also be downloaded on its own.</p></div>
      <div className="pb bk">
        <div onDragOver={e => e.preventDefault()}>
          {order.map((n, i) => (
            <div key={n} className="bi" draggable
              onDragStart={e => { dragged.current = n; e.currentTarget.classList.add('dragging'); }}
              onDragEnd={e => { e.currentTarget.classList.remove('dragging'); }}
              onDragOver={e => {
                e.preventDefault();
                const d = dragged.current; if (!d || d === n) return;
                const o = order.filter(x => x !== d); o.splice(o.indexOf(n) + (e.nativeEvent.offsetY > e.currentTarget.offsetHeight / 2 ? 1 : 0), 0, d);
                setOrder(o);
              }}
              onDrop={() => { dragged.current = null; save(order); }}>
              <span className="h">⋮⋮</span><span className="n">{i + 1}</span>
              <span className="tx"><b>{docOf(n)?.meta.title ?? n}</b><br /><small>{n}{n.endsWith('.md') ? ` → PDF · ${THEMES[docOf(n)?.meta.theme ?? '']?.name ?? ''}` : ''}
                {bundle && (() => { const it = bundle.items.find(x => x.name === n); return it ? (it.note ? <span className="warn-t"> · not merged</span> : ` · ${it.pages} page${it.pages === 1 ? '' : 's'}`) : null; })()}</small></span>
              <button className="btn sm" disabled={i === 0} onClick={() => move(i, -1)} title="Move up" aria-label="Move up">↑</button>
              <button className="btn sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Move down" aria-label="Move down">↓</button>
              <button className="btn sm" title={n.endsWith('.md') ? 'Download this document as a PDF' : 'Download this file'} disabled={n.endsWith('.md') && !bundle?.parts.some(p => p.name === n)}
                onClick={() => downloadOne(n)}>⬇</button>
              <button className="btn sm" onClick={() => save(order.filter(x => x !== n))} title="Leave out of what you send (stays in the folder)">Leave out</button>
            </div>
          ))}
          {!order.length && <p className="muted">Nothing to send yet. Add documents in step 2.</p>}
          {off.length > 0 && <>
            <div className="grp" style={{ paddingLeft: 0 }}>Not included</div>
            {off.map(n => (
              <div key={n} className="bi off"><span className="tx"><b>{docOf(n)?.meta.title ?? n}</b><br /><small>{n}</small></span>
                <button className="btn sm" onClick={() => save([...order, n])}>+ Include</button></div>
            ))}
          </>}
        </div>
        <div className="outbox">
          <h4>Export</h4>
          <label className="f">File name<input className="input" value={exportName} onChange={e => setExportName(e.target.value)} onBlur={keepName} /></label>
          {helper === false && <div className="note" style={{ fontSize: 12.5 }}>
            Creating PDFs needs the small local helper, which prints with the Edge or Chrome on this computer. Run <code>npm start</code> (or <code>npm run dev</code>) in the app folder, then <button className="link" onClick={() => pdfReady().then(setHelper)}>check again</button>.
          </div>}
          <button className="btn pri" disabled={!bundle || !!busy} onClick={async () => { await keepName(); download(bundle!.pdf, `${file}.pdf`); }}>
            ⬇ Download one PDF{bundle ? ` (${bundle.pages} page${bundle.pages === 1 ? '' : 's'})` : ''}</button>
          <button className="btn" disabled={!bundle || !!busy} onClick={async () => { await keepName(); download(await bundleZip(bundle!, file), `${file}.zip`); }}>⬇ Download zip</button>
          <span className="muted" style={{ fontSize: 12 }}>The zip holds the merged PDF and each file on its own, numbered in this order. The PDFs have real text, so job portals can read them.</span>
          {skipped.map(x => <div key={x.name} className="muted" style={{ fontSize: 12 }}><b>{x.name}</b>: {x.note}.</div>)}
          {unfilled.length > 0 && <div className="note" style={{ fontSize: 12.5 }}>Still unfilled: {unfilled.map(u => <code key={u}>{`{{${u}}}`} </code>)}. They would appear as written.</div>}
          {printable.length > 0 && <button className="link" style={{ alignSelf: 'flex-start', fontSize: 12.5 }} onClick={printAll}>Or print the documents with the browser…</button>}
          <button className="btn" onClick={() => run(async () => {}, `Files are in ${api.folderOf(job.id)}`)}>Where are the files?</button>
          {job.status === 'saved'
            ? <button className="btn" onClick={async () => { if (await run(() => api.setStatus(job.id, 'applied'), 'Marked as applied. Follow-up reminder in 7 days.')) reload(); }}>✓ Mark as applied today</button>
            : <span className="badge ok" style={{ alignSelf: 'flex-start' }}><Dot s={job.status} /> {STATUS[job.status].label}{job.next ? ` · ${job.next}` : ''}</span>}
        </div>
        {order.length > 0 && helper && <div className="bundle">
          <div className="bundle-h"><b>Preview</b>{bundle && <span className="muted"> · {bundle.pages} page{bundle.pages === 1 ? '' : 's'}, exactly as it will be sent</span>}
            <span className="sp" />{busy && <span className="muted"><span className="spin" /> {busy}</span>}</div>
          {err ? <div className="error">{err}</div>
            : previewUrl ? <iframe title="Preview of the merged PDF" src={previewUrl + '#view=FitH'} />
            : <div className="bundle-wait"><span className="spin" /> Building the preview…</div>}
        </div>}
      </div>
      <div className="pf"><span className="muted">Dragging files straight onto job portals will come with the desktop app.</span><span className="sp" /><button className="btn" onClick={back}>← Back</button></div>
    </>
  );
}

function defaultExportName(state: AppState, job: Job) {
  const name = state.profile.fields.find(f => f.key === 'name')?.value ?? '';
  return [name, job.company, 'Application'].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_-]+/gu, '_');
}
