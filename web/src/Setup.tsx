import { useMemo, useRef, useState } from 'react';
import { fillPlaceholders, parseBlocks } from '@shared/blocks';
import { renderDoc, THEMES } from '@shared/render';
import { STARTERS } from '@shared/starters';
import type { AppState, Profile } from '@shared/types';
import { api } from './api';
import { canPickFolder, isBrave, pickFolder, unlock, useBrowserStorage, type Conn } from './backend';
import { useAction } from './ui';
import { FirstProvider } from './Providers';
import { CV_ACCEPT, ImportReview, readCvFile, type CvUpload } from './ImportCv';
import { AppearancePicker } from './Views';

/** First screen when no folder is connected, or the browser wants permission again. */
export function Connect({ conn, setConn }: { conn: Conn; setConn: (c: Conn) => void }) {
  const run = useAction();
  const go = async (f: () => Promise<Conn | null>) => { const c = await run(f); if (c) setConn(c); };

  if (conn.status === 'locked') return (
    <div className="setup">
      <div className="setup-card">
        <div className="brand big">easy<span>·</span>apply</div>
        <h1>Welcome back</h1>
        <p className="muted">Your browser needs your OK to open <b>{conn.name}</b> again. To skip this next time, choose <i>Allow on every visit</i> when it asks.</p>
        <div className="setup-actions">
          <button className="btn pri" onClick={() => go(unlock)}>Open {conn.name}</button>
          <button className="btn" onClick={() => go(pickFolder)}>Choose another folder</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="brand big">easy<span>·</span>apply</div>
        <h1>One folder for every application</h1>
        <p className="muted">Each job gets its own folder with your tailored CV, cover letter and every earlier version. Everything stays on this computer; AI runs on your own model or your own key.</p>
        <h3>Where should your files live?</h3>
        <div className="choice">
          <button className="opt" disabled={!canPickFolder} onClick={() => go(pickFolder)}>
            <b>A folder on this computer</b>{canPickFolder && <span className="tag">Recommended</span>}
            <span>Plain files you can open, back up or sync with OneDrive or Dropbox. Pick an empty folder, e.g. Documents › Easy Apply, or one you used before.</span>
            {!canPickFolder && <span className="warn">{isBrave ? 'Brave keeps this switched off until you turn it on (steps below).' : 'Needs Chrome, Edge or Brave.'}</span>}
          </button>
          <button className="opt" onClick={() => go(useBrowserStorage)}>
            <b>Inside this browser</b>
            <span>Works in every browser, nothing to choose. Files are only reachable through the app, so export them now and then.</span>
          </button>
        </div>
        {!canPickFolder && isBrave && <div className="brave">
          <b>Turn on folder access in Brave</b>
          <ol>
            <li>Copy this address and paste it into Brave's address bar (websites can't open <code>brave://</code> pages themselves):
              <CopyField text="brave://flags/#file-system-access-api" /></li>
            <li>Set <b>File System Access API</b> to <b>Enabled</b>.</li>
            <li>Press <b>Relaunch</b>, then come back to this page.</li>
          </ol>
        </div>}
      </div>
    </div>
  );
}

const STEPS = ['Look', 'Your CV', 'About you', 'AI'];

