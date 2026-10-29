import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanFileName } from '../../shared/fs';
import { createStore, type Store } from '../../shared/store';
import { memFs } from './memfs';

let fs: ReturnType<typeof memFs>;
let store: Store;
beforeEach(async () => {
  fs = memFs();
  store = createStore(fs);
  await store.ensureRoot();
  await store.saveProfile({ fields: [{ key: 'name', label: 'Name', value: 'Alex Example' }, { key: 'email', label: 'Email', value: 'alex@example.com' }] });
  await store.addStarters(['cv-en', 'cover-en'], 'classic');
});

describe('jobs', () => {
  it('creates a dated folder without (m/w/d) and fills placeholders when a template is copied in', async () => {
    const job = await store.createJob({ title: 'Data Engineer (m/w/d)', company: 'Acme GmbH', location: 'Berlin' }, 'posting text');
    expect(job.id).toMatch(/^\d{4}-\d\d-\d\d_acme-gmbh_data-engineer$/);
    const name = await store.addDocFromTemplate(job.id, 'cover-en');
    const doc = await store.getDoc(job.id, name);
    expect(doc.body).toContain('# Your Name');
    expect(doc.body).toContain('Application for Data Engineer (m/w/d)');
    expect(doc.body).not.toContain('{{company}}');
    expect((await store.getJob(job.id)).bucket).toEqual([name]);
  });

  it('gives two jobs with the same name separate folders', async () => {
    const a = await store.createJob({ title: 'Dev', company: 'X' });
    const b = await store.createJob({ title: 'Dev', company: 'X' });
    expect(a.id).not.toBe(b.id);
    expect(await store.listJobs()).toHaveLength(2);
  });

  it('skips a folder with a broken job.json instead of failing the whole list', async () => {
    await store.createJob({ title: 'Good', company: 'Y' });
    await fs.write('jobs/broken/job.json', '{ not json');
    await fs.mkdir('jobs/empty-folder');
    const jobs = await store.listJobs();
    expect(jobs.map(j => j.title)).toContain('Good');
    // the broken one loads with defaults rather than crashing
    expect(jobs.every(j => typeof j.title === 'string' && Array.isArray(j.docs))).toBe(true);
  });

  it('records status history and the next step', async () => {
    const j = await store.createJob({ title: 'Dev', company: 'X' });
    const after = await store.setStatus(j.id, 'interview', 'Tue 10:00');
    expect(after.history.map(h => h.status)).toEqual(['saved', 'interview']);
    expect(after.next).toBe('Interview Tue 10:00');
    await expect(store.setStatus(j.id, 'hired' as never)).rejects.toThrow(/Unknown status/);
  });

  it('moves a deleted job to .trash with all its files', async () => {
    const j = await store.createJob({ title: 'Dev', company: 'X' }, 'posting');
    const doc = await store.addDocFromTemplate(j.id, 'cv-en');
    const to = await store.trashJob(j.id);
    expect(to).toMatch(/^\.trash\/jobs\//);
    expect(await store.listJobs()).toHaveLength(0);
    expect(await fs.exists(`${to}/${doc}`)).toBe(true);
    expect(await fs.exists(`${to}/posting.md`)).toBe(true);
  });
});

describe('documents and versions', () => {
  it('keeps the earlier text as a version, at most one per 10 minutes unless forced', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-27T10:00:00Z'), toFake: ['Date'] });
    const j = await store.createJob({ title: 'Dev', company: 'X' });
    const name = await store.addDocFromTemplate(j.id, 'cv-en');
    const v0 = (await store.getDoc(j.id, name)).body;
    await store.saveDoc(j.id, name, 'one');
    await store.saveDoc(j.id, name, 'two');               // within 10 minutes: no new version
    expect(await store.listVersions(j.id, name)).toHaveLength(1);
    expect(await store.getVersion(j.id, name, (await store.listVersions(j.id, name))[0].id)).toBe(v0);
    vi.setSystemTime(new Date('2026-10-27T10:11:00Z'));
    await store.saveDoc(j.id, name, 'three');
    expect(await store.listVersions(j.id, name)).toHaveLength(2);
    await store.saveDoc(j.id, name, 'three', undefined, true); // forced (accepted AI change, "Save a version now")
    expect(await store.listVersions(j.id, name)).toHaveLength(3);
    vi.useRealTimers();
  });

  it('restoring a version keeps the current text as a version first', async () => {
    const j = await store.createJob({ title: 'Dev', company: 'X' });
    const name = await store.addDocFromTemplate(j.id, 'cv-en');
    await store.saveDoc(j.id, name, 'edited');
    const [v] = await store.listVersions(j.id, name);
    const restored = await store.restoreVersion(j.id, name, v.id);
    expect(restored.body).not.toBe('edited');
    const all = await store.listVersions(j.id, name);
    const bodies = await Promise.all(all.map(x => store.getVersion(j.id, name, x.id)));
    expect(bodies).toContain('edited');
  });

  it('a failed write leaves the document as it was', async () => {
    const j = await store.createJob({ title: 'Dev', company: 'X' });
    const name = await store.addDocFromTemplate(j.id, 'cv-en');
    const before = (await store.getDoc(j.id, name)).body;
    // the version snapshot succeeds, then the document write fails (e.g. file locked by OneDrive)
    const snapThenFail = fs.write.bind(fs);
    let calls = 0;
    fs.write = async (p, d) => { if (++calls === 2) throw Object.assign(new Error('locked'), { name: 'NoModificationAllowedError' }); return snapThenFail(p, d); };
    await expect(store.saveDoc(j.id, name, 'new text')).rejects.toThrow('locked');
    fs.write = snapThenFail;
    expect((await store.getDoc(j.id, name)).body).toBe(before);
  });

  it('cleans document style values coming from a file', async () => {
    const j = await store.createJob({ title: 'Dev', company: 'X' });
    const name = await store.addDocFromTemplate(j.id, 'cv-en');
    const text = await fs.read(`jobs/${j.id}/${name}`);
    await fs.write(`jobs/${j.id}/${name}`, text.replace('theme: classic', 'theme: classic\nstyle:\n  size: 999\n  align: "x\\" onload=\\"evil"\n  lineHeight: 1.3'));
    const doc = await store.getDoc(j.id, name);
    expect(doc.meta.style).toEqual({ lineHeight: 1.3 });
  });
});

