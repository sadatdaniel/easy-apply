import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '@shared/types';
import { api } from './api';
import { connect, pickFolder, type Conn } from './backend';
import { Connect, Onboarding } from './Setup';
import { UpdateBanner } from './Update';
import { useAiStatus } from './aiStatus';
import { Applications, STEPS } from './Applications';
import { useAction } from './ui';
import { Extras, MyCv, ProfileView, Settings, Tracker } from './Views';

type View = 'apps' | 'templates' | 'extras' | 'profile' | 'tracker' | 'settings';
const VIEWS: [View, string][] = [['apps', 'Applications'], ['templates', 'My documents'], ['extras', 'Extras'], ['profile', 'Profile'], ['tracker', 'Tracker'], ['settings', 'Settings']];

// view, job and step live in the URL hash so reloads and back/forward keep your place
function readHash() {
  const [v, job, step] = location.hash.slice(1).split('/');
  return { view: (VIEWS.some(([k]) => k === v) ? v : 'apps') as View, job: job ? decodeURIComponent(job) : null, step: Math.min(Number(step) || 0, 2) };
}

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
  const [nav, setNav] = useState(readHash);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const run = useAction();

  const refresh = useCallback(async () => { const s = await run(() => api.state()); if (s) setState(s); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // a folder without templates is new: ask the onboarding questions first
  useEffect(() => { if (state && onboarding === null) setOnboarding(state.templates.length === 0); }, [state]);
  // a new view or application is a browser history entry (Back/Forward work); a step change only updates it
  const lastNav = useRef(nav);
  useEffect(() => {
    const h = `#${nav.view}${nav.job ? '/' + encodeURIComponent(nav.job) + '/' + nav.step : ''}`;
    const prev = lastNav.current;
    lastNav.current = nav;
    if (location.hash === h) return;
    if (prev.view !== nav.view || prev.job !== nav.job) history.pushState(null, '', h);
    else history.replaceState(null, '', h);
  }, [nav]);
  useEffect(() => {
    const follow = () => setNav(readHash());
    addEventListener('hashchange', follow);
    addEventListener('popstate', follow);
    return () => { removeEventListener('hashchange', follow); removeEventListener('popstate', follow); };
  }, []);

  if (!state || onboarding === null) return <div className="empty">Loading…</div>;
  if (onboarding) return <Onboarding state={state} done={async () => { await refresh(); setOnboarding(false); }} />;
  const job = state.jobs.find(j => j.id === nav.job);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">easy<span>·</span>apply</div>
        <div className="seg">{VIEWS.map(([k, l]) => <button key={k} className={nav.view === k ? 'on' : ''} onClick={() => setNav(n => ({ ...n, view: k }))}>{l}</button>)}</div>
        <div className="crumbs">{nav.view === 'apps' && (nav.job === 'new' ? <><b>New application</b></> : job && <>Applications › <b>{job.company || job.title}</b> › {STEPS[nav.step]}</>)}</div>
        <AiChip ai={state.ai} open={() => setNav(n => ({ ...n, view: 'settings' }))} />
      </div>
      {nav.view === 'apps' && <Applications state={state} refresh={refresh} jobId={nav.job} setJobId={job => setNav(n => ({ ...n, job }))} step={nav.step} setStep={step => setNav(n => ({ ...n, step }))} />}
      {nav.view === 'tracker' && <Tracker state={state} refresh={refresh} open={id => setNav({ view: 'apps', job: id, step: 0 })} />}
      {nav.view === 'templates' && <MyCv state={state} refresh={refresh} />}
      {nav.view === 'extras' && <Extras state={state} refresh={refresh} />}
      {nav.view === 'profile' && <ProfileView state={state} refresh={refresh} />}
      {nav.view === 'settings' && <Settings state={state} refresh={refresh} changeFolder={changeFolder} />}
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
