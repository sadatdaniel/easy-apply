// Offline / update check of the production build in headless Edge (not part of `npm test`):
//   node test/live/pwa.mjs <scratch folder>
// 1. first visit installs the offline cache, under the Content Security Policy, with no errors
// 2. server gone (offline): the app still starts, keeps data, and loads on-demand code (Word import)
// 3. a new version: the banner appears and Reload switches to it
// 4. an update that breaks halfway (a file missing, as when the connection drops): old version keeps working
// 5. the next complete update still arrives
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? (await import('node:os')).tmpdir();
const ROOT = path.resolve(import.meta.dirname, '../../..');
const WEB = path.join(ROOT, 'web');
const URL0 = 'http://127.0.0.1:4174/';  // served by the helper (npm start), like a real host: missing files are 404
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push([ok ? 'PASS' : 'FAIL', name, detail]); console.log(ok ? 'PASS' : 'FAIL', name, detail); };

const build = () => execSync('npm run build -w web', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PATH: process.env.PATH } });
let server = null;
async function serve() {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(ROOT, 'server'), stdio: 'ignore', env: { ...process.env, EASYCV_PORT: '4174' } });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(URL0)).ok) return; } catch {} await sleep(250); }
  throw new Error('preview server did not start');
}
async function stop() { if (server) { server.kill(); server = null; await sleep(800); } }

