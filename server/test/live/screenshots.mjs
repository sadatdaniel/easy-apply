// README screenshots of a made-up job seeker, Alex Example (not part of `npm test`).
// Needs `npm run dev` (app + helper) and, for the tailoring shot, Ollama with a model:
//   node test/live/screenshots.mjs [model]
// Writes docs/screenshots/*.png from a fresh, throwaway browser profile.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const FIX = path.join(ROOT, 'server', 'test', 'fixtures');
const MODEL = process.argv[2] ?? 'e2b-text-128k:latest';
const APP = 'http://127.0.0.1:5173/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slash = p => p.split(path.sep).join('/');
fs.mkdirSync(OUT, { recursive: true });

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-apply-shots-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9335', `--user-data-dir=${PROFILE}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let list;
for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:9335/json')).json(); if (list.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async js => { const r = await cdp('Runtime.evaluate', { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result?.result?.value; };
const shot = async name => { await sleep(600); const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64')); console.log('saved', name); };
const go = async hash => { await cdp('Page.navigate', { url: APP + hash }); await sleep(200); await cdp('Page.reload', {}); await sleep(2200); };
const upload = async (selector, file) => {
  const { result: { root } } = await cdp('DOM.getDocument', {});
  const { result: { nodeId } } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
  await cdp('DOM.setFileInputFiles', { nodeId, files: [slash(file)] });
};
const H = `const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const setVal=(el,v)=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));};
const btn=t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(t));`;

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: APP }); await sleep(2500);

// ---------- onboarding: Alex uploads a PDF with a cover letter and a CV ----------
await run(H + `btn('Inside this browser').click(); await sleep(900); btn('Continue').click(); await sleep(700); return 1;`);
await upload('input[type=file]', path.join(FIX, 'alex-letter-and-cv.pdf'));
for (let i = 0; i < 30 && !(await run(`return !!document.querySelector('.import')`)); i++) await sleep(500);
// name them as a person would, not after the file
const title = t => `setVal(document.querySelector('.import-side input'), ${JSON.stringify(t)}); await sleep(200);`;
await run(H + title('Cover letter · English') + `btn('Add to My documents').click(); await sleep(1500);` + title('CV · English') + `btn('Add to My documents').click(); await sleep(2000);
  btn('Continue').click(); await sleep(900); btn('Continue').click(); await sleep(900); return 1;`);
// AI: the local model
await run(H + `const m=[...document.querySelectorAll('label.f')].find(l=>l.textContent.startsWith('Model')).querySelector('input'); setVal(m, ${JSON.stringify(MODEL)}); await sleep(200);
  btn('Add to chain').click(); await sleep(1500); return 1;`);

// ---------- applications: set up through the app's own API (same module the page uses) ----------
await run(`
  const { api } = await import('/src/api.ts');
  const jobs = [
    ['Data Engineer', 'Lumen Labs', 'Berlin (hybrid)', 'interview', 'Thu 12 Nov, 10:00', ['Python', 'SQL', 'Airflow', 'dbt', 'English C1']],
    ['Analytics Engineer', 'Nordwind Logistics', 'Hamburg', 'applied', '', ['SQL', 'dbt', 'Looker']],
    ['Data Analyst', 'Elbe Health', 'Hamburg (remote)', 'saved', '', ['SQL', 'Power BI']],
    ['Python Developer', 'Kranhaus Software', 'Kiel', 'rejected', 'After first interview', ['Python', 'Django']],
    ['BI Developer', 'Hafenblick Analytics', 'Hamburg', 'offer', '20 Nov', ['Power BI', 'SQL']],
  ];
  const posting = (t, c, l) => t + ' at ' + c + ', ' + l + '. You will build reliable data pipelines with Python and SQL, model data in our warehouse and work closely with analysts. Requirements: Python, SQL, Airflow or dbt, very good English.';
  const st = await api.state();
  const cv = st.templates.find(t => t.kind === 'cv'), letter = st.templates.find(t => t.kind === 'cover');
  for (const [title, company, location, status, note, keywords] of jobs.reverse()) {
    const j = await api.createJob({ title, company, location, language: 'English', keywords, salary: company === 'Lumen Labs' ? '65,000–75,000 EUR' : '', deadline: '2026-11-30' }, posting(title, company, location), '', true);
    await api.addDoc(j.id, cv.id); await api.addDoc(j.id, letter.id);
    if (status !== 'saved') await api.setStatus(j.id, status, note);
  }
  return 1;`);
// a backup was made, so the reminder for browser storage stays away
await run(`const { api } = await import('/src/api.ts'); await api.backup(); return 1;`);
const lumen = await run(`const { api } = await import('/src/api.ts'); return (await api.state()).jobs.find(j => j.company === 'Lumen Labs').id;`);

// 1. an application with its folder
await go(`#apps/${encodeURIComponent(lumen)}/0`);
await shot('applications.png');

// 2. My documents
await go('#templates');
await run(`[...document.querySelectorAll('.side-list .row')].find(r=>r.innerText.includes('CV'))?.click(); await new Promise(r=>setTimeout(r,1200)); return 1;`);
await shot('my-documents.png');

// 3. tracker
await go('#tracker');
await shot('tracker.png');

// 4. the final step with the PDF preview (the helper prints the PDF)
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1180, deviceScaleFactor: 1, mobile: false });
await go(`#apps/${encodeURIComponent(lumen)}/4`);
for (let i = 0; i < 40 && !(await run(`return !!document.querySelector('.bundle iframe') && !document.querySelector('.bundle-h .spin')`)); i++) await sleep(1000);
await shot('final-pdf.png');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// 5. a tailoring suggestion from the local model
await go(`#apps/${encodeURIComponent(lumen)}/2`);
await run(`[...document.querySelectorAll('.dtab')].find(t=>t.textContent.includes('cv'))?.click(); await new Promise(r=>setTimeout(r,1000));
  [...document.querySelectorAll('.edbar button')].find(b=>b.textContent.includes('Tailor')).click(); await new Promise(r=>setTimeout(r,300));
  const li=[...document.querySelectorAll('.paper li[data-b]')].find(e=>e.textContent.startsWith('Moved weekly')); li.scrollIntoView({block:'center'}); li.click(); return 1;`);
for (let i = 0; i < 120 && !(await run(`return !!document.querySelector('.rv') && !document.querySelector('.rv .spin')`)); i++) await sleep(1000);
await run(`const c=document.querySelector('.rv'); c.scrollIntoView({block:'center'}); return 1;`);
await shot('tailor.png');

ws.close(); edge.kill();
await sleep(500);
fs.rmSync(PROFILE, { recursive: true, force: true });
console.log('done');
