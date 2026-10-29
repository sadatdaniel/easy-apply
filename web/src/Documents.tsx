import { useEffect, useMemo, useRef, useState } from 'react';
import { parseBlocks } from '@shared/blocks';
import { EXAMPLES } from '@shared/examples';
import { renderMeta } from '@shared/render';
import type { AppState, DocKind, DocMeta, Job, TemplateInfo } from '@shared/types';
import { api, type Doc } from './api';
import { DocWorkspace, NameEdit, type DocStore } from './DocWorkspace';
import { readCvFile } from './ImportCv';
import { useSortable } from './sortable';
import { ContextMenu, useAction, useToast, type MenuItem } from './ui';

/*
  Step 2: the application's documents. A strip across the top holds every file in the job's folder (CV,
  cover letter, anything else), each with a small preview; pick one to edit or look at it below. Adding or
  replacing opens a Finder-like picker: what you used last on top, then Documents, the examples and your
  files, with a large preview of the one you point at.
*/

type Want = 'cv' | 'cover' | 'any';
const isFile = (n: string) => !n.endsWith('.md');
const ext = (n: string) => n.split('.').pop()?.toUpperCase().slice(0, 4) ?? '';
const KIND: Record<DocKind | 'file', string> = { cv: 'CV', cover: 'Cover letter', other: 'Document', file: 'File' };

