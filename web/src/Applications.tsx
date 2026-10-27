import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseBlocks } from '@shared/blocks';
import { keywordMatch, renderDoc, THEMES } from '@shared/render';
import { docLang, mainOf } from '@shared/store';
import type { AppState, DocMeta, ExtractedFields, Job, JobFields, TemplateInfo, VersionInfo } from '@shared/types';
import { api, lastBackup, type Doc, type JobDetail } from './api';
import { DocEditor, type Tailor } from './DocEditor';
import { buildBundle, bundleZip, download, pdfReady, type Bundle } from './exporter';

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

const STEPS = ['Posting & details', 'Choose documents', 'Edit documents', 'Add extras', 'Final bucket'];

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
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFoldersOpen(false); }, [step, jobId]);

  // only details that belong to the application on screen: right after "+ New application" (or switching jobs)
  // the previous job's details are still loaded, and must not leak into the new form
  const current = detail && detail.job.id === jobId ? detail : null;
  const job = current?.job ?? null;
  const isNew = jobId === 'new';
  const compact = step === 2 && !foldersOpen && !!job;
  const reloadAll = async () => { await Promise.all([load(), refresh()]); };

  const goStep = (n: number) => { if (!job && n > 0) return; setStep(n); };

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
            {job.docs.map(d => <button key={d} className={'fi' + (step === 2 && activeDoc === d ? ' on' : '')} onClick={() => { setActiveDoc(d); goStep(2); }}><span className="ic md">MD</span><span className="nm">{d}</span></button>)}
            {job.extras.map(x => <button key={x} className="fi" onClick={() => goStep(3)}><span className="ic pdf">{x.split('.').pop()?.toUpperCase().slice(0, 4)}</span><span className="nm">{x}</span></button>)}
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
                    {i === 0 && <PostingStep key={`${jobId}:${current ? 'loaded' : 'blank'}`} state={state} detail={current} onSaved={async (id, next, doc) => { setJobId(id); await reloadAll(); if (doc) setActiveDoc(doc); if (next) setStep(next === 'edit' ? 2 : 1); }} />}
                    {i === 1 && job && <DocumentsStep state={state} job={job} onDone={async first => { await reloadAll(); if (first) setActiveDoc(first); setStep(2); }} back={() => setStep(0)} />}
                    {i === 2 && job && <EditStep job={job} docs={current!.docs} active={activeDoc} setActive={setActiveDoc} next={() => setStep(3)} back={() => setStep(1)} />}
                    {i === 3 && job && <ExtrasStep state={state} job={job} reload={reloadAll} next={() => setStep(4)} back={() => setStep(2)} />}
                    {i === 4 && job && <BucketStep job={job} docs={current!.docs} state={state} reload={reloadAll} back={() => setStep(3)} />}
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
  return [true, job.docs.length > 0, job.docs.length > 0, job.extras.length > 0, job.status !== 'saved'][i];
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

