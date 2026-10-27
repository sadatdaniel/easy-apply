import { zipSync, unzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { applyRestore, collectFiles, MARKER, planRestore, safeBackupPath } from '../../shared/backup';
import { createStore } from '../../shared/store';
import { memFs } from './memfs';

async function setup() {
  const fs = memFs(); const store = createStore(fs);
  await store.ensureRoot(); await store.addStarters(['cv-en'], 'classic');
  const job = await store.createJob({ title: 'Dev', company: 'Acme' }, 'posting');
  const doc = await store.addDocFromTemplate(job.id, 'cv-en');
  await store.saveDoc(job.id, doc, 'edited', undefined, true);
  await store.trashTemplate('cv-en'); await store.addStarters(['cv-en'], 'classic'); // something in .trash
  return { fs, store, job, doc };
}
const zipOf = async (files: { path: string; data: Blob }[]) => {
  const entries: Record<string, Uint8Array> = { [MARKER]: strToU8('{}') };
  for (const f of files) entries[f.path] = new Uint8Array(await f.data.arrayBuffer());
  return unzipSync(zipSync(entries));
};

describe('backup and restore', () => {
  it('a backup holds everything except the trash, and restores into an empty folder', async () => {
    const { fs, job, doc } = await setup();
    const files = await collectFiles(fs);
    const paths = files.map(f => f.path);
    expect(paths).toContain('profile/profile.json');
    expect(paths).toContain(`jobs/${job.id}/${doc}`);
    expect(paths.some(p => p.includes('/versions/'))).toBe(true);
    expect(paths.some(p => p.startsWith('.trash'))).toBe(false);

    const fresh = memFs(); const restored = createStore(fresh);
    const r = await applyRestore(fresh, planRestore(await zipOf(files)));
    expect(r).toMatchObject({ written: files.length, replaced: 0 });
    expect((await restored.getDoc(job.id, doc)).body).toBe('edited');
    expect(await restored.listVersions(job.id, doc)).toHaveLength(1);
  });

  it('restoring over current work keeps the current files in .trash and deletes nothing', async () => {
    const { fs, store, job, doc } = await setup();
    const backup = await zipOf(await collectFiles(fs));
    await store.saveDoc(job.id, doc, 'newer text', undefined, true);
    const other = await store.createJob({ title: 'Later', company: 'Beta' });
    const r = await applyRestore(fs, planRestore(backup), 'T1');
    expect((await store.getDoc(job.id, doc)).body).toBe('edited');
    expect(r.replaced).toBeGreaterThan(0);
    expect(await fs.read(`.trash/restore-T1/jobs/${job.id}/${doc}`)).toContain('newer text');
    expect((await store.listJobs()).map(j => j.id)).toContain(other.id); // not in the backup, still there
  });

  it('refuses paths that would leave the app folder, and files that are not backups', () => {
    for (const bad of ['../evil.md', 'jobs/../../evil', '/etc/passwd', 'C:/x', 'jobs\\x.md', '.trash/x', 'jobs/.hidden/x', 'other/x.md', 'jobs', 'jobs/a:b.md'])
      expect(safeBackupPath(bad)).toBeNull();
    expect(safeBackupPath('jobs/2026-10-27_acme_dev/cv-en.md')).toBe('jobs/2026-10-27_acme_dev/cv-en.md');
    const plan = planRestore({ 'jobs/a/job.json': strToU8('{}'), '../../x': strToU8('evil'), 'readme.txt': strToU8('hi') });
    expect(plan.files.map(f => f.path)).toEqual(['jobs/a/job.json']);
    expect(plan.skipped).toEqual(['../../x', 'readme.txt']);
    expect(() => planRestore({ 'holiday.jpg': strToU8('x') })).toThrow(/not an Easy Apply backup/);
  });
});