// ---------- browser ----------
const PROFILE = path.join(OUT, 'pwa-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--remote-debugging-port=9334', `--user-data-dir=${PROFILE}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let list;
for (let i = 0; i < 40; i++) { try { list = await (await fetch('http://127.0.0.1:9334/json')).json(); if (list.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
});
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async js => { const r = await cdp('Runtime.evaluate', { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
const shot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64')); };
const H = `const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const setVal=(el,v)=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));};
const btn=t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(t));`;
const waitFor = async (js, ms = 20000) => { for (let t = 0; t < ms; t += 400) { if (await run(js).catch(() => false)) return true; await sleep(400); } return false; };
const buildOnPage = () => run(`location.hash='#settings'; await new Promise(r=>setTimeout(r,800)); return document.querySelector('[data-build]')?.dataset.build ?? ''`);

await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

try {
  // ---------- 1. first visit ----------
  build(); await serve();
  await cdp('Page.navigate', { url: URL0 });
  check('first visit: offline cache installed', await waitFor(`const r = await navigator.serviceWorker.getRegistration(); return !!r?.active;`));
  check('first visit: "works offline" notice', await waitFor(`return document.body.innerText.includes('now works offline')`, 10000));
  await run(H + `btn('OK')?.click(); btn('Inside this browser').click(); await sleep(900); btn('Continue').click(); await sleep(700);
    [...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('No CV file yet')).click(); await sleep(300);
    btn('Continue').click(); await sleep(900);
    setVal(document.querySelector('.setup-form input'),'Robin Test'); await sleep(100);
    btn('Continue').click(); await sleep(1200); btn('Skip for now').click(); await sleep(1200);
    btn('+ New application').click(); await sleep(700);
    setVal(document.querySelector('textarea'),'Data Engineer at Hafenblick');
    setVal([...document.querySelectorAll('input')].filter(i=>!i.placeholder)[0],'Data Engineer'); await sleep(50);
    setVal([...document.querySelectorAll('input')].filter(i=>!i.placeholder)[1],'Hafenblick'); await sleep(200);
    btn('Save').click(); await sleep(1500); return 1;`);
  const v1 = await buildOnPage();
  check('first visit: no errors and no Content-Security-Policy violations', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---------- 2. offline ----------
  await stop();
  check('server is really gone', await fetch(URL0).then(() => false, () => true));
  errors.length = 0;
  await cdp('Page.navigate', { url: URL0 + '#apps' }); await sleep(2500);
  check('offline: app starts from the cache', await waitFor(`return !!document.querySelector('.col.jobs')`, 10000));
  check('offline: data still there', await run(`return document.querySelector('.col.jobs').innerText.includes('Hafenblick')`));
  // on-demand code: the Word importer chunk
  await run(`location.hash='#templates'; return 1;`); await sleep(1200);
  const { result: { root } } = await cdp('DOM.getDocument', {});
  const { result: { nodeId } } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file][accept*=docx]' });
  await cdp('DOM.setFileInputFiles', { nodeId, files: [path.join(ROOT, 'server', 'test', 'fixtures', 'alex-cv.docx').replaceAll('\\', '/')] });
  check('offline: Word import (loaded on demand) works', await waitFor(`return !!document.querySelector('.import')`, 15000));
  await run(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Cancel')?.click(); return 1;`); await sleep(500);
  { const { result: { root: r2 } } = await cdp('DOM.getDocument', {});
    const { result: { nodeId: n2 } } = await cdp('DOM.querySelector', { nodeId: r2.nodeId, selector: 'input[type=file][accept*=pdf]' });
    await cdp('DOM.setFileInputFiles', { nodeId: n2, files: [path.join(ROOT, 'server', 'test', 'fixtures', 'alex-letter-and-cv.pdf').split(path.sep).join('/')] }); }
  check('offline: PDF import (pdf.js worker, under the security policy) works', await waitFor(`return document.querySelectorAll('.import-parts .btn').length >= 2`, 20000));
  await shot('pwa-offline.png');
  check('offline: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await cdp('Page.reload', {}); await sleep(2500);
  check('offline: a full reload still works', await waitFor(`return !!document.querySelector('.titlebar')`, 10000));

  // ---------- 3. a normal update ----------
  await sleep(1100); build(); await serve();
  errors.length = 0;
  await run(`(await navigator.serviceWorker.getRegistration()).update(); return 1;`);
  check('update: banner appears', await waitFor(`return document.body.innerText.includes('A new version of Easy Apply is ready')`, 30000));
  await run(H + `btn('Reload').click(); return 1;`).catch(() => {});
  await sleep(3000);
  const v2 = await buildOnPage();
  check('update: Reload switches to the new version', !!v2 && v2 !== v1, `${v1} → ${v2}`);
  check('update: banner gone after the reload', !(await run(`return document.body.innerText.includes('A new version')`)));
  check('update: data kept', await run(`location.hash='#apps'; await new Promise(r=>setTimeout(r,800)); return document.querySelector('.col.jobs').innerText.includes('Hafenblick')`));

  // ---------- 4. an update that can't download one of its new files (connection drop, server error) ----------
  await stop(); await sleep(1100); build();
  // only changed files are downloaded in an update: break the one that always changes, the new main script
  const main = fs.readFileSync(path.join(WEB, 'dist/index.html'), 'utf8').match(/src="\/(assets\/index-[^"]+\.js)"/)[1];
  fs.rmSync(path.join(WEB, 'dist', main));
  await serve();
  await run(`(await navigator.serviceWorker.getRegistration()).update().catch(()=>{}); return 1;`);
  await sleep(8000);
  const state = await run(`const r = await navigator.serviceWorker.getRegistration(); return { waiting: !!r.waiting, installing: !!r.installing, banner: document.body.innerText.includes('A new version') };`);
  check('broken update: not offered (no half-installed version)', !state.waiting && !state.banner, JSON.stringify(state));
  await cdp('Page.reload', {}); await sleep(2500);
  const v3 = await buildOnPage();
  check('broken update: the previous version keeps running', v3 === v2, `still ${v3}`);
  check('broken update: data kept', await run(`location.hash='#apps'; await new Promise(r=>setTimeout(r,800)); return document.querySelector('.col.jobs').innerText.includes('Hafenblick')`));

  // ---------- 5. the next complete update ----------
  await stop(); await sleep(1100); build(); await serve();
  await run(`(await navigator.serviceWorker.getRegistration()).update(); return 1;`);
  check('recovery: next complete update is offered', await waitFor(`return document.body.innerText.includes('A new version of Easy Apply is ready')`, 30000));
} catch (e) {
  check('script', false, e.message);
} finally {
  await stop(); ws.close(); edge.kill();
  build(); // leave a complete build behind
  console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`);
}
