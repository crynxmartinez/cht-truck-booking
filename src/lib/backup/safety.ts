import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The backup folder holds licences and insurance photos. If it is inside the
 * code folder (which is a public repository), Git has to be ignoring it and
 * tracking nothing in it, or the command refuses to run.
 */

export type GitRunner = (args: string[]) => { ok: boolean; stdout: string };

export type SafetyResult = { ok: true } | { ok: false; reason: string };

export function insideRepo(root: string, repoRoot: string): boolean {
  const rel = relative(resolve(repoRoot), resolve(root));
  // "..backup" is a folder INSIDE the repo; only ".." itself or "..\something" leaves it.
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Two backup folders must be genuinely separate: the same folder, or one inside the other, is not a second copy. */
export function foldersOverlap(a: string, b: string): boolean {
  const x = resolve(a).toLowerCase(); // Windows paths are not case sensitive
  const y = resolve(b).toLowerCase();
  const within = (inner: string, outer: string) => {
    const rel = relative(outer, inner);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  return within(x, y) || within(y, x);
}

export function assertSafeDestination(root: string, repoRoot: string, git: GitRunner): SafetyResult {
  if (!insideRepo(root, repoRoot)) return { ok: true }; // outside the code folder: nothing to leak into Git

  const rel = relative(resolve(repoRoot), resolve(root)).split(sep).join('/');
  if (rel === '') return { ok: false, reason: 'The backup folder cannot be the code folder itself.' };

  const probe = `${rel}/__probe__/x.txt`;
  if (!git(['check-ignore', '-q', probe]).ok) {
    return { ok: false, reason: `Git is not ignoring "${rel}". Add it to .gitignore first, so renters' files can never be committed.` };
  }
  const tracked = git(['ls-files', '--', rel]);
  if (!tracked.ok) return { ok: false, reason: 'Could not ask Git what is tracked, so the folder was not trusted.' };
  if (tracked.stdout.trim() !== '') {
    return { ok: false, reason: `Git is already tracking files inside "${rel}". Remove them from Git before backing up here.` };
  }
  return { ok: true };
}