describe('names and paths', () => {
  it('refuses paths that would leave a folder', async () => {
    for (const bad of ['../profile/profile.json', '..', '.hidden', 'a/b', 'a\\b', ''])
      await expect(store.getJob(bad)).rejects.toThrow();
    const j = await store.createJob({ title: 'Dev', company: 'X' });
    await expect(store.getDoc(j.id, '../../profile/profile.json')).rejects.toThrow(/Invalid file name/);
    await expect(store.getDoc(j.id, 'job.json')).rejects.toThrow(/\.md files/);
  });

  it('stores uploads under safe names', async () => {
    expect(await store.addExtra('CV: final?.PDF', new Blob(['x']))).toBe('CV_ final_.pdf');
    expect(await store.addExtra('con.txt', new Blob(['x']))).toBe('_con.txt');
    expect(await store.addExtra('CV: final?.PDF', new Blob(['y']))).toBe('CV_ final_-2.pdf');
    expect(cleanFileName('Zeugnis Müller (2024).pdf')).toBe('Zeugnis Müller (2024).pdf');
    expect(cleanFileName('...')).toBe('file');
  });

  it('deleting a template moves it to .trash and leaves job copies alone', async () => {
    const j = await store.createJob({ title: 'Dev', company: 'X' });
    const name = await store.addDocFromTemplate(j.id, 'cv-en');
    await store.trashTemplate('cv-en');
    expect((await store.listTemplates()).map(t => t.id)).not.toContain('cv-en');
    expect(await fs.exists('.trash/templates/cv-en.md')).toBe(true);
    expect((await store.getDoc(j.id, name)).body).toContain('# Your Name');
  });
});

describe('main CV', () => {
  it('one main CV per language; the only CV of a language counts as main; job copies are never main', async () => {
    await store.addStarters(['cv-de'], 'classic');
    const imported = await store.createTemplate({ title: 'My real CV', kind: 'cv', lang: 'en', theme: 'classic' }, '# Alex\n\n- Real experience');
    // two English CVs, none marked: no guessing beyond "first"
    expect((await store.mainCv('de'))!.id).toBe('cv-de');
    await store.setMain(imported.id);
    expect((await store.mainCv('en'))!.id).toBe(imported.id);
    await store.setMain('cv-en');
    const list = await store.listTemplates();
    expect(list.filter(t => t.main).map(t => t.id).sort()).toEqual(['cv-en']);
    expect((await store.mainCv('en'))!.id).toBe('cv-en');
    expect((await store.mainCv('fr'))!.id).toBe('cv-en');          // another language: fall back to a main CV
    // a cover letter has its own main per language, and never stands in for another language
    await store.setMain('cover-en');
    expect((await store.listTemplates()).filter(t => t.main).map(t => t.id).sort()).toEqual(['cover-en', 'cv-en']);
    const { mainOf } = await import('../../shared/store');
    expect(mainOf(await store.listTemplates(), 'cover', 'de')).toBeUndefined();
    expect(mainOf(await store.listTemplates(), 'cover', 'en')!.id).toBe('cover-en');
    const other = await store.createTemplate({ title: 'Notes', kind: 'other', lang: 'en', theme: 'classic' }, 'x');
    await expect(store.setMain(other.id)).rejects.toThrow(/Only a CV or a cover letter/);
    const j = await store.createJob({ title: 'Dev', company: 'X' });
    const name = await store.addDocFromTemplate(j.id, 'cv-en');
    expect((await store.getDoc(j.id, name)).meta.main).toBeUndefined();
  });
});


