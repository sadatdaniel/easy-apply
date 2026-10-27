import { useEffect, useState } from 'react';
import { parseBlocks } from '@shared/blocks';
import { renderDoc } from '@shared/render';
import { api, type Doc } from './api';
import { connect, unlock, type Conn } from './backend';

/** /print?job=…&docs=a.md,b.md&title=… : the documents as A4 pages, then the print dialog. */
export function PrintView() {
  const q = new URLSearchParams(location.search);
  const job = q.get('job') ?? '';
  const names = (q.get('docs') ?? '').split(',').filter(Boolean);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState('');
  const [conn, setConn] = useState<Conn | null>(null);

  useEffect(() => { document.title = q.get('title') || names.join(' + '); connect().then(setConn, e => setError(e.message)); }, []);
  useEffect(() => {
    if (conn?.status === 'ready') Promise.all(names.map(n => api.doc(job, n))).then(setDocs, e => setError(e.message));
  }, [conn]);
  useEffect(() => {
    if (!docs?.length) return;
    document.fonts.ready.then(() => setTimeout(() => print(), 300));
  }, [docs]);

  if (error) return <p className="error" style={{ margin: 20 }}>{error}</p>;
  if (conn && conn.status !== 'ready') return (
    <div className="setup"><div className="setup-card"><p>{conn.status === 'locked' ? <>The browser needs your OK to open <b>{conn.name}</b> in this window.</> : 'No folder is connected.'}</p>
      {conn.status === 'locked' && <button className="btn pri" onClick={() => unlock().then(setConn)}>Open {conn.name}</button>}</div></div>
  );
  return (
    <div className="print-root">
      <div className="noprint" style={{ padding: 12, display: 'flex', gap: 8, justifyContent: 'center', background: 'var(--side)' }}>
        <button className="btn pri" onClick={() => print()}>Print / Save as PDF</button>
        <span className="muted" style={{ alignSelf: 'center' }}>In the print dialog choose "Save as PDF", A4, margins default, and turn off headers and footers.</span>
      </div>
      {docs?.map((d, i) => (
        <div key={d.name} style={{ breakBefore: i ? 'page' : undefined, display: 'flex', justifyContent: 'center' }}
          dangerouslySetInnerHTML={{ __html: renderDoc(parseBlocks(d.body), d.meta.theme, d.meta.kind, d.meta.lang, d.meta.style) }} />
      ))}
    </div>
  );
}
