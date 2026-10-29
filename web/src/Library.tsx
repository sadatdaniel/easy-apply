import { useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLES } from '@shared/examples';
import { THEMES } from '@shared/render';
import type { AppState, DocKind, DocMeta } from '@shared/types';
import { api } from './api';
import { FileThumb, MiniDoc } from './Documents';
import { DocWorkspace } from './DocWorkspace';
import { ImportReview, readCvFile, type CvUpload } from './ImportCv';
import { ContextMenu, fmtDate, useAction, useToast, type MenuItem } from './ui';

/*
  My documents: one folder with your CVs, cover letters and files (certificates, references …), shown like
  the picker in an application: sections on the left, the documents as pages, a large preview of the one you
  pick. Open one to edit it in its own window. These are your originals: an application always works on its
  own copy.
*/

type Section = 'all' | 'cv' | 'cover' | 'other' | 'files' | 'examples';
interface Item { key: string; src: 'template' | 'example' | 'file'; id: string; title: string; kind: DocKind | 'file'; sub: string; meta?: DocMeta; body?: string }
const KIND: Record<DocKind | 'file', string> = { cv: 'CV', cover: 'Cover letter', other: 'Document', file: 'File' };
const LANG = (l: string) => (l === 'de' ? 'Deutsch' : l === 'en' ? 'English' : l.toUpperCase());
const ext = (n: string) => n.split('.').pop()?.toUpperCase().slice(0, 4) ?? '';