export function DocumentsStep({ state, job, reload, active, setActive, next, back }: {
  state: AppState; job: Job; reload: () => Promise<void>; active: string | null; setActive: (n: string | null) => void; next: () => void; back: () => void;
}) {
  // fresh from disk, not from the job's first load: edits and themes changed here show everywhere
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [picker, setPicker] = useState<{ want: Want; replace?: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [over, setOver] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null); // a new order, shown while it saves
  const run = useAction();
  const toast = useToast();

  useEffect(() => {
    let live = true;
    Promise.all(job.docs.map(d => api.doc(job.id, d).catch(() => null))).then(list => {
      if (live) setDocs(Object.fromEntries(list.filter((d): d is Doc => !!d).map(d => [d.name, d])));
    });
    return () => { live = false; };
  }, [job.id, job.docs.join('|')]);

  // the strip follows the send order, then anything not in it
  const saved = [...job.bucket.filter(n => job.docs.includes(n) || job.extras.includes(n)), ...[...job.docs, ...job.extras].filter(n => !job.bucket.includes(n))];
  const files = order ?? saved;
  async function reorder(next: string[] | null) {
    if (!next || next.join('|') === saved.join('|')) { setOrder(null); return; }
    setOrder(next);
    await run(() => api.setBucket(job.id, next.filter(n => job.bucket.includes(n))));
    await reload();
    setOrder(null);
  }
  const sort = useSortable(files, 'x', reorder);
  // the strip runs sideways, so the mouse wheel does too (a passive React listener can't stop the page scrolling)
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const kindOf = (n: string): DocKind | 'file' => (isFile(n) ? 'file' : docs[n]?.meta.kind ?? 'other');
  const has = (k: DocKind) => files.some(n => kindOf(n) === k);
  const current = active && files.includes(active) ? active : files[0] ?? null;

  async function add(picks: Pick[], replace?: string) {
    let first: string | undefined;
    for (const p of picks) {
      const put = () => p.src === 'template' ? api.addDoc(job.id, p.id).then(r => r.name)
        : p.src === 'example' ? api.addExample(job.id, p.id).then(r => r.name)
        : api.attachExtra(job.id, p.id).then(() => p.id);
      const name = await run(() => replace && !first ? api.replaceIn(job.id, replace, put) : put());
      first ??= name;
    }
    await reload();
    if (first) setActive(first);
  }

  async function removeFile(n: string) {
    const ok = await run(() => (isFile(n) ? api.detachExtra(job.id, n) : api.removeDoc(job.id, n)), `Removed ${n} from this application (kept in its .removed folder)`);
    if (ok === undefined) return;
    if (current === n) setActive(null);
    await reload();
  }

  /** files dropped from the computer: PDFs and images are attached; Word files become documents */
  async function drop(list: FileList | File[]) {
    const picks: Pick[] = [];
    for (const f of list) {
      if (/\.(pdf|png|jpe?g)$/i.test(f.name)) { const r = await run(() => api.uploadExtra(f)); if (r) picks.push({ src: 'file', id: r.name }); }
      else if (/\.docx$/i.test(f.name)) { const id = await importDoc(f); if (id) picks.push({ src: 'template', id }); }
      else toast(`${f.name}: only PDF, PNG, JPG and Word (.docx) files can be added.`, true);
    }
    if (picks.length) await add(picks);
  }
  async function importDoc(f: File, want: Want = 'any') {
    const up = await run(() => readCvFile(f));
    const part = up?.parts[0];
    if (!part) return undefined;
    const kind = want === 'any' ? part.imported.kind : want;
    const title = f.name.replace(/\.[^.]+$/, '');
    const look = part.look ? { theme: 'original', look: part.look } : { theme: 'classic' };
    const r = await run(() => api.importTemplate({ title, kind, lang: part.imported.lang, ...look }, part.imported.markdown), `Added "${title}" to Documents`);
    return (r as { id?: string } | undefined)?.id;
  }

  const cardMenu = (n: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const k = kindOf(n);
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open', onClick: () => setActive(n) },
      { label: `Replace with another ${k === 'file' ? 'file' : KIND[k].toLowerCase()}…`, onClick: () => setPicker({ want: k === 'cv' || k === 'cover' ? k : 'any', replace: n }) },
      ...(isFile(n) ? [{ label: 'Open in a new tab', onClick: () => run(() => api.openFile(job.id, n)) }] : []),
      { label: 'Remove from this application', danger: true, onClick: () => removeFile(n),
        confirm: `Remove "${docs[n]?.meta.title ?? n}" from this application? The file moves to the application's .removed folder, so nothing is lost.` },
    ] });
  };

  return (
    <>
      <div ref={strip} className={'strip' + (over ? ' over' : '') + (sort.dragging ? ' sorting' : '')}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
        onDrop={e => { e.preventDefault(); setOver(false); drop(e.dataTransfer.files); }}>
        {files.map(n => (
          <button key={n} {...sort.item(n)} className={'scard' + (n === current ? ' on' : '') + (job.bucket.includes(n) ? '' : ' off')}
            onClick={() => { if (!sort.clickWasDrag()) setActive(n); }}
            onContextMenu={e => cardMenu(n, e)} title={`${n} · drag to change the order they are exported in`}>
            <span className="th">{isFile(n) ? <FileThumb job={job.id} name={n} /> : docs[n] && <MiniDoc doc={docs[n]} />}</span>
            <span className="tx"><b>{docs[n]?.meta.title ?? n}</b><small>{job.bucket.includes(n) ? `${KIND[kindOf(n)]} · ${n}` : 'left out of the export'}</small></span>
            <span className="more" role="button" aria-label="More" data-nodrag onClick={e => cardMenu(n, e)}>⋯</span>
          </button>
        ))}
        {!has('cv') && <button className="scard slot" onClick={() => setPicker({ want: 'cv' })}><span className="plus">+</span><span className="tx"><b>Choose a CV</b><small>from Documents or an example</small></span></button>}
        {!has('cover') && <button className="scard slot" onClick={() => setPicker({ want: 'cover' })}><span className="plus">+</span><span className="tx"><b>Choose a cover letter</b><small>optional</small></span></button>}
        <button className="scard slot add" onClick={() => setPicker({ want: 'any' })}><span className="plus">+</span><span className="tx"><b>Add</b><small>documents or files, or drop them here</small></span></button>
      </div>

      {current && !isFile(current) && docs[current] && (
        <DocPane key={current} job={job} doc={docs[current]} onSaved={d => setDocs(m => ({ ...m, [d.name]: d }))}
          replace={() => setPicker({ want: kindOf(current) === 'cv' || kindOf(current) === 'cover' ? kindOf(current) as Want : 'any', replace: current })} />
      )}
      {current && isFile(current) && <FilePane job={job} name={current} replace={() => setPicker({ want: 'any', replace: current })} remove={() => removeFile(current)} />}
      {!current && (
        <div className="pb">
          <div className="start-empty">
            <p className="serif">Which documents go to {job.company || 'this company'}?</p>
            <p className="muted">Each one is copied into this application's folder, so you can change it for this job without touching your originals.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn pri" onClick={() => setPicker({ want: 'cv' })}>Choose a CV</button>
              <button className="btn" onClick={() => setPicker({ want: 'cover' })}>Choose a cover letter</button>
              <button className="btn" onClick={() => setPicker({ want: 'any' })}>Add files</button>
            </div>
          </div>
        </div>
      )}

      <div className="pf"><span className="muted">{files.length} file{files.length === 1 ? '' : 's'} in this application · right-click a file to replace or remove it</span><span className="sp" />
        <button className="btn" onClick={back}>← Back</button><button className="btn pri" onClick={next} disabled={!files.length}>Export →</button></div>

      {picker && <Picker state={state} want={picker.want} replacing={picker.replace} inJob={job}
        onClose={() => setPicker(null)} importDoc={importDoc}
        onPick={async picks => { setPicker(null); await add(picks, picker.replace); }} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </>
  );
}