function PostingStep({ state, detail, onSaved }: { state: AppState; detail: JobDetail | null; onSaved: (id: string, next: false | 'docs' | 'edit', doc?: string) => Promise<void> }) {
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

  // a new application starts from your main CV and main cover letter in the posting's language
  const lang = docLang(f.language);
  const starts = job ? [] : [mainOf(state.templates, 'cv', lang), mainOf(state.templates, 'cover', lang)].filter((x): x is TemplateInfo => !!x);

  async function save(next: false | 'docs' | 'edit') {
    setBusy('save');
    const r = await run(async () => {
      if (job) { await api.updateJob(job.id, { ...f, postingComplete: complete.ok }); await api.savePosting(job.id, text); return { id: job.id, doc: undefined }; }
      const id = (await api.createJob(f, text, html, complete.ok)).id;
      let doc: string | undefined;
      if (next === 'edit') for (const t of starts) { const n = (await api.addDoc(id, t.id)).name; doc ??= n; }
      return { id, doc };
    }, job ? 'Saved' : 'Application folder created');
    setBusy('');
    if (r) await onSaved(r.id, r.doc ? 'edit' : next && 'docs', r.doc);
  }

  const label = (k: keyof JobFields, l: string, wide = false) => (
    <label key={k} className={'f' + (aiKeys.has(k) ? ' ai' : '') + (wide ? ' w' : '')}><span>{l}</span>
      <input className="input" value={f[k] as string} onChange={e => set(k, e.target.value)} placeholder={k === 'deadline' ? 'YYYY-MM-DD' : ''} /></label>
  );

  return (
    <>
      <div className="ph" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div><div className="step">Step 1 of 5</div><h2>Posting &amp; details</h2>
          <p>Paste a link or the full text.{state.ai.configured ? ' The AI fills in the details, and you can edit every field.' : ' Add an AI provider in Settings to fill the details automatically.'}</p></div>
        {job && <button className="pill" onClick={e => setMenu(e.currentTarget.getBoundingClientRect())}><Dot s={job.status} />{STATUS[job.status].label} ▾</button>}
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
        {starts.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Starts from {starts.map(t => `“${t.title}”`).join(' + ')}</span>}
        <button className="btn" onClick={() => save(false)} disabled={!!busy}>Save</button>
        {starts.length
          ? <button className="btn pri" onClick={() => save('edit')} disabled={!!busy || (!f.title && !f.company)} title={`Copies ${starts.map(t => `"${t.title}"`).join(' and ')} into this application`}>Save &amp; start with your {starts.length > 1 ? 'CV and letter' : starts[0].kind === 'cover' ? 'letter' : 'CV'} →</button>
          : <button className="btn pri" onClick={() => save('docs')} disabled={!!busy || (!f.title && !f.company)}>Save &amp; choose documents →</button>}
      </div>
      {menu && job && <StatusMenu anchor={menu} current={job.status} onClose={() => setMenu(null)}
        onPick={async (s, note) => { setMenu(null); if (await run(() => api.setStatus(job.id, s, note), `Marked as ${STATUS[s].label}`)) await onSaved(job.id, false); }} />}
    </>
  );
}

const pick = (j: Job): JobFields => ({ title: j.title, company: j.company, location: j.location, salary: j.salary, deadline: j.deadline, language: j.language, url: j.url, keywords: j.keywords, contact: j.contact, notes: j.notes });

