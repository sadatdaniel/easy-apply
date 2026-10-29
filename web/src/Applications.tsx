import { useEffect, useMemo, useState } from 'react';
import type { AppState, Job } from '@shared/types';
import { api, lastBackup, type JobDetail } from './api';
import { download } from './exporter';
import { resumeOf } from './Flow';

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
import { ContextMenu, Dot, STATUS, StatusMenu, useAction, type MenuItem } from './ui';

interface Props { state: AppState; refresh: () => Promise<void>; jobId: string | null; select: (id: string | null) => void; open: (id: string, step?: number, doc?: string) => void }

export function Applications({ state, refresh, jobId, select, open }: Props) {
  const run = useAction();
  const job = state.jobs.find(j => j.id === jobId) ?? null;
  return (
    <div className="browser">
      <JobsColumn jobs={state.jobs} jobId={jobId} browserStorage={state.root === 'this browser'}
        onPick={id => (id === 'new' ? open('new', 0) : select(id))} onOpen={id => open(id)}
        onDelete={async j => {
          const to = await run(() => api.trashJob(j.id));
          if (!to) return;
          if (j.id === jobId) select(null);
          await refresh();
          run(async () => {}, `Moved "${j.company || j.title || j.id}" to ${state.root} › ${to.split('/').slice(0, -1).join(' › ')}`);
        }} />
      {job ? <Overview key={job.id} job={job} open={open} refresh={refresh} /> : (
        <div className="stack" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div className="empty">
            <p className="serif" style={{ fontSize: 22, color: 'var(--ink)' }}>Pick an application, or start a new one.</p>
            <button className="btn pri" onClick={() => open('new', 0)}>+ New application</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** the application's folder at a glance; everything you change happens in its window */
function Overview({ job, open, refresh }: { job: Job; open: Props['open']; refresh: () => Promise<void> }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const run = useAction();
  useEffect(() => { api.job(job.id).then(setDetail).catch(() => {}); }, [job.id, job.updatedAt]);
  const docTitle = (n: string) => detail?.docs.find(d => d.name === n)?.meta.title ?? n;
  const files = [...job.bucket, ...[...job.docs, ...job.extras].filter(n => !job.bucket.includes(n))].filter(n => job.docs.includes(n) || job.extras.includes(n));
  return (
    <div className="overview">
      <div className="ov-h">
        <span className="fold big" />
        <div style={{ minWidth: 0 }}>
          <h2>{job.company || 'Unknown company'}</h2>
          <p className="muted">{[job.title, job.location, job.salary].filter(Boolean).join(' · ') || 'No details yet'}</p>
        </div>
        <span className="sp" />
        <button className="pill" onClick={e => setMenu(e.currentTarget.getBoundingClientRect())}><Dot s={job.status} />{STATUS[job.status].label} ▾</button>
        <button className="btn pri" onClick={() => open(job.id)}>{resumeOf(job.id) ? 'Continue' : files.length ? 'Open application' : 'Choose documents'} →</button>
      </div>
      {job.next && <div className="note" style={{ margin: '0 0 16px' }}>Next: <b>{job.next}</b></div>}
      <div className="grp" style={{ paddingLeft: 0 }}>In this folder</div>
      <div className="ov-files">
        <button className="ov-file" onClick={() => open(job.id, 0)}><span className="ic md">MD</span><span><b>Posting &amp; details</b><small>posting.md · job.json</small></span></button>
        {files.map(n => (
          <button key={n} className="ov-file" onClick={() => open(job.id, 1, n)}>
            <span className={'ic' + (n.endsWith('.md') ? ' md' : ' pdf')}>{n.split('.').pop()?.toUpperCase().slice(0, 4)}</span>
            <span><b>{n.endsWith('.md') ? docTitle(n) : n}</b><small>{n}{job.bucket.includes(n) ? '' : ' · not sent'}</small></span>
          </button>
        ))}
        {!files.length && <p className="muted" style={{ fontSize: 13 }}>No documents yet.</p>}
      </div>
      {detail?.posting && <>
        <div className="grp" style={{ paddingLeft: 0, marginTop: 18 }}>Posting</div>
        <div className="ov-posting">{detail.posting.slice(0, 1200)}{detail.posting.length > 1200 ? '…' : ''}</div>
      </>}
      <p className="muted" style={{ fontSize: 12, marginTop: 18 }}>Files are in {api.folderOf(job.id)}</p>
      {menu && <StatusMenu anchor={menu} current={job.status} onClose={() => setMenu(null)}
        onPick={async (s, note) => { setMenu(null); if (await run(() => api.setStatus(job.id, s, note), `Marked as ${STATUS[s].label}`)) await refresh(); }} />}
    </div>
  );
}

/* ---------------- column 1 ---------------- */
function JobsColumn({ jobs, jobId, onPick, onOpen, onDelete, browserStorage }: {
  jobs: Job[]; jobId: string | null; onPick: (id: string) => void; onOpen: (id: string) => void; onDelete: (job: Job) => void; browserStorage: boolean;
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
    { label: 'Open', onClick: () => onOpen(j.id) },
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
        {groups.map(([month, list]) => (
          <div key={month}>
            <div className="grp">{month}</div>
            {list.map(j => (
              <button key={j.id} className={'row' + (j.id === jobId ? ' on' : '')} onClick={() => onPick(j.id)} onDoubleClick={() => onOpen(j.id)} onContextMenu={e => open(e, jobMenu(j))}
                title="Double-click to open · right-click for more">
                <span className="fold" /><span className="tx"><div>{j.company || 'Unknown company'}</div><small>{j.title || 'Untitled role'}</small></span><Dot s={j.status} />
              </button>
            ))}
          </div>
        ))}
        {!jobs.length && <p className="muted" style={{ padding: 10, fontSize: 12.5 }}>No applications yet.</p>}
      </div>
      {remind && <BackupNudge />}
      <button className="btn pri newjob" onClick={() => onPick('new')}>+ New application</button>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

