import type { Worktree } from './worktree';

/** What `/terminal` was asked: a new tab or not, and a path if one was typed. */
export function parseTerminalArgs(args: string): {
  isNew: boolean;
  path?: string;
  unknown?: string;
} {
  let isNew = false;
  const rest: string[] = [];
  for (const word of args.trim().split(/\s+/).filter(Boolean)) {
    if (word === '-n' || word === '--new') isNew = true;
    else if (word.startsWith('-') && rest.length === 0) return { isNew, unknown: word };
    else rest.push(word);
  }
  const path = rest.join(' ');
  return path ? { isNew, path } : { isNew };
}

/** `/a/./b/../c/` → `/a/c`. */
export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/**
 * Where a typed path points: a worktree by its name, an absolute path, `~` and `~/…` under the
 * home folder, anything else under the session's directory.
 */
export function resolvePath(
  arg: string,
  input: { cwd: string; home: string; linked: readonly Worktree[] },
): string {
  const named = input.linked.find((t) => t.name === arg);
  if (named) return named.path;
  if (arg.startsWith('/')) return normalize(arg);
  if (arg === '~') return normalize(input.home);
  if (arg.startsWith('~/')) return normalize(`${input.home}/${arg.slice(2)}`);
  return normalize(`${input.cwd}/${arg}`);
}

/** A tab of the desktop app's Terminal panel, as `list_terminal_tabs` lists it. */
export interface TerminalTab {
  tab_id: string;
  title: string | null;
  /** Where its shell started (not where it has since `cd`'d to). */
  cwd: string;
}

/** The tabs out of `list_terminal_tabs`'s text; none when it is not the list it should be. */
export function parseTabs(text: string | undefined): TerminalTab[] {
  try {
    const value: unknown = JSON.parse(text ?? '');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (tab): tab is TerminalTab =>
        typeof tab === 'object' &&
        tab !== null &&
        typeof (tab as TerminalTab).tab_id === 'string' &&
        typeof (tab as TerminalTab).cwd === 'string',
    );
  } catch {
    return [];
  }
}

const isInside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/**
 * The tab to bring forward for `dir`: the newest one whose shell started there, else the newest
 * one that started somewhere inside it. A tab inside another worktree that sits within `dir` (the
 * main checkout holds `.claude/worktrees/…`) belongs to that worktree, not to `dir`.
 */
export function tabFor(
  tabs: readonly TerminalTab[],
  dir: string,
  worktrees: readonly string[] = [],
): TerminalTab | undefined {
  const want = normalize(dir);
  const exact = tabs.filter((tab) => normalize(tab.cwd) === want).at(-1);
  if (exact) return exact;
  const nested = worktrees.map(normalize).filter((w) => w !== want && isInside(w, want));
  return tabs
    .filter((tab) => {
      const at = normalize(tab.cwd);
      return isInside(at, want) && !nested.some((w) => isInside(at, w));
    })
    .at(-1);
}
