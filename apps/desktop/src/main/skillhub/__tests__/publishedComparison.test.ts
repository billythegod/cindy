import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/published-content.json';
import { comparePublishedSkill, localComparisonFiles, publishedManifest } from '../publishedComparison';
import type { SkillhubMarketService } from '../marketService';
import type { Skill } from '../scanner';

let root: string;
let skill: Pick<Skill, 'name' | 'absolutePath' | 'registryEntry' | 'registrySkillName'>;
const info = { isCreator: true, canManage: true, authorId: 'owner', ownerType: 'personal', latestVersion: '1.0.0' };
const market = {
  info: vi.fn(),
  getPublishedFiles: vi.fn(),
  readPublishedFile: vi.fn(),
};
const compare = (diff = false) => comparePublishedSkill(skill, market as unknown as SkillhubMarketService, diff);
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-compare-'));
  for (const file of fixture) {
    await fs.mkdir(path.dirname(path.join(root, file.path)), { recursive: true });
    await fs.writeFile(path.join(root, file.path), Buffer.from(file.base64, 'base64'));
  }
  skill = { name: 'golden-skill', absolutePath: root, registryEntry: null };
  market.info.mockReset().mockResolvedValue({ success: true, info });
  market.getPublishedFiles.mockReset().mockResolvedValue({ version: '1.0.0', files: fixture });
  market.readPublishedFile.mockReset().mockImplementation(async ({ path: name }) => ({
    file: { content: Buffer.from(fixture.find((file) => file.path === name)!.base64, 'base64').toString('utf8'), truncated: false },
  }));
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('published content comparison', () => {
  it('matches the server golden bytes, including binary and empty files, without a registry snapshot', async () => {
    const local = await localComparisonFiles(root, false);
    expect(local.sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      fixture.map(({ path, size, sha256 }) => ({ path, size, sha256 })).sort((a, b) => a.path.localeCompare(b.path)),
    );
    expect(await compare()).toEqual({ status: 'same', version: '1.0.0', pending: false });
    expect(market.getPublishedFiles).toHaveBeenCalledWith({ name: 'golden-skill', version: '1.0.0', includeHashes: true });
  });

  it('counts version-only edits and compares with the remote text', async () => {
    const original = Buffer.from(fixture[0].base64, 'base64').toString('utf8');
    await fs.writeFile(path.join(root, 'SKILL.md'), original.replace('1.0.0', '1.0.1'));
    expect(await compare(true)).toMatchObject({ status: 'different', changes: [{
      path: 'SKILL.md', kind: 'modified', isBinary: false, oldContent: original, newContent: original.replace('1.0.0', '1.0.1'),
    }] });
  });

  it('detects added scripts, removed files and changed binary bytes', async () => {
    await fs.writeFile(path.join(root, 'scripts/new.py'), 'new');
    await fs.unlink(path.join(root, 'empty.txt'));
    await fs.writeFile(path.join(root, 'assets/icon.bin'), Buffer.from([0, 1]));
    const result = await compare(true);
    expect(result).toMatchObject({ status: 'different', changes: [
      { path: 'assets/icon.bin', kind: 'modified', isBinary: true, oldSize: 5, newSize: 2 },
      { path: 'empty.txt', kind: 'removed' },
      { path: 'scripts/new.py', kind: 'added', newContent: 'new' },
    ] });
  });

  it('uses the submitted version while it is awaiting review', async () => {
    market.info.mockResolvedValue({ info: { ...info, pendingVersion: { version: '1.1.0', status: 'pending' } } });
    market.getPublishedFiles.mockResolvedValue({ version: '1.1.0', files: fixture });
    expect(await compare()).toEqual({ status: 'same', version: '1.1.0', pending: true });
    await fs.writeFile(path.join(root, 'scripts/run.py'), 'changed again');
    expect(await compare()).toEqual({ status: 'different', version: '1.1.0', pending: true });
  });

  it.each([false, undefined])('does not infer authorship from management rights (%s)', async (isCreator) => {
    market.info.mockResolvedValue({ info: { ...info, isCreator } });
    expect(await compare()).toEqual({ status: isCreator === false ? 'not-owner' : 'unavailable' });
    expect(market.getPublishedFiles).not.toHaveBeenCalled();
  });

  it('does not cross catalog identities with the same slug', async () => {
    skill.registryEntry = { catalogScope: 'team' } as Skill['registryEntry'];
    market.info.mockResolvedValueOnce({ info }).mockResolvedValueOnce({ info: { ...info, authorId: 'different-owner' } });
    expect(await compare()).toEqual({ status: 'not-owner' });
    expect(market.getPublishedFiles).not.toHaveBeenCalled();
  });

  it('fails rather than treating a missing digest, changing version, or unreadable tree as clean', async () => {
    market.getPublishedFiles.mockResolvedValueOnce({ version: '1.0.0', files: fixture.map(({ sha256, ...file }) => file) });
    await expect(compare()).rejects.toThrow('Missing file digest');
    market.getPublishedFiles.mockResolvedValueOnce({ version: '2.0.0', files: fixture });
    await expect(compare()).rejects.toThrow('Published version changed');
    await fs.rename(root, root + '-moved');
    try { await expect(compare()).rejects.toThrow(); }
    finally { await fs.rename(root + '-moved', root); }
  });

  it('skips packaging exclusions and symlinks without reading their targets', async () => {
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, '.git/config'), 'ignore');
    await fs.writeFile(path.join(root, '.DS_Store'), 'ignore');
    await fs.symlink(os.tmpdir(), path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await compare()).toMatchObject({ status: 'same' });
  });

  it('shows summaries for truncated or unverifiable remote text', async () => {
    await fs.writeFile(path.join(root, 'scripts/run.py'), 'new');
    market.readPublishedFile.mockResolvedValue({ file: { content: 'wrong', truncated: false } });
    expect(await compare(true)).toMatchObject({ changes: [{ path: 'scripts/run.py', isBinary: true, oldContent: '', newContent: '' }] });
    market.readPublishedFile.mockResolvedValue({ file: { content: 'print("hello")\n', truncated: true } });
    expect(await compare(true)).toMatchObject({ changes: [{ isBinary: true }] });
  });

  it('never downloads large files just to preview them', async () => {
    const content = Buffer.alloc(2 * 1024 * 1024, 'a');
    const sha256 = createHash('sha256').update(content).digest('hex');
    market.getPublishedFiles.mockResolvedValue({ version: '1.0.0', files: [...fixture, { path: 'large.txt', size: content.length, sha256 }] });
    expect(await compare(true)).toMatchObject({ changes: [{ path: 'large.txt', kind: 'removed', isBinary: true }] });
    expect(market.readPublishedFile).not.toHaveBeenCalled();
  });

  it.each(['../escape', '/etc/passwd', 'C:/secret', 'a//b', 'a/./b', 'a\\b'])('rejects invalid remote paths: %s', (name) => {
    expect(() => publishedManifest([...fixture, { ...fixture[0], path: name }])).toThrow('Invalid published path');
  });
  it('rejects duplicated and incomplete remote manifests', () => {
    expect(() => publishedManifest([...fixture, fixture[0]])).toThrow('Invalid published path');
    expect(() => publishedManifest(fixture.slice(1))).toThrow('Missing Skill manifest');
  });
});
