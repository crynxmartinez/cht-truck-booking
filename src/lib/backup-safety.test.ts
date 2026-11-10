import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The backup folder holds renters' licences and insurance photos, and it sits
 * inside a PUBLIC repository. These tests are the lock on that door: if the
 * ignore rules are ever removed, or something in the folder gets tracked, the
 * test run fails before a push can happen.
 */

const ROOT = join(__dirname, '..', '..');
const FOLDER = 'back up'; // a space in the name: every command here quotes it

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const inGitRepo = git('rev-parse', '--is-inside-work-tree')?.trim() === 'true';

describe('the backup folder can never be committed or deployed', () => {
  it('is listed in .gitignore', () => {
    const rules = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(rules).toContain(`/${FOLDER}/`);
  });

  it('is listed in .vercelignore, so a manual deploy cannot upload it', () => {
    const rules = readFileSync(join(ROOT, '.vercelignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(rules).toContain(`/${FOLDER}`);
  });

  it.runIf(inGitRepo)('is ignored by Git, whatever is put inside it', () => {
    for (const probe of ['x.txt', 'CHT-AB12CD - Renter - Nov 20 2026/files/licence.webp', 'bookings.csv']) {
      expect(git('check-ignore', '-q', `${FOLDER}/${probe}`) !== null).toBe(true);
    }
  });

  it.runIf(inGitRepo)('has nothing tracked inside it', () => {
    expect(git('ls-files', '--', FOLDER)?.trim()).toBe('');
  });
});
