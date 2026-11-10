import { describe, expect, it } from 'vitest';
import { assertSafeDestination, foldersOverlap, insideRepo, type GitRunner } from './safety';

const REPO = 'C:\\Code\\chtsystemtruck';

const git = (opts: { ignored: boolean; tracked?: string; lsOk?: boolean }): GitRunner => (args) => {
  if (args[0] === 'check-ignore') return { ok: opts.ignored, stdout: '' };
  if (args[0] === 'ls-files') return { ok: opts.lsOk ?? true, stdout: opts.tracked ?? '' };
  return { ok: false, stdout: '' };
};

describe('insideRepo', () => {
  it('knows what is inside the code folder', () => {
    expect(insideRepo(`${REPO}\\back up`, REPO)).toBe(true);
    expect(insideRepo(`${REPO}\\a\\b`, REPO)).toBe(true);
    expect(insideRepo(REPO, REPO)).toBe(true);
  });
  it('knows what is outside, including look-alike names and parent tricks', () => {
    expect(insideRepo('C:\\Users\\Lenovo\\Documents\\CHT', REPO)).toBe(false);
    expect(insideRepo('C:\\Code\\chtsystemtruck-other\\x', REPO)).toBe(false);
    expect(insideRepo(`${REPO}\\..\\elsewhere`, REPO)).toBe(false);
    expect(insideRepo('G:\\My Drive\\CHT Truck Backups', REPO)).toBe(false);
  });
});

describe('a folder whose name starts with two dots', () => {
  it('is inside the repo, not outside it', () => {
    expect(insideRepo(`${REPO}\\..backup`, REPO)).toBe(true);
    expect(assertSafeDestination(`${REPO}\\..backup`, REPO, git({ ignored: false }))).toMatchObject({ ok: false });
  });
});

describe('foldersOverlap', () => {
  it('says the same folder is not a second copy, however it is spelt', () => {
    expect(foldersOverlap('C:\\a\\b', 'C:\\a\\b')).toBe(true);
    expect(foldersOverlap('C:\\a\\b', 'c:\\A\\B\\')).toBe(true);
    expect(foldersOverlap('C:\\a\\b', 'C:\\a\\x\\..\\b')).toBe(true);
  });
  it('says one folder inside the other is not a second copy either', () => {
    expect(foldersOverlap('C:\\a\\b', 'C:\\a\\b\\c')).toBe(true);
    expect(foldersOverlap('C:\\a\\b\\c', 'C:\\a\\b')).toBe(true);
  });
  it('allows genuinely separate folders, including look-alike names', () => {
    expect(foldersOverlap('C:\\a\\b', 'G:\\My Drive\\x')).toBe(false);
    expect(foldersOverlap('C:\\a\\b', 'C:\\a\\bc')).toBe(false);
    expect(foldersOverlap('C:\\a\\b', 'C:\\a\\..b')).toBe(false);
  });
});

describe('assertSafeDestination', () => {
  it('allows a folder outside the repo without asking Git', () => {
    expect(assertSafeDestination('G:\\My Drive\\CHT Truck Backups', REPO, git({ ignored: false }))).toEqual({ ok: true });
  });

  it('allows the repo folder only when Git ignores it and tracks nothing in it', () => {
    expect(assertSafeDestination(`${REPO}\\back up`, REPO, git({ ignored: true }))).toEqual({ ok: true });
  });

  it('refuses when Git is not ignoring it', () => {
    const r = assertSafeDestination(`${REPO}\\back up`, REPO, git({ ignored: false }));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toMatch(/not ignoring/);
  });

  it('refuses when something inside is already tracked', () => {
    const r = assertSafeDestination(`${REPO}\\back up`, REPO, git({ ignored: true, tracked: 'back up/leaked.jpg\n' }));
    expect(!r.ok && r.reason).toMatch(/already tracking/);
  });

  it('refuses when Git cannot be asked, rather than trusting', () => {
    expect(assertSafeDestination(`${REPO}\\back up`, REPO, git({ ignored: true, lsOk: false }))).toMatchObject({ ok: false });
  });

  it('refuses the code folder itself', () => {
    expect(assertSafeDestination(REPO, REPO, git({ ignored: true }))).toMatchObject({ ok: false });
  });

  it('asks Git about a path with a space in it, as one argument', () => {
    const seen: string[][] = [];
    assertSafeDestination(`${REPO}\\back up`, REPO, (args) => { seen.push(args); return { ok: true, stdout: '' }; });
    expect(seen[0]).toEqual(['check-ignore', '-q', 'back up/__probe__/x.txt']);
    expect(seen[1]).toEqual(['ls-files', '--', 'back up']);
  });
});