/* ---------------- step 2: choose templates ---------------- */
function DocumentsStep({ state, job, onDone, back }: { state: AppState; job: Job; onDone: (first?: string) => Promise<void>; back: () => void }) {
  const [bodies, setBodies] = useState<Record<string, { meta: DocMeta; body: string }>>({});
  const de = /german|deutsch/i.test(job.language);
  const suggested = (t: TemplateInfo) => t.kind !== 'other' && (de ? t.lang.startsWith('de') : !t.lang.startsWith('de'));
  const [sel, setSel] = useState<Set<string>>(() => job.docs.length ? new Set() : new Set(firstPerKind(state.templates.filter(suggested))));
  const [busy, setBusy] = useState(false);
  const run = useAction();

  useEffect(() => {
    Promise.all(state.templates.map(t => api.template(t.id).then(r => [t.id, r] as const).catch(() => null)))
      .then(list => setBodies(Object.fromEntries(list.filter(x => x !== null))));
  }, [state.templates]);

  const fromTemplate = (id: string) => job.docs.filter(d => d === id + '.md' || d.startsWith(id + '-'));

  async function copy() {
    setBusy(true);
    let first: string | undefined;
    for (const id of sel) { const r = await run(() => api.addDoc(job.id, id)); first ??= r?.name; }
    setBusy(false);
    await onDone(first);
  }

  return (
    <>
      <div className="ph"><div className="step">Step 2 of 5</div><h2>Choose documents</h2><p>Pick your CV and letters for this job. They are copied into this application's folder with your details filled in; your originals under My documents stay unchanged.</p></div>
      <div className="pb">
        {job.language && <div className="note" style={{ marginBottom: 18 }}>The posting is in <b>{job.language}</b>, so {de ? 'German' : 'English'} templates are suggested.</div>}
        <div className="tgrid">
          {state.templates.map(t => {
            const have = fromTemplate(t.id);
            const b = bodies[t.id];
            return (
              <div key={t.id} className={'tpl' + (sel.has(t.id) ? ' on' : '')} onClick={() => setSel(s => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}>
                <span className="chk">✓</span>
                {have.length > 0 && <span className="badge ok have">In this job</span>}
                <div className="thumb">{b && <div dangerouslySetInnerHTML={{ __html: renderDoc(parseBlocks(b.body), b.meta.theme, b.meta.kind, b.meta.lang, b.meta.style) }} />}</div>
                <div className="nm">{t.title}</div>
                <small>{t.kind === 'cover' ? 'Cover letter' : t.kind === 'cv' ? 'CV' : 'Other'} · {t.lang.toUpperCase()} · {THEMES[t.theme]?.name ?? t.theme}{suggested(t) && job.language ? ' · suggested' : ''}</small>
              </div>
            );
          })}
        </div>
        {!state.templates.length && <p className="empty">Nothing under My documents yet. Upload your CV there first.</p>}
      </div>
      <div className="pf">
        <span className="muted"><b>{sel.size}</b> selected{job.docs.length ? ` · ${job.docs.length} already in this job` : ''}</span><span className="sp" />
        <button className="btn" onClick={back}>← Back</button>
        {job.docs.length > 0 && <button className="btn" onClick={() => onDone()}>Skip to editing</button>}
        <button className="btn pri" onClick={copy} disabled={!sel.size || busy}>{busy ? 'Copying…' : 'Copy into job & edit →'}</button>
      </div>
    </>
  );
}

function firstPerKind(ts: TemplateInfo[]) {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of ts) if (!seen.has(t.kind)) { seen.add(t.kind); out.push(t.id); }
  return out;
}