/* ---------------- small previews ---------------- */
export function MiniDoc({ doc }: { doc: { meta: DocMeta; body: string } }) {
  const html = useMemo(() => renderMeta(parseBlocks(doc.body), doc.meta), [doc.body, doc.meta]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** a PDF's first page (via the browser's own viewer) or an image */
export function FileThumb({ job, name, library = false, big = false }: { job?: string; name: string; library?: boolean; big?: boolean }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!big && !/\.(png|jpe?g)$/i.test(name)) return;
    let u = '';
    (library ? api.extraBlob(name) : api.fileBlob(job!, name)).then(b => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => {});
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [job, name, big]);
  if (/\.(png|jpe?g)$/i.test(name)) return url ? <img src={url} alt="" /> : null;
  if (big && url) return <iframe title={name} src={url + '#toolbar=0&view=FitH'} />;
  return <span className="fext">{ext(name)}</span>;
}

/* ---------------- one document: the editor ---------------- */
function DocPane({ job, doc, onSaved, replace }: { job: Job; doc: Doc; onSaved: (d: Doc) => void; replace: () => void }) {
  const name = doc.name;
  const store: DocStore = {
    save: (body, meta, version) => api.saveDoc(job.id, name, body, meta, version),
    versions: () => api.versions(job.id, name),
    version: id => api.version(job.id, name, id).then(r => r.body),
    restore: id => api.restore(job.id, name, id),
    tailor: (body, block, instruction, avoid) => api.rewrite(job.id, name, body, block, instruction, avoid),
    keywords: job.keywords,
    print: () => window.open(`/print?job=${encodeURIComponent(job.id)}&docs=${encodeURIComponent(name)}`, '_blank'),
  };
  return <DocWorkspace doc={doc} store={store} onSaved={d => onSaved({ ...d, name })}
    head={(meta, setMeta) => <><NameEdit value={meta.title} onChange={title => setMeta({ title }, false)} /><span className="muted mono" style={{ fontSize: 12 }}>{name}</span></>}
    tools={<button className="btn sm" onClick={replace}>Replace…</button>} />;
}

/* ---------------- one file: a preview ---------------- */
function FilePane({ job, name, replace, remove }: { job: Job; name: string; replace: () => void; remove: () => void }) {
  const run = useAction();
  return (
    <>
      <div className="edbar">
        <b className="ed-title">{name}</b><span className="sp" />
        <button className="btn sm" onClick={() => run(() => api.openFile(job.id, name))}>Open in a new tab</button>
        <button className="btn sm" onClick={replace}>Replace…</button>
        <button className="btn sm" onClick={remove}>Remove</button>
      </div>
      <div className="filepane"><FileThumb job={job.id} name={name} big /></div>
    </>
  );
}

/* ---------------- the picker ---------------- */
interface Pick { src: 'template' | 'example' | 'file'; id: string }
interface Item extends Pick { key: string; title: string; kind: DocKind | 'file'; sub: string; meta?: DocMeta; body?: string }
type Section = 'recent' | 'mine' | 'examples' | 'files';

