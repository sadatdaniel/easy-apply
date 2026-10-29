import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseBlocks } from '@shared/blocks';
import { THEMES } from '@shared/render';
import type { AppState, ExtractedFields, Job, JobFields } from '@shared/types';
import { api, type Doc, type JobDetail } from './api';
import { DocumentsStep } from './Documents';
import { buildBundle, bundleZip, download, pdfReady, safe, type Bundle } from './exporter';
import { DownloadIcon, Dot, Keywords, STATUS, StatusMenu, useAction, useToast } from './ui';

export const STEPS = ['Posting & details', 'Documents', 'Send'];

/** where you left an application (step and file), per browser, so opening it again continues there */
const RESUME = 'easy-apply:resume:';
export function resumeOf(id: string): { step: number; doc: string | null } | null {
  try { const r = JSON.parse(localStorage.getItem(RESUME + id) ?? 'null'); return r && typeof r.step === 'number' ? r : null; } catch { return null; }
}
function keepResume(id: string, step: number, doc: string | null) {
  try { localStorage.setItem(RESUME + id, JSON.stringify({ step, doc })); } catch { /* private window: just don't remember */ }
}

export function stepDone(i: number, job: Job | null) {
  if (!job) return false;
  return [true, job.docs.length + job.extras.length > 0, job.status !== 'saved'][i];
}