describe('documents in an application', () => {
  it('copies an example in, filled for the job, and remembers where each copy came from', async () => {
    const job = await store.createJob({ title: 'Data Engineer', company: 'Lumen Labs', location: 'Berlin' });
    const letter = await store.addDocFromExample(job.id, 'example-letter');
    const cv = await store.addDocFromTemplate(job.id, 'cv-en');
    const doc = await store.getDoc(job.id, letter);
    expect(doc.meta.kind).toBe('cover');
    expect(doc.body).toContain('Dear Lumen Labs team');
    expect(doc.body).not.toContain('{{');
    expect((await store.getJob(job.id)).sources).toEqual({ [letter]: 'example:example-letter', [cv]: 'cv-en' });
    await expect(store.addDocFromExample(job.id, 'nope')).rejects.toThrow(/not found/);
  });

  it('removing a document keeps the file in .removed and leaves the original untouched', async () => {
    const job = await store.createJob({ title: 'Dev', company: 'X' });
    const name = await store.addDocFromTemplate(job.id, 'cv-en');
    await store.saveDoc(job.id, name, '# Changed for X\n');
    const before = await store.getTemplate('cv-en');
    const after = await store.removeDoc(job.id, name);
    expect(after.docs).toEqual([]);
    expect(after.bucket).toEqual([]);
    expect(after.sources?.[name]).toBeUndefined();
    const kept = (await fs.list(`jobs/${job.id}/.removed`)).map(e => e.name);
    expect(kept).toEqual([name]);
    expect(await fs.read(`jobs/${job.id}/.removed/${name}`)).toContain('# Changed for X');
    expect((await store.getTemplate('cv-en')).body).toBe(before.body);
  });

  it('saving an original never changes its main flag, and never brings a deleted one back', async () => {
    await store.setMain('cv-en');
    const t = await store.getTemplate('cv-en');
    await store.saveTemplate('cv-en', { ...t.meta, main: undefined }, t.body + '\nmore\n'); // an editor with an older copy
    expect((await store.getTemplate('cv-en')).meta.main).toBe(true);
    await store.trashTemplate('cv-en');
    await expect(store.saveTemplate('cv-en', t.meta, t.body)).rejects.toThrow(/not found/);
    expect((await store.listTemplates()).map(x => x.id)).not.toContain('cv-en');
  });
});

describe('your details are plain text', () => {
  it('fills the old {{name}} … placeholders in once, everywhere, and leaves the job ones', async () => {
    const f = memFs(); const st = createStore(f);
    await f.mkdir('profile');
    await f.write('profile/profile.json', JSON.stringify({ fields: [{ key: 'name', label: 'Name', value: 'Alex Example' }, { key: 'phone', label: 'Phone', value: '' }] }));
    await f.write('templates/letter.md', '---\ntitle: L\nkind: cover\n---\n# {{name}}\n\n{{phone}}\n\nDear {{company}} team\n');
    await f.write('jobs/2026-01-01_x_y/job.json', JSON.stringify({ id: '2026-01-01_x_y', docs: ['cv.md'] }));
    await f.write('jobs/2026-01-01_x_y/cv.md', '---\ntitle: C\nkind: cv\n---\n# {{ name }}\n');
    await st.ensureRoot();
    const letter = await st.getTemplate('letter');
    expect(letter.body).toBe('# Alex Example\n\n{{phone}}\n\nDear {{company}} team\n'); // an empty value stays, to be typed over
    expect((await st.getDoc('2026-01-01_x_y', 'cv.md')).body).toBe('# Alex Example\n');
    // once only: a {{name}} written later on purpose stays as it is
    await st.saveTemplate('letter', letter.meta, '# {{name}}\n');
    await st.ensureRoot();
    expect((await st.getTemplate('letter')).body).toBe('# {{name}}\n');
  });
});
