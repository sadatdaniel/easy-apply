import { useMemo, useState } from 'react';
import { parseBlocks } from '@shared/blocks';
import { importDocxHtml, toPlaceholders, type Imported } from '@shared/docx';
import { findLetterDetails, generalizeLetter, LETTER_FIELDS, type LetterDetails } from '@shared/letter';
import { pdfItems, pdfToHtml } from '@shared/pdftext';
import { renderDoc, THEMES } from '@shared/render';
import type { DocKind, DocMeta, Profile, TemplateInfo } from '@shared/types';
import { api } from './api';
import { useAction } from './ui';

/** One uploaded file; a PDF may hold several documents (a cover letter followed by a CV). */
export interface CvUpload { fileName: string; parts: { label: string; imported: Imported }[] }

export const CV_ACCEPT = '.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const parseHtml = (h: string) => new DOMParser().parseFromString(h, 'text/html');

/** Reads a Word or PDF CV in the browser; nothing is uploaded anywhere. The readers load only now. */
export async function readCvFile(file: File): Promise<CvUpload> {
  if (/\.docx$/i.test(file.name)) {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      // Word's "Title" style is usually the name; pictures (photos, icons) are left out
      { styleMap: ["p[style-name='Title'] => h1:fresh"], convertImage: mammoth.images.imgElement(async () => ({ src: '' })) },
    );
    return { fileName: file.name, parts: [{ label: 'Document', imported: importDocxHtml(value, parseHtml) }] };
  }
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    let doc;
    try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) {
      throw new Error((e as Error).name === 'PasswordException' ? 'This PDF is password-protected. Remove the password, or upload the Word file.' : 'This PDF could not be read. Upload the Word file instead.');
    }
    const parts = pdfToHtml(await pdfItems(doc as never)).filter(p => p.html.trim());
    if (!parts.length) throw new Error('This PDF has no text in it (it is a scan or an image). Upload the Word file instead.');
    return {
      fileName: file.name,
      parts: parts.map(p => {
        const imported = importDocxHtml(p.html, parseHtml);
        const what = imported.kind === 'cover' ? 'Cover letter' : imported.kind === 'cv' ? 'CV' : 'Document';
        return { label: `${what} · page${p.pages.length > 1 ? `s ${p.pages[0]}–${p.pages[p.pages.length - 1]}` : ` ${p.pages[0]}`}`, imported };
      }),
    };
  }
  if (/\.doc$/i.test(file.name)) throw new Error('This is an old Word file (.doc). Open it in Word and save it as .docx, or export it as PDF.');
  throw new Error('Choose a Word (.docx) or PDF file.');
}

const FOUND_KEYS = ['name', 'email', 'phone', 'website', 'location'] as const;

/**
  Review what was read from an uploaded file before adding it to My documents. A PDF with several documents
  is reviewed part by part. A CV becomes the main CV of its language if that language has none yet.
*/
export function ImportReview({ upload, profile, templates, onDone, onCancel }: {
  upload: CvUpload; profile: Profile; templates: TemplateInfo[];
  onDone: (lastId: string) => void; onCancel: () => void;
}) {
  const [at, setAt] = useState(0);
  const [done, setDone] = useState<Record<number, string>>({});
  const [prof, setProf] = useState(profile);
  const [mains, setMains] = useState(() => new Set(templates.filter(t => t.main).map(t => `${t.kind}:${t.lang}`)));
  const multi = upload.parts.length > 1;
  const finish = (ids: Record<number, string>) => { const last = Object.values(ids).pop(); last ? onDone(last) : onCancel(); };

  return (
    <div className="import-wrap">
      {multi && <div className="import-parts">
        <span className="muted">This file holds {upload.parts.length} documents:</span>
        {upload.parts.map((p, i) => <button key={i} className={'btn sm' + (i === at ? ' pri' : '')} onClick={() => setAt(i)}>{done[i] ? '✓ ' : ''}{p.label}</button>)}
        <span className="sp" />
        {Object.keys(done).length > 0 && <button className="btn sm" onClick={() => finish(done)}>Finish</button>}
      </div>}
      <PartReview key={at} fileName={upload.fileName} label={multi ? upload.parts[at].label : ''} imported={upload.parts[at].imported} profile={prof}
        added={done[at]} onCancel={onCancel}
        onCreated={async (id, meta, newProfile) => {
          setProf(newProfile);
          const key = `${meta.kind}:${meta.lang}`;
          if ((meta.kind === 'cv' || meta.kind === 'cover') && !mains.has(key)) { await api.setMain(id); setMains(m => new Set(m).add(key)); }
          const next = { ...done, [at]: id };
          setDone(next);
          const todo = upload.parts.findIndex((_, i) => !next[i]);
          if (todo < 0) finish(next); else setAt(todo);
        }} />
    </div>
  );
}

