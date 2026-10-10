import { expect, test } from 'claude-code/testing';
import { parseTabs, parseTerminalArgs, resolvePath, tabFor, type TerminalTab } from './terminal';
import { parseWorktreeList } from './worktree';

const MAIN = '/repo';
const HOME_SCREEN = `${MAIN}/.claude/worktrees/home-screen`;
const { linked } = parseWorktreeList(
  `worktree ${MAIN}\n\nworktree ${HOME_SCREEN}\n\nworktree ${MAIN}/.claude/worktrees/e2e\n`,
);
const tab = (tab_id: string, cwd: string): TerminalTab => ({
  tab_id,
  title: null,
  cwd,
});

test('reads -n and --new, a path, and refuses an unknown option', () => {
  expect(parseTerminalArgs('')).toEqual({ isNew: false });
  expect(parseTerminalArgs('-n')).toEqual({ isNew: true });
  expect(parseTerminalArgs('--new ~/code')).toEqual({
    isNew: true,
    path: '~/code',
  });
  expect(parseTerminalArgs('packages/ui -n')).toEqual({
    isNew: true,
    path: 'packages/ui',
  });
  expect(parseTerminalArgs('-x')).toEqual({ isNew: false, unknown: '-x' });
});

test('resolves a worktree name, an absolute path, ~ and a relative path', () => {
  const at = { cwd: MAIN, home: '/Users/me', linked };
  expect(resolvePath('home-screen', at)).toBe(HOME_SCREEN);
  expect(resolvePath('/tmp/x/', at)).toBe('/tmp/x');
  expect(resolvePath('~', at)).toBe('/Users/me');
  expect(resolvePath('~/code', at)).toBe('/Users/me/code');
  expect(resolvePath('packages/../docs', at)).toBe(`${MAIN}/docs`);
});

test('brings forward the newest tab started in the directory', () => {
  const tabs = [tab('0', MAIN), tab('1', HOME_SCREEN), tab('2', `${HOME_SCREEN}/`)];
  expect(tabFor(tabs, HOME_SCREEN)?.tab_id).toBe('2');
});

test('counts a tab started inside the worktree, but not inside another worktree', () => {
  const tabs = [tab('0', `${HOME_SCREEN}/packages/ui`), tab('1', `${MAIN}/.claude/worktrees/e2e`)];
  expect(tabFor(tabs, HOME_SCREEN)?.tab_id).toBe('0');
  // The main checkout holds the worktrees, but their tabs are theirs, not the main checkout's.
  expect(
    tabFor(
      tabs,
      MAIN,
      linked.map((t) => t.path),
    ),
  ).toBeUndefined();
});

test('reads the tab list, and nothing from text that is not one', () => {
  const text = JSON.stringify([{ tab_id: '0', title: null, cwd: MAIN, opened_by: 'user' }]);
  expect(parseTabs(text)).toEqual([
    { tab_id: '0', title: null, cwd: MAIN, opened_by: 'user' } as TerminalTab,
  ]);
  expect(parseTabs('not json')).toEqual([]);
  expect(parseTabs(undefined)).toEqual([]);
});