/** what you used last, newest first: Documents ids, example ids and file names */
function recent(jobs: Job[], templates: TemplateInfo[]) {
  const out: { key: string; job: Job }[] = [];
  const seen = new Set<string>();
  for (const j of [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    for (const d of j.docs) {
      const src = j.sources?.[d] ?? templates.find(t => d === t.id + '.md' || d.startsWith(t.id + '-'))?.id;
      const key = src?.startsWith('example:') ? 'example:' + src.slice(8) : src ? 'template:' + src : '';
      if (key && !seen.has(key)) { seen.add(key); out.push({ key, job: j }); }
    }
    for (const x of j.extras) if (!seen.has('file:' + x)) { seen.add('file:' + x); out.push({ key: 'file:' + x, job: j }); }
  }
  return out;
}

function Picker({ state, want, replacing, inJob, onPick, onClose, importDoc }: {
  state: AppState; want: Want; replacing?: string; inJob: Job; onPick: (p: Pick[]) => void; onClose: () => void;
  importDoc: (f: File, want: Want) => Promise<string | undefined>;
}) {
  const [bodies, setBodies] = useState<Record<string, { meta: DocMeta; body: string }>>({});
  const [extraNames, setExtraNames] = useState(state.extras.map(x => x.name));
  const [templates, setTemplates] = useState(state.templates);
  const [sel, setSel] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = useAction();
  const multi = !replacing && want === 'any';

  useEffect(() => {
    Promise.all(templates.map(t => api.template(t.id).then(r => [t.id, r] as const).catch(() => null)))
      .then(list => setBodies(Object.fromEntries(list.filter(x => x !== null))));
  }, [templates]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);

  const fits = (k: DocKind | 'file') => want === 'any' || k === want;
  const items = useMemo(() => {
    const all = new Map<string, Item>();
    for (const t of templates) all.set('template:' + t.id, { key: 'template:' + t.id, src: 'template', id: t.id, title: t.title, kind: t.kind, sub: `${KIND[t.kind]} · ${t.lang.toUpperCase()}`, meta: bodies[t.id]?.meta, body: bodies[t.id]?.body });
    for (const e of EXAMPLES) all.set('example:' + e.id, { key: 'example:' + e.id, src: 'example', id: e.id, title: e.meta.title, kind: e.meta.kind, sub: `Example · ${KIND[e.meta.kind]}`, meta: e.meta, body: e.body });
    for (const x of extraNames) all.set('file:' + x, { key: 'file:' + x, src: 'file', id: x, title: x, kind: 'file', sub: `File · ${ext(x)}` });
    return all;
  }, [templates, bodies, extraNames]);
  const used = useMemo(() => recent(state.jobs.filter(j => j.id !== inJob.id), templates), [state.jobs, templates]);
  const lists: Record<Section, Item[]> = {
    recent: used.map(u => items.get(u.key)).filter((i): i is Item => !!i && fits(i.kind)).slice(0, 12),
    mine: [...items.values()].filter(i => i.src === 'template' && fits(i.kind)),
    examples: [...items.values()].filter(i => i.src === 'example' && fits(i.kind)),
    files: want === 'any' ? [...items.values()].filter(i => i.src === 'file') : [],
  };
  const usedFor = (key: string) => used.find(u => u.key === key)?.job;
  const titles: Record<Section, string> = { recent: 'Used recently', mine: 'Documents', examples: 'Examples', files: 'Files' };
  const sections = (Object.keys(lists) as Section[]).filter(s => lists[s].length);
  const [section, setSection] = useState<Section | 'all'>('all');
  const shown = section === 'all' ? sections : [section];
  const focused = items.get(focus ?? sel[sel.length - 1] ?? '') ?? null;

  function toggle(key: string) {
    setFocus(key);
    setSel(s => (multi ? (s.includes(key) ? s.filter(k => k !== key) : [...s, key]) : [key]));
  }
  const pick = (keys = sel) => onPick(keys.map(k => items.get(k)!).filter(Boolean).map(({ src, id }) => ({ src, id })));

  /** files from the computer: PDFs and images join your files; Word files (and PDFs, when choosing a CV or letter) your documents */
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const added: string[] = [];
    for (const f of list) {
      const asDoc = /\.docx$/i.test(f.name) || (want !== 'any' && /\.pdf$/i.test(f.name));
      if (asDoc) { const id = await importDoc(f, want); if (id) added.push('template:' + id); }
      else if (/\.(pdf|png|jpe?g)$/i.test(f.name)) { const r = await run(() => api.uploadExtra(f)); if (r) { added.push('file:' + r.name); setExtraNames(n => [...n, r.name]); } }
    }
    const st = await run(() => api.state());
    if (st) setTemplates(st.templates);
    setBusy(false);
    if (added.length) { setSel(s => (multi ? [...s, ...added] : added.slice(-1))); setFocus(added[added.length - 1]); }
  }

  const heading = replacing ? `Replace ${replacing}` : want === 'cv' ? 'Choose a CV' : want === 'cover' ? 'Choose a cover letter' : 'Add to this application';
  return (
    <div className="pk-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'picker' + (over ? ' over' : '')} role="dialog" aria-label={heading}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
        onDrop={e => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
        <div className="pk-h"><b>{heading}</b><span className="sp" /><button className="btn sm" onClick={onClose}>Cancel</button></div>
        <div className="pk-body">
          <div className="pk-side">
            <button className={section === 'all' ? 'on' : ''} onClick={() => setSection('all')}>Everything</button>
            {sections.map(s => <button key={s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>{titles[s]}<span>{lists[s].length}</span></button>)}
            <div className="pk-drop" onClick={() => input.current?.click()}>
              {busy ? <><span className="spin" /> Reading…</> : <>Drop files here<br /><u>or browse</u></>}
              <small>{want === 'any' ? 'PDF, images, Word' : 'Word or PDF'}</small>
              <input ref={input} type="file" multiple={multi} hidden accept={want === 'any' ? '.pdf,.png,.jpg,.jpeg,.docx' : '.docx,.pdf'} onChange={e => { upload(e.target.files); e.target.value = ''; }} />
            </div>
          </div>
          <div className="pk-grid">
            {shown.map(s => (
              <div key={s}>
                <div className="grp">{titles[s]}</div>
                <div className="pk-cards">
                  {lists[s].map(i => {
                    const on = sel.includes(i.key);
                    const j = s === 'recent' ? usedFor(i.key) : undefined;
                    return (
                      <button key={s + i.key} className={'pk-card' + (on ? ' on' : '') + (focus === i.key ? ' focus' : '')} onClick={() => toggle(i.key)} onDoubleClick={() => pick(multi ? [...new Set([...sel, i.key])] : [i.key])}>
                        <span className="th">{i.src === 'file' ? <FileThumb name={i.id} library /> : i.meta && i.body !== undefined ? <MiniDoc doc={{ meta: i.meta, body: i.body }} /> : null}</span>
                        <span className="tick">✓</span>
                        <span className="tx"><b>{i.title}</b><small>{j ? `used for ${j.company || j.title}` : i.sub}</small></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {!sections.length && <p className="muted" style={{ padding: 20 }}>Nothing here yet. Drop a file on the left, or browse.</p>}
          </div>
          <div className="pk-prev">
            {focused ? (
              <>
                <div className="pk-big">{focused.src === 'file' ? <FileThumb name={focused.id} library big /> : focused.meta && focused.body !== undefined && <MiniDoc doc={{ meta: focused.meta, body: focused.body }} />}</div>
                <b>{focused.title}</b>
                <small className="muted">{focused.sub}</small>
                {focused.src === 'example' && <small className="muted">{EXAMPLES.find(e => e.id === focused.id)?.note} Replace Alex's details with yours after adding.</small>}
              </>
            ) : <p className="muted" style={{ fontSize: 13 }}>Click a document to see it here. {multi ? 'Pick as many as you like.' : ''}</p>}
          </div>
        </div>
        <div className="pk-f">
          <span className="muted">{sel.length ? `${sel.length} selected` : multi ? 'Click to select, double-click to add one right away' : 'Click to select, double-click to use it right away'}</span>
          <span className="sp" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={!sel.length} onClick={() => pick()}>{replacing ? 'Replace' : sel.length > 1 ? `Add ${sel.length}` : 'Add'}</button>
        </div>
      </div>
    </div>
  );
}