/**
  Questions for a fresh folder: the look, your CV (it fills in your details), your details, an AI provider.
  The CV comes first because everything is built on it: each application starts from it, and AI suggestions
  only rephrase what is in it.
*/
export function Onboarding({ state, done }: { state: AppState; done: () => void }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>(state.profile);
  const [templates, setTemplates] = useState(state.templates);
  const [layouts, setLayouts] = useState(false);
  const [picked, setPicked] = useState<string[]>(['cv-en', 'cover-en']);
  const [theme, setTheme] = useState('classic');
  const [upload, setUpload] = useState<CvUpload | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const run = useAction();
  async function pick(f: File | undefined) {
    if (!f) return;
    const u = await run(() => readCvFile(f));
    if (u) setUpload(u);
  }

  const values = useMemo(() => Object.fromEntries(profile.fields.map(f => [f.key, f.value])), [profile]);
  const set = (key: string, value: string) => setProfile(p => ({ fields: p.fields.map(f => f.key === key ? { ...f, value } : f) }));
  const preview = useMemo(() => {
    const body = fillPlaceholders(STARTERS[0].body, values);
    return renderDoc(parseBlocks(body), theme, 'cv', 'en');
  }, [values, theme]);

  async function next() {
    if (step === 1 && layouts && picked.length && !(await run(async () => { await api.addStarters(picked, theme); return true; }))) return;
    if (step === 2 && !(await run(() => api.saveProfile(profile)))) return;
    if (step === 3) return done();
    setStep(step + 1);
  }

  const name = values.name?.trim();
  const canContinue = step === 1 ? added.length > 0 || (layouts && picked.length > 0) : step === 2 ? !!name : true;
  return (
    <div className="setup">
      <div className="setup-card wide">
        <div className="setup-steps">{STEPS.map((s, i) => <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {s}</span>)}</div>

        {step === 0 && <>
          <h1>How should Easy Apply look?</h1>
          <p className="muted">Pick a look and an accent colour for the app. Your CVs and letters keep their own designs. You can change this any time in Settings.</p>
          <div style={{ marginTop: 16 }}><AppearancePicker /></div>
        </>}

        {step === 1 && upload && <ImportReview upload={upload} profile={profile} templates={templates}
          onCancel={() => setUpload(null)}
          onDone={async () => {
            setAdded(a => [...a, upload.fileName]); setUpload(null);
            // the CV may have filled in your details, and may now be your main CV
            const st = await run(() => api.state()); if (st) { setProfile(st.profile); setTemplates(st.templates); }
          }} />}

        {step === 1 && !upload && <>
          <h1>Your CV</h1>
          <p className="muted">Easy Apply tailors your CV and cover letter to every job you apply for. Suggestions only rephrase what is in your CV, matched to each posting, so start with your real ones. Your CV also fills in your details for you.</p>
          <div className="cv-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
            <b>{added.length ? 'Add another file' : 'Upload your CV and cover letter'}</b>
            <span className="muted">Word (.docx) or PDF, one file each or both in one PDF. They are read in this browser; nothing is uploaded anywhere.{added.length ? ' A second language version works too.' : ''}</span>
            <button className="btn pri" onClick={() => file.current?.click()}>⬆ Choose a file…</button>
            <input ref={file} type="file" accept={CV_ACCEPT} hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            {added.length > 0 && <small className="ok-t">✓ Added to My documents: {added.join(', ')}</small>}
          </div>
          {!layouts
            ? <button className="link" style={{ marginTop: 12, fontSize: 13 }} onClick={() => setLayouts(true)}>No CV file yet? Start from a layout instead…</button>
            : <div className="setup-split" style={{ marginTop: 16 }}>
                <div>
                  <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>Example layouts with placeholders. Replace the example text once under My documents; every application starts from it.</p>
                  {STARTERS.map(s => (
                    <label key={s.id} className="check">
                      <input type="checkbox" checked={picked.includes(s.id)} onChange={e => setPicked(p => e.target.checked ? [...p, s.id] : p.filter(x => x !== s.id))} />
                      <span><b>{s.meta.title}</b><small>{s.note}</small></span>
                    </label>
                  ))}
                  <label className="f" style={{ marginTop: 14 }}>Design
                    <select className="input" value={theme} onChange={e => setTheme(e.target.value)}>
                      {Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>{t.name} — {t.note}</option>)}
                    </select></label>
                </div>
                <div className="setup-preview"><div className="thumbwrap" dangerouslySetInnerHTML={{ __html: preview }} /></div>
              </div>}
        </>}

        {step === 2 && <>
          <h1>About you</h1>
          <p className="muted">{added.length ? 'Filled in from your CV where possible. ' : ''}These fill the <code>{'{{placeholders}}'}</code> in your CV and letters. Each application gets its own copy, so you can still change anything per job. You can edit or add fields later under Profile.</p>
          <div className="setup-form">
            {profile.fields.map(f => (
              <label key={f.key} className="f">{f.label}
                <input className="input" value={f.value} onChange={e => set(f.key, e.target.value)} placeholder={PH[f.key] ?? ''} autoFocus={f.key === 'name'} /></label>
            ))}
          </div>
        </>}

        {step === 3 && <>
          <h1>AI (optional)</h1>
          <p className="muted">AI fills in job details from a posting and suggests tailored wording, which you accept or reject line by line. Use a model on this computer (Ollama, LM Studio) or your own key for OpenRouter, OpenAI or Gemini. Keys stay in this browser.</p>
          <FirstProvider onSaved={() => done()} />
          <p className="muted" style={{ fontSize: 12 }}>You can add more providers later in Settings. They form a fallback chain: if one is slow or at its free limit, the next one answers.</p>
        </>}

        <div className="setup-actions">
          {step > 0 && !upload && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          <span className="sp" />
          {step === 3 && <button className="btn" onClick={done}>Skip for now</button>}
          {step < 3 && !upload && <button className="btn pri" disabled={!canContinue} onClick={next}>Continue</button>}
        </div>
      </div>
    </div>
  );
}

const PH: Record<string, string> = { name: 'Alex Example', tagline: 'Data Analyst', email: 'alex@example.com', phone: '+49 …', website: 'github.com/alex', location: 'Berlin' };

/** a value with a Copy button, for things the user has to paste elsewhere */
function CopyField({ text }: { text: string }) {
  const [state, setState] = useState<'' | 'copied' | 'selected'>('');
  const code = useRef<HTMLElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState('copied'); }
    catch {
      // no clipboard access: select the text so Ctrl+C (Cmd+C) copies it
      const r = document.createRange(); r.selectNodeContents(code.current!);
      getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
      setState('selected');
    }
    setTimeout(() => setState(''), 2500);
  };
  return (
    <span className="copyfield">
      <code ref={code}>{text}</code>
      <button className="btn sm" onClick={copy}>{state === 'copied' ? '✓ Copied' : state === 'selected' ? 'Selected – press Ctrl+C' : 'Copy'}</button>
    </span>
  );
}