export function Library({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const [bodies, setBodies] = useState<Record<string, { meta: DocMeta; body: string }>>({});
  const [section, setSection] = useState<Section>('all');
  const [focus, setFocus] = useState<string | null>(null);
  const [upload, setUpload] = useState<CvUpload | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; ask?: MenuItem } | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const docInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const run = useAction();
  const toast = useToast();

  useEffect(() => {
    let live = true;
    Promise.all(state.templates.map(t => api.template(t.id).then(r => [t.id, r] as const).catch(() => null)))
      .then(list => { if (live) setBodies(Object.fromEntries(list.filter(x => x !== null))); });
    return () => { live = false; };
  }, [state.templates]);

  // how many applications use each original or file
  const used = useMemo(() => {
    const n = new Map<string, number>();
    for (const j of state.jobs) {
      const here = new Set([...Object.values(j.sources ?? {}).map(s => (s.startsWith('example:') ? s : 'template:' + s)), ...j.extras.map(x => 'file:' + x)]);
      for (const k of here) n.set(k, (n.get(k) ?? 0) + 1);
    }
    return n;
  }, [state.jobs]);
  const usedText = (key: string) => { const c = used.get(key); return c ? ` · in ${c} application${c === 1 ? '' : 's'}` : ''; };

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const t of state.templates) out.push({ key: 'template:' + t.id, src: 'template', id: t.id, title: t.title, kind: t.kind, sub: `${KIND[t.kind]} · ${LANG(t.lang)} · ${THEMES[t.theme]?.name ?? t.theme}`, meta: bodies[t.id]?.meta, body: bodies[t.id]?.body });
    for (const x of state.extras) out.push({ key: 'file:' + x.name, src: 'file', id: x.name, title: x.name, kind: 'file', sub: `${ext(x.name)} · ${(x.size / 1024).toFixed(0)} KB · ${fmtDate(x.updatedAt)}` });
    for (const e of EXAMPLES) out.push({ key: 'example:' + e.id, src: 'example', id: e.id, title: e.meta.title, kind: e.meta.kind, sub: `Example · ${KIND[e.meta.kind]}`, meta: e.meta, body: e.body });
    return out;
  }, [state.templates, state.extras, bodies]);
  const lists: Record<Exclude<Section, 'all'>, Item[]> = {
    cv: items.filter(i => i.src === 'template' && i.kind === 'cv'),
    cover: items.filter(i => i.src === 'template' && i.kind === 'cover'),
    other: items.filter(i => i.src === 'template' && i.kind === 'other'),
    files: items.filter(i => i.src === 'file'),
    examples: items.filter(i => i.src === 'example'),
  };
  const titles: Record<Section, string> = { all: 'Everything', cv: 'CVs', cover: 'Cover letters', other: 'Other documents', files: 'Files', examples: 'Examples' };
  const shown = (section === 'all' ? (['cv', 'cover', 'other', 'files', 'examples'] as const) : [section] as const).filter(s => lists[s].length || s === section);
  const focused = items.find(i => i.key === focus) ?? null;

  /* ---------- actions ---------- */
  async function created(id: string, open = false) { await refresh(); setFocus('template:' + id); if (open) setEditing(id); }
  async function newDoc(kind: 'cv' | 'cover') {
    const r = await run(() => api.createTemplate({ title: kind === 'cv' ? 'New CV' : 'New cover letter', kind, lang: 'en', theme: 'classic' }));
    if (r) await created(r.id, true);
  }
  async function duplicate(i: Item) {
    const r = await run(() => api.createTemplate({ title: `${i.title} (copy)`, kind: i.kind as DocKind, lang: i.meta?.lang ?? 'en', theme: i.meta?.theme ?? 'classic' }, i.id), `Made a copy of "${i.title}"`);
    if (r) await created(r.id);
  }
  async function fromExample(i: Item) {
    const ex = EXAMPLES.find(e => e.id === i.id)!;
    const r = await run(() => api.importTemplate({ ...ex.meta }, ex.body), `Added "${ex.meta.title}" to My documents. Replace Alex's details with yours.`);
    if (r) await created(r.id, true);
  }
  const remove = (i: Item): MenuItem => ({
    label: 'Delete…', danger: true,
    confirm: `Delete "${i.title}"? It moves to the .trash folder inside your files. Applications that use it keep their own copies.`,
    onClick: async () => {
      if (await run(() => (i.src === 'file' ? api.trashExtra(i.id) : api.trashTemplate(i.id)), `Deleted "${i.title}"`)) { setFocus(null); await refresh(); }
    },
  });
  const actions = (i: Item): MenuItem[] => i.src === 'example'
    ? [{ label: 'Add to My documents', onClick: () => fromExample(i) }]
    : i.src === 'file'
      ? [{ label: 'Open in a new tab', onClick: () => run(() => api.openExtra(i.id)) }, remove(i)]
      : [{ label: 'Edit', onClick: () => setEditing(i.id) }, { label: 'Duplicate', onClick: () => duplicate(i) }, remove(i)];
  const open = (i: Item) => (i.src === 'template' ? setEditing(i.id) : i.src === 'example' ? fromExample(i) : run(() => api.openExtra(i.id)));

  /** Word files and CV-like PDFs are read in for review; anything else (certificates, images) joins your files */
  async function take(list: FileList | File[] | null, as: 'auto' | 'file' = 'auto') {
    if (!list?.length) return;
    setBusy(true);
    let added = '';
    for (const f of list) {
      if (as === 'auto' && (/\.docx$/i.test(f.name) || /\.pdf$/i.test(f.name))) {
        const u = await readCvFile(f).catch(() => null);
        if (u && u.parts.some(p => p.imported.kind !== 'other')) { setUpload(u); break; }
        if (/\.docx$/i.test(f.name)) { if (u) { setUpload(u); break; } toast(`${f.name} could not be read.`, true); continue; }
      }
      if (/\.(pdf|png|jpe?g)$/i.test(f.name)) { const r = await run(() => api.uploadExtra(f), `Added ${f.name} to your files`); if (r) added = r.name; }
      else toast(`${f.name}: only Word, PDF, PNG and JPG files can be added.`, true);
    }
    setBusy(false);
    if (added) { await refresh(); setFocus('file:' + added); }
  }

  if (upload) return (
    <div className="content" style={{ background: 'var(--bg)' }}>
      <ImportReview upload={upload} templates={state.templates} onCancel={() => setUpload(null)}
        onDone={async id => { setUpload(null); await created(id); }} />
    </div>
  );

  return (
    <div className={'library' + (over ? ' over' : '')}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
      <div className="pk-side">
        {(['all', 'cv', 'cover', 'other', 'files', 'examples'] as const).filter(s => s === 'all' || lists[s].length || s === 'cv' || s === 'cover' || s === 'files').map(s => (
          <button key={s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>{titles[s]}{s !== 'all' && <span>{lists[s].length}</span>}</button>
        ))}
        <div className="pk-drop" onClick={() => docInput.current?.click()}>
          {busy ? <><span className="spin" /> Reading…</> : <>Drop files here<br /><u>or browse</u></>}
          <small>Word or PDF CVs and letters are read in; certificates and images go to Files</small>
        </div>
      </div>

      <div className="pk-grid">
        <div className="lib-h">
          <div><h2>My documents</h2><p className="muted">Your originals. An application always gets its own copy, so changes here never touch what you already sent.</p></div>
          <div className="lib-btns">
            <button className="btn sm" onClick={() => newDoc('cv')}>+ New CV</button>
            <button className="btn sm" onClick={() => newDoc('cover')}>+ New cover letter</button>
            <button className="btn sm" onClick={() => fileInput.current?.click()}>+ Add files</button>
            <button className="btn sm pri" onClick={() => docInput.current?.click()}>⬆ Upload CV or letter</button>
          </div>
          <input ref={docInput} type="file" multiple hidden accept=".docx,.pdf,.png,.jpg,.jpeg" onChange={e => { take(e.target.files); e.target.value = ''; }} />
          <input ref={fileInput} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg" onChange={e => { take(e.target.files, 'file'); e.target.value = ''; }} />
        </div>
        {shown.map(s => (
          <div key={s}>
            <div className="grp">{titles[s]}</div>
            {lists[s].length ? (
              <div className="pk-cards">
                {lists[s].map(i => (
                  <button key={i.key} className={'pk-card' + (focus === i.key ? ' on' : '')} onClick={() => setFocus(i.key)} onDoubleClick={() => open(i)}
                    onContextMenu={e => { e.preventDefault(); setFocus(i.key); setMenu({ x: e.clientX, y: e.clientY, items: actions(i) }); }}
                    title={i.src === 'template' ? 'Double-click to edit · right-click for more' : i.src === 'example' ? 'Double-click to add it to My documents' : 'Double-click to open'}>
                    <span className="th">{i.src === 'file' ? <FileThumb name={i.id} library /> : i.meta && i.body !== undefined ? <MiniDoc doc={{ meta: i.meta, body: i.body }} /> : null}</span>
                    <span className="tx"><b>{i.title}</b><small>{i.src === 'template' ? `${LANG(i.meta?.lang ?? '')}${usedText(i.key)}` : i.sub}</small></span>
                  </button>
                ))}
              </div>
            ) : <p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>{s === 'files' ? 'Certificates, references, transcripts. Drop them here.' : s === 'cv' ? 'No CV yet. Upload yours, or start from an example.' : s === 'cover' ? 'No cover letter yet.' : 'Nothing here.'}</p>}
          </div>
        ))}
      </div>

      <div className="pk-prev">
        {focused ? (
          <>
            <div className="pk-big" onDoubleClick={() => open(focused)}>{focused.src === 'file' ? <FileThumb name={focused.id} library big /> : focused.meta && focused.body !== undefined && <MiniDoc doc={{ meta: focused.meta, body: focused.body }} />}</div>
            <b>{focused.title}</b>
            <small className="muted">{focused.sub}{usedText(focused.key)}</small>
            {focused.src === 'example' && <small className="muted">{EXAMPLES.find(e => e.id === focused.id)?.note}</small>}
            <div className="lib-acts">
              {focused.src === 'template' && <><button className="btn pri" onClick={() => setEditing(focused.id)}>Edit</button><button className="btn" onClick={() => duplicate(focused)}>Duplicate</button></>}
              {focused.src === 'example' && <button className="btn pri" onClick={() => fromExample(focused)}>Add to My documents</button>}
              {focused.src === 'file' && <button className="btn" onClick={() => run(() => api.openExtra(focused.id))}>Open in a new tab</button>}
              {focused.src !== 'example' && <button className="btn" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); const d = remove(focused); setMenu({ x: r.left, y: r.bottom + 6, items: [d], ask: d }); }}>Delete…</button>}
            </div>
          </>
        ) : <p className="muted" style={{ fontSize: 13 }}>Click a document to see it here. Double-click to open it.</p>}
      </div>

      {editing && <DocWindow id={editing} onClose={async () => { setEditing(null); await refresh(); }} remove={i => { const it = items.find(x => x.key === 'template:' + i); if (it) { setEditing(null); setMenu({ x: innerWidth / 2 - 120, y: 120, items: [remove(it)], ask: remove(it) }); } }} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** one original, in its own window, edited with the same workspace as in an application */
function DocWindow({ id, onClose, remove }: { id: string; onClose: () => void; remove: (id: string) => void }) {
  const [doc, setDoc] = useState<{ meta: DocMeta; body: string } | null>(null);
  const run = useAction();
  useEffect(() => { run(() => api.template(id)).then(t => (t ? setDoc(t) : onClose())); }, [id]);
  return (
    <>
      <div className="flow-back" />
      <div className="flow" role="dialog" aria-label={doc?.meta.title ?? 'Document'}>
        <div className="flow-h">
          <span className="doc-ic" />
          <b className="flow-t">{doc?.meta.title ?? '…'}</b><span className="muted" style={{ fontSize: 12.5 }}>My documents · your original</span>
          <span className="sp" />
          <button className="flow-b" title="Close (everything is saved)" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="flow-body content">
          {doc && <DocWorkspace doc={doc} onSaved={setDoc}
            store={{ save: async (body, meta) => {
              try { const r = await api.saveTemplate(id, meta, body); return { meta: r.meta, body: r.body }; }
              catch (e) { if ((e as { statusCode?: number }).statusCode === 404) return { meta, body }; throw e; } // deleted meanwhile
            } }}
            head={(meta, setMeta) => <>
              <input className="input" style={{ width: 220 }} value={meta.title} onChange={e => setMeta({ title: e.target.value }, false)} aria-label="Title" />
              <select className="input" style={{ width: 'auto' }} value={meta.kind} onChange={e => setMeta({ kind: e.target.value as DocMeta['kind'] })} aria-label="Kind">
                <option value="cv">CV</option><option value="cover">Cover letter</option><option value="other">Other</option></select>
              <select className="input" style={{ width: 'auto' }} value={meta.lang} onChange={e => setMeta({ lang: e.target.value })} aria-label="Language">
                <option value="en">English</option><option value="de">Deutsch</option><option value="other">Other</option></select>
            </>}
            tools={<button className="btn sm" onClick={() => remove(id)}>Delete…</button>}
            margin={<div className="note" style={{ fontSize: 12.5 }}>This is your original. Applications get their own copy, so a change here shows up in applications you start from now on, not in ones you already sent.</div>} />}
        </div>
      </div>
    </>
  );
}