/**
  One application, start to finish, in its own window: the posting, its documents, sending. While it is open
  the rest of the app waits behind it; minimise it to a bar (like an email being written) to look something
  up, then bring it back. Everything saves as you go, so closing loses nothing.
*/
export function FlowWindow({ state, refresh, jobId, step, min, firstDoc, setFlow, close }: {
  state: AppState; refresh: () => Promise<void>; jobId: string; step: number; min: boolean; firstDoc: string | null;
  setFlow: (f: { job?: string; step?: number; min?: boolean }) => void; close: () => void;
}) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [activeDoc, setActiveDoc] = useState<string | null>(firstDoc);
  const run = useAction();
  useEffect(() => { if (firstDoc) setActiveDoc(firstDoc); }, [firstDoc]);

  const load = useCallback(async () => {
    if (jobId === 'new') { setDetail(null); return; }
    const d = await run(() => api.job(jobId));
    if (d) setDetail(d);
  }, [jobId]);
  // every step reads the folder fresh, so a change made in one step shows in the next
  useEffect(() => { load(); }, [load, step]);
  useEffect(() => { if (jobId !== 'new') keepResume(jobId, step, activeDoc); }, [jobId, step, activeDoc]);

  // only details that belong to this application: right after "+ New application" (or switching jobs)
  // the previous job's details are still loaded, and must not leak into the new form
  const current = detail && detail.job.id === jobId ? detail : null;
  const job = current?.job ?? null;
  const reloadAll = async () => { await Promise.all([load(), refresh()]); };
  const goStep = (n: number) => { if (!job && n > 0) return; setFlow({ step: Math.min(n, STEPS.length - 1) }); };
  const title = jobId === 'new' ? 'New application' : job ? [job.company, job.title].filter(Boolean).join(' · ') || 'Application' : '…';

  return (
    <>
      {!min && <div className="flow-back" />}
      <div className={'flow' + (min ? ' min' : '')} role="dialog" aria-label={title}>
        <div className="flow-h" onDoubleClick={() => setFlow({ min: !min })} onClick={() => min && setFlow({ min: false })}>
          <span className="fold" />
          <b className="flow-t">{title}</b>
          {min ? <span className="muted">{STEPS[step]}</span> : (
            <div className="flow-steps" onClick={e => e.stopPropagation()}>
              {STEPS.map((s, i) => (
                <button key={s} className={i === step ? 'on' : ''} disabled={!job && i > 0} onClick={() => goStep(i)}>
                  <span className={'num' + (stepDone(i, job) ? ' done' : '')}>{stepDone(i, job) && i !== step ? '✓' : i + 1}</span>{s}
                </button>
              ))}
            </div>
          )}
          <span className="sp" />
          <button className="flow-b" title={min ? 'Open' : 'Minimise'} aria-label={min ? 'Open' : 'Minimise'} onClick={e => { e.stopPropagation(); setFlow({ min: !min }); }}>{min ? '▴' : '–'}</button>
          <button className="flow-b" title="Close (everything is saved)" aria-label="Close" onClick={e => { e.stopPropagation(); close(); }}>✕</button>
        </div>
        <div className="flow-body content">
          {step === 0 && <PostingStep key={`${jobId}:${current ? 'loaded' : 'blank'}`} state={state} detail={current} onSaved={async (id, next) => { setFlow({ job: id, ...(next ? { step: 1 } : {}) }); await reloadAll(); }} />}
          {step === 1 && job && <DocumentsStep state={state} job={job} reload={reloadAll} active={activeDoc} setActive={setActiveDoc} next={() => goStep(2)} back={() => goStep(0)} />}
          {step === 2 && job && <SendStep job={job} docs={current!.docs} state={state} reload={reloadAll} back={() => goStep(1)} />}
          {step > 0 && !job && <div className="empty"><span className="spin" /></div>}
        </div>
      </div>
    </>
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
  const [exportName, setExportName] = useState(job.exportName || defaultExportName(docs, job));
  const [helper, setHelper] = useState<boolean | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [showPreview, setShowPreview] = useState(false);
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
  const author = nameIn(docs.filter(d => order.includes(d.name)));
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
                onClick={() => downloadOne(n)} aria-label={`Download ${n}`}><DownloadIcon size={14} /></button>
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
            <DownloadIcon /> Download one PDF{bundle ? ` (${bundle.pages} page${bundle.pages === 1 ? '' : 's'})` : ''}</button>
          <button className="btn" disabled={!bundle || !!busy} onClick={async () => { await keepName(); download(await bundleZip(bundle!, file), `${file}.zip`); }}><DownloadIcon /> Download zip</button>
          {helper && order.length > 0 && <button className="btn" disabled={!bundle} onClick={() => setShowPreview(p => !p)}>{showPreview ? 'Hide the preview' : 'Preview the PDF'}</button>}
          <span className="muted" style={{ fontSize: 12 }}>The zip holds the merged PDF and each file on its own, numbered in this order. The PDFs have real text, so job portals can read them.</span>
          {skipped.map(x => <div key={x.name} className="muted" style={{ fontSize: 12 }}><b>{x.name}</b>: {x.note}.</div>)}
          {unfilled.length > 0 && <div className="note" style={{ fontSize: 12.5 }}>Still unfilled: {unfilled.map(u => <code key={u}>{`{{${u}}}`} </code>)}. They would appear as written.</div>}
          {printable.length > 0 && <button className="link" style={{ alignSelf: 'flex-start', fontSize: 12.5 }} onClick={printAll}>Or print the documents with the browser…</button>}
          <button className="btn" onClick={() => run(async () => {}, `Files are in ${api.folderOf(job.id)}`)}>Where are the files?</button>
          {job.status === 'saved'
            ? <button className="btn" onClick={async () => { if (await run(() => api.setStatus(job.id, 'applied'), 'Marked as applied. Follow-up reminder in 7 days.')) reload(); }}>✓ Mark as applied today</button>
            : <span className="badge ok" style={{ alignSelf: 'flex-start' }}><Dot s={job.status} /> {STATUS[job.status].label}{job.next ? ` · ${job.next}` : ''}</span>}
        </div>
        {showPreview && order.length > 0 && helper && <div className="bundle">
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

/** your name, as the first line of your CV (or letter) has it */
function nameIn(docs: Doc[]) {
  const d = docs.find(x => x.meta.kind === 'cv') ?? docs[0];
  const first = d ? parseBlocks(d.body).find(b => b.type === 'h1') : undefined;
  return first ? first.text.replace(/[*_[\]]|\(.*?\)|\{\{.*?\}\}/g, '').trim() : '';
}

function defaultExportName(docs: Doc[], job: Job) {
  const name = nameIn(docs);
  return [name, job.company, 'Application'].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_-]+/gu, '_');
}