/* ---------------- step 3: edit ---------------- */
function EditStep({ job, docs, active, setActive, next, back }: { job: Job; docs: Doc[]; active: string | null; setActive: (n: string) => void; next: () => void; back: () => void }) {
  const name = active && job.docs.includes(active) ? active : job.docs[0];
  const [doc, setDoc] = useState<Doc | null>(null);
  const [saving, setSaving] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [preview, setPreview] = useState<{ v: VersionInfo; body: string } | null>(null);
  const [tailorMode, setTailorMode] = useState(false);
  const timer = useRef<number>();
  const pending = useRef<string | null>(null);
  const run = useAction();

  const loadVersions = () => name && api.versions(job.id, name).then(setVersions).catch(() => {});
  useEffect(() => {
    setPreview(null);
    if (!name) return;
    const d = docs.find(x => x.name === name);
    if (d) setDoc(d); else api.doc(job.id, name).then(setDoc);
    loadVersions();
  }, [name, job.id]);

  const flush = async (version = false) => {
    if (pending.current === null || !name) return;
    const body = pending.current; pending.current = null;
    setSaving('saving');
    const r = await run(() => api.saveDoc(job.id, name, body, undefined, version));
    if (!r) {
      // keep the text queued (unless something newer replaced it) and try again shortly
      pending.current ??= body;
      setSaving('dirty');
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(version), 5000);
      return;
    }
    setSaving(pending.current === null ? 'saved' : 'dirty');
    loadVersions();
  };
  useUnsavedWarning(saving !== 'saved');
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, [name]);

  function change(body: string, opts?: { version?: boolean }) {
    setDoc(d => d && { ...d, body });
    pending.current = body; setSaving('dirty');
    clearTimeout(timer.current);
    // an accepted AI change saves right away, keeping the text before it as a version
    if (opts?.version) flush(true);
    else timer.current = window.setTimeout(() => flush(), 700);
  }

  const tailor: Tailor = (body, block, instruction, avoid) => api.rewrite(job.id, name!, body, block, instruction, avoid);

  /** theme and formatting-bar settings; shown at once, then saved */
  async function setMeta(patch: Partial<DocMeta>) {
    if (!doc || !name) return;
    setDoc(d => d && { ...d, meta: { ...d.meta, ...patch } });
    await flush();
    const r = await run(() => api.saveDoc(job.id, name, pending.current ?? doc.body, patch));
    if (r) setDoc(d => d && { ...d, meta: r.meta });
  }

  if (!name) return <div className="pb empty">No documents yet. <button className="link" onClick={back}>Choose documents</button></div>;
  const match = doc ? keywordMatch(doc.body, job.keywords) : null;
  const unfilled = doc ? [...new Set([...doc.body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map(m => m[1]))] : [];

  return (
    <>
      <div className="edbar">
        {job.docs.map(d => <button key={d} className={'dtab' + (d === name ? ' on' : '')} onClick={async () => { await flush(); setActive(d); }}>{d}</button>)}
        <span className="sp" />
        <span className="muted" style={{ fontSize: 12 }}>{saving === 'saving' ? 'Saving…' : saving === 'dirty' ? 'Unsaved' : 'Saved'}</span>
        <select className="input" style={{ width: 'auto', padding: '5px 8px' }} value={doc?.meta.theme ?? 'classic'} onChange={e => setMeta({ theme: e.target.value })}>
          {Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>Theme: {t.name}</option>)}
        </select>
        <button className="btn sm" onClick={async () => { await flush(); window.open(`/print?job=${encodeURIComponent(job.id)}&docs=${encodeURIComponent(name)}`, '_blank'); }}>Print / PDF</button>
        <button className={'btn sm' + (tailorMode ? ' pri' : '')} disabled={!!preview} title="Click a line to get a version tailored to this job, then accept or reject it" onClick={() => setTailorMode(t => !t)}>{tailorMode ? '✨ Tailoring: on' : '✨ Tailor'}</button>
      </div>
      <div className="edwrap">
        <div style={{ minWidth: 0 }}>
          {preview ? (
            <>
              <div className="note" style={{ maxWidth: 794, margin: '0 auto 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span>Viewing the version from <b>{fmtDateTime(preview.v.at)}</b>.</span><span className="sp" />
                <button className="btn sm" onClick={() => setPreview(null)}>Back to current</button>
                <button className="btn sm pri" onClick={async () => { await flush(); const r = await run(() => api.restore(job.id, name, preview.v.id), 'Version restored (the current text was saved as a version first)'); if (r) { setDoc(r); setPreview(null); loadVersions(); } }}>Restore this version</button>
              </div>
              {doc && <DocEditor body={preview.body} meta={doc.meta} readOnly />}
            </>
          ) : doc && <DocEditor key={name} body={doc.body} meta={doc.meta} onChange={change} onMeta={setMeta} tailor={tailor} tailorMode={tailorMode} />}
        </div>
        <div className="margin">
          {match && match.score !== null && (
            <div className="card"><h4>Keyword match</h4>
              <div className="meter"><i style={{ width: match.score + '%' }} /></div><b style={{ fontSize: 20 }}>{match.score}%</b>
              {match.missing.length > 0 && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Not mentioned yet:<br />{match.missing.map(k => <span key={k} className="kw miss">{k}</span>)}</p>}
            </div>
          )}
          {!job.keywords.length && <div className="card muted" style={{ fontSize: 12.5 }}>Add key requirements in step 1 to see a keyword match here.</div>}
          {unfilled.length > 0 && <div className="note" style={{ fontSize: 12.5 }}>Not filled in: {unfilled.map(u => <code key={u}>{`{{${u}}}`} </code>)}<br />Click the line to type it here, or set it in Profile for future copies.</div>}
          <div className="card"><h4>Versions</h4>
            <div className="vlist">
              {versions.slice(0, 12).map(v => (
                <button key={v.id} className={preview?.v.id === v.id ? 'on' : ''} onClick={async () => { const r = await run(() => api.version(job.id, name, v.id)); if (r) setPreview({ v, body: r.body }); }}>
                  <span>{fmtDateTime(v.at)}</span><span className="muted">view</span></button>
              ))}
              {!versions.length && <span className="muted" style={{ fontSize: 12 }}>Earlier versions appear here as you edit.</span>}
            </div>
            <button className="btn sm" style={{ marginTop: 8, width: '100%' }} onClick={async () => { await flush(); if (doc && await run(() => api.saveDoc(job.id, name, doc.body, undefined, true), 'Version saved')) loadVersions(); }}>Save a version now</button>
          </div>
        </div>
      </div>
      <div className="pf"><span className="muted">Edits save automatically. A version is kept at most every 10 minutes, plus whenever you click "Save a version now".</span><span className="sp" />
        <button className="btn" onClick={back}>← Back</button><button className="btn pri" onClick={async () => { await flush(); next(); }}>Add extras →</button></div>
    </>
  );
}

/* ---------------- step 4: extras ---------------- */
function ExtrasStep({ state, job, reload, next, back }: { state: AppState; job: Job; reload: () => Promise<void>; next: () => void; back: () => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = useAction();
  const toggle = (name: string) => run(() => job.extras.includes(name) ? api.detachExtra(job.id, name) : api.attachExtra(job.id, name)).then(reload);
  async function upload(files: FileList | null) {
    for (const f of files ?? []) {
      const r = await run(() => api.uploadExtra(f));
      if (r) await run(() => api.attachExtra(job.id, r.name));
    }
    await reload();
  }
  return (
    <>
      <div className="ph"><div className="step">Step 4 of 5</div><h2>Add extras</h2><p>Attach certificates, references or a portfolio from your Extras library, or drop new files here.</p></div>
      <div className="pb">
        <div className="xlist">
          {state.extras.map(x => (
            <div key={x.name} className={'x' + (job.extras.includes(x.name) ? ' on' : '')} onClick={() => toggle(x.name)}>
              <span className="ic">{x.name.split('.').pop()?.toUpperCase().slice(0, 4)}</span>
              <span className="tx"><b>{x.name}</b><small>{(x.size / 1024).toFixed(0)} KB · <a href="#" onClick={e => { e.preventDefault(); e.stopPropagation(); run(() => api.openExtra(x.name)); }}>open</a></small></span>
              <span className="tg" />
            </div>
          ))}
        </div>
        {!state.extras.length && <p className="muted">Your Extras library is empty.</p>}
        <div className={'drop' + (over ? ' over' : '')} onClick={() => input.current?.click()}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
          Drop PDFs here, or <u>browse</u>. They're added to this job and to your Extras library.
          <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg" onChange={e => upload(e.target.files)} />
        </div>
      </div>
      <div className="pf"><span className="sp" /><button className="btn" onClick={back}>← Back</button><button className="btn pri" onClick={next}>Final bucket →</button></div>
    </>
  );
}

/* ---------------- step 5: bucket ---------------- */
function BucketStep({ job, docs, state, reload, back }: { job: Job; docs: Doc[]; state: AppState; reload: () => Promise<void>; back: () => void }) {
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

  return (
    <>
      <div className="ph"><div className="step">Step 5 of 5</div><h2>Final bucket</h2><p>Drag or use the arrows to set the order. The merged PDF, the zip and the preview all follow it.</p></div>
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
              {!n.endsWith('.md') && <button className="btn sm" onClick={() => run(() => api.openFile(job.id, n))}>Open</button>}
              <button className="btn sm" onClick={() => save(order.filter(x => x !== n))}>Remove</button>
            </div>
          ))}
          {!order.length && <p className="muted">Nothing in the bucket yet.</p>}
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
