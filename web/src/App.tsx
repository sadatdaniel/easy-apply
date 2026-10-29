import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '@shared/types';
import { api } from './api';
import { connect, pickFolder, type Conn } from './backend';
import { Connect, Onboarding } from './Setup';
import { UpdateBanner } from './Update';
import { useAiStatus } from './aiStatus';
import { Applications } from './Applications';
import { FlowWindow, resumeOf, STEPS } from './Flow';
import { useAction } from './ui';
import { Extras, MyCv, Settings, Tracker } from './Views';

type View = 'apps' | 'templates' | 'extras' | 'tracker' | 'settings';
const VIEWS: [View, string][] = [['apps', 'Applications'], ['templates', 'My documents'], ['extras', 'Extras'], ['tracker', 'Tracker'], ['settings', 'Settings']];

/*
  The view, the picked application and its window live in the URL hash, so reloads and Back/Forward keep your
  place: #apps/<job> picks it; #apps/<job>/<step> has its window open, "<step>m" minimised.
*/
interface Nav { view: View; job: string | null; step: number | null; min: boolean }
function readHash(): Nav {
  const [v, job, step] = location.hash.slice(1).split('/');
  const m = /^(\d)(m?)$/.exec(step ?? '');
  const view = (VIEWS.some(([k]) => k === v) ? v : 'apps') as View;
  // an open window covers everything, so anywhere but Applications it can only be minimised
  return { view, job: job ? decodeURIComponent(job) : null, step: m ? Math.min(Number(m[1]), STEPS.length - 1) : null, min: !!m && (!!m[2] || view !== 'apps') };
}
const hashOf = (n: Nav) => `#${n.view}${n.job ? '/' + encodeURIComponent(n.job) + (n.step !== null ? `/${n.step}${n.min ? 'm' : ''}` : '') : ''}`;

export function App() {
  const [conn, setConn] = useState<Conn | null>(null);
  const run = useAction();
  useEffect(() => { connect().then(setConn, () => setConn({ status: 'none' })); }, []);
  if (!conn) return <div className="empty">Loading…</div>;
  if (conn.status !== 'ready') return <><Connect conn={conn} setConn={setConn} /><UpdateBanner /></>;
  // a new key remounts everything when another folder is connected
  return <><Main key={conn.label + conn.kind} changeFolder={async () => { const c = await run(pickFolder); if (c) setConn(c); }} /><UpdateBanner /></>;
}

function Main({ changeFolder }: { changeFolder: () => void }) {
  const [state, setState] = useState<AppState | null>(null);
  const [nav, setNav] = useState<Nav>(readHash);
  const [firstDoc, setFirstDoc] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const run = useAction();

  const refresh = useCallback(async () => { const s = await run(() => api.state()); if (s) setState(s); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // a folder without templates is new: ask the onboarding questions first
  useEffect(() => { if (state && onboarding === null) setOnboarding(state.templates.length === 0); }, [state]);
  // a new view or application is a browser history entry (Back/Forward work); a step change only updates it
  const lastNav = useRef(nav);
  useEffect(() => {
    const h = hashOf(nav);
    const prev = lastNav.current;
    lastNav.current = nav;
    if (location.hash === h) return;
    if (prev.view !== nav.view || prev.job !== nav.job || (prev.step === null) !== (nav.step === null)) history.pushState(null, '', h);
    else history.replaceState(null, '', h);
  }, [nav]);
  useEffect(() => {
    const follow = () => setNav(readHash());
    addEventListener('hashchange', follow);
    addEventListener('popstate', follow);
    return () => { removeEventListener('hashchange', follow); removeEventListener('popstate', follow); };
  }, []);

  /** opens an application's window (at a step, with a file picked); a window already open is replaced: it saved as it went */
  const open = (job: string, step?: number, doc?: string) => {
    const j = state?.jobs.find(x => x.id === job);
    const was = step === undefined && j ? resumeOf(job) : null;
    setFirstDoc(doc ?? was?.doc ?? null);
    setNav(n => ({ ...n, view: 'apps', job, step: step ?? was?.step ?? (j ? 1 : 0), min: false }));
  };
  const flowJob = nav.job && nav.step !== null ? nav.job : null;

  if (!state || onboarding === null) return <div className="empty">Loading…</div>;
  if (onboarding) return <Onboarding state={state} done={async () => { await refresh(); setOnboarding(false); }} />;
  const job = state.jobs.find(j => j.id === nav.job);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">easy<span>·</span>apply</div>
        <div className="seg">{VIEWS.map(([k, l]) => <button key={k} className={nav.view === k ? 'on' : ''} onClick={() => setNav(n => ({ ...n, view: k, min: n.step !== null }))}>{l}</button>)}</div>
        <div className="crumbs">{nav.view === 'apps' && job && <>Applications › <b>{job.company || job.title}</b></>}</div>
        <AiChip ai={state.ai} open={() => setNav(n => ({ ...n, view: 'settings' }))} />
      </div>
      {nav.view === 'apps' && <Applications state={state} refresh={refresh} jobId={nav.job === 'new' ? null : nav.job}
        select={job => setNav(n => ({ ...n, job, step: null, min: false }))} open={open} />}
      {nav.view === 'tracker' && <Tracker state={state} refresh={refresh} open={id => open(id, 0)} />}
      {nav.view === 'templates' && <MyCv state={state} refresh={refresh} />}
      {nav.view === 'extras' && <Extras state={state} refresh={refresh} />}
      {nav.view === 'settings' && <Settings state={state} refresh={refresh} changeFolder={changeFolder} />}
      {flowJob && <FlowWindow key={flowJob === 'new' ? 'new' : 'job'} state={state} refresh={refresh} jobId={flowJob} step={nav.step!} min={nav.min} firstDoc={firstDoc}
        setFlow={f => setNav(n => ({ ...n, job: f.job ?? n.job, step: f.step ?? n.step, min: f.min ?? n.min, view: f.min === false ? 'apps' : n.view }))}
        close={() => setNav(n => ({ ...n, job: n.job === 'new' ? null : n.job, step: null, min: false }))} />}
    </div>
  );
}

/** Title-bar chip: the first provider in the chain, or what the chain is doing right now. */
function AiChip({ ai, open }: { ai: AppState['ai']; open: () => void }) {
  const busy = useAiStatus();
  const more = ai.count > 1 ? ` +${ai.count - 1}` : '';
  return (
    <span className={'ai-chip' + (busy ? ' busy' : ai.configured ? ' on' : '')} onClick={open} role="status"
      title={ai.count > 1 ? `${ai.count} providers in the fallback chain` : 'AI provider'}>
      {busy ? <><span className="spin" /> {busy}</> : ai.configured ? `✨ ${ai.label}${more}` : 'AI not set up'}
    </span>
  );
}