function PartReview({ fileName, label, imported, profile, added, onCreated, onCancel }: {
  fileName: string; label: string; imported: Imported; profile: Profile; added?: string;
  onCreated: (id: string, meta: DocMeta, profile: Profile) => void; onCancel: () => void;
}) {
  const base = fileName.replace(/\.(docx|pdf)$/i, '');
  const [title, setTitle] = useState(label ? `${base} – ${label.split(' · ')[0]}` : base);
  const [kind, setKind] = useState<DocKind>(imported.kind);
  const [lang, setLang] = useState(imported.lang);
  const [theme, setTheme] = useState('classic');
  const [usePh, setUsePh] = useState(true);
  // empty profile fields the CV can fill (new users start with an empty profile)
  const fillable = FOUND_KEYS.filter(k => imported.found[k] && !profile.fields.find(f => f.key === k)?.value.trim());
  const [fill, setFill] = useState(fillable.length > 0);
  // a letter written for one job: its company, role, date and place become placeholders for every next job
  const [reuse, setReuse] = useState(true);
  const [details, setDetails] = useState<LetterDetails>(() => findLetterDetails(imported.markdown));
  const run = useAction();

  const effective: Profile = useMemo(() => !fill ? profile : {
    fields: profile.fields.map(f => (fillable.includes(f.key as typeof FOUND_KEYS[number]) ? { ...f, value: imported.found[f.key as typeof FOUND_KEYS[number]] } : f)),
  }, [fill, profile]);
  const result = useMemo(() => (usePh ? toPlaceholders(imported.markdown, effective) : { markdown: imported.markdown, replaced: [] }), [usePh, effective]);
  const letter = useMemo(() => (kind === 'cover' && reuse ? generalizeLetter(result.markdown, details) : null), [kind, reuse, result.markdown, details]);
  const finalMd = letter?.markdown ?? result.markdown;
  const blocks = useMemo(() => parseBlocks(finalMd), [finalMd]);
  const html = useMemo(() => renderDoc(blocks, theme, kind, lang), [blocks, theme, kind, lang]);
  const count = (t: string) => blocks.filter(b => b.type === t).length;
  const profileName = effective.fields.find(f => f.key === 'name')?.value.trim();
  const nameKept = usePh && profileName && blocks[0]?.type === 'h1' && blocks[0].text !== '{{name}}';

  async function create() {
    if (fill && fillable.length && !(await run(() => api.saveProfile(effective)))) return;
    const meta: DocMeta = { title: title.trim() || 'My document', kind, lang, theme };
    const r = await run(() => api.importTemplate(meta, finalMd), `Added "${meta.title}" to My documents`);
    if (r) onCreated(r.id, meta, fill ? effective : profile);
  }

  return (
    <div className="import">
      <div className="import-side">
        <h2>{label || `Upload ${fileName}`}</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          {kind === 'cover' ? `Found ${count('p')} paragraphs.` : `Found ${count('h2')} sections, ${count('h3')} entries and ${count('li')} bullets.`} Check the preview; you can edit everything afterwards.
        </p>
        <label className="f">Title<input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <div className="row2">
          <label className="f">Kind<select className="input" value={kind} onChange={e => setKind(e.target.value as DocKind)}>
            <option value="cv">CV</option><option value="cover">Cover letter</option><option value="other">Other</option></select></label>
          <label className="f">Language<select className="input" value={lang} onChange={e => setLang(e.target.value)}>
            <option value="en">English</option><option value="de">Deutsch</option><option value="other">Other</option></select></label>
        </div>
        <label className="f">Design<select className="input" value={theme} onChange={e => setTheme(e.target.value)}>
          {Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}</select></label>
        {fillable.length > 0 && <label className="check"><input type="checkbox" checked={fill} onChange={e => setFill(e.target.checked)} />
          <span><b>Fill my empty profile fields from this {kind === 'cover' ? 'letter' : 'CV'}</b><small>{fillable.map(k => `${k}: ${imported.found[k]}`).join(' · ')}</small></span></label>}
        <label className="check"><input type="checkbox" checked={usePh} onChange={e => setUsePh(e.target.checked)} />
          <span><b>Use placeholders for my details</b><small>{usePh
            ? result.replaced.length ? `Replaced: ${result.replaced.map(k => `{{${k}}}`).join(' ')}. They fill in from your profile in every copy.` : 'None of your profile values appear in the header.'
            : 'Your details stay as written.'}</small></span></label>
        {kind === 'cover' && <div className="reuse">
          <label className="check" style={{ padding: 0, border: 0 }}><input type="checkbox" checked={reuse} onChange={e => setReuse(e.target.checked)} />
            <span><b>Reuse for other jobs</b><small>These were written for one job. They become placeholders that every new application fills in; check what was found.</small></span></label>
          {reuse && LETTER_FIELDS.map(f => (
            <label key={f.key} className="f reuse-row"><span>{f.label} → <code>{f.placeholder}</code>{letter && details[f.key] ? <em> · {letter.counts[f.key]}×</em> : null}</span>
              <input className="input" value={details[f.key]} placeholder="not found" onChange={e => setDetails(d => ({ ...d, [f.key]: e.target.value }))} /></label>
          ))}
        </div>}
        {nameKept && <div className="note" style={{ fontSize: 12 }}>The name here differs from your profile ("{profileName}"), so it stays as written.</div>}
        <div className="setup-actions" style={{ marginTop: 6 }}>
          <button className="btn" onClick={onCancel}>Cancel</button><span className="sp" />
          {added ? <span className="badge ok">✓ Added to My documents</span> : <button className="btn pri" onClick={create}>Add to My documents</button>}
        </div>
      </div>
      <div className="import-preview"><div className="paper" style={{ width: 794 }} dangerouslySetInnerHTML={{ __html: html }} /></div>
    </div>
  );
}
