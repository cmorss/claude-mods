import { expect, test } from 'claude-code/testing';
import type { SessionMessage } from 'claude-code';
import { chooseWorktree } from './register';
import { parseWorktreeList } from './worktree';

const MAIN = '/repo';
const PORCELAIN = [
  `worktree ${MAIN}`,
  'HEAD 9cd2c47',
  'branch refs/heads/main',
  '',
  `worktree ${MAIN}/.claude/worktrees/e2e-tart-vm`,
  'HEAD b341e96',
  '',
  `worktree ${MAIN}/.claude/worktrees/home-screen`,
  'HEAD 9cd2c47',
  '',
].join('\n');
const { main, linked } = parseWorktreeList(PORCELAIN);

const bash = (command: string, text = ''): SessionMessage => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool_use_id: command, tool: 'Bash', input: { command }, text }],
});
const say = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] });

const choose = (messages: SessionMessage[], extra: { arg?: string; cwdTop?: string } = {}) =>
  chooseWorktree({ arg: extra.arg ?? '', cwdTop: extra.cwdTop ?? MAIN, main, linked, messages });

test('reads the linked worktrees and their names', () => {
  expect(main).toBe(MAIN);
  expect(linked.map((t) => t.name)).toEqual(['e2e-tart-vm', 'home-screen']);
});

test('opens a worktree named after the command', () => {
  expect(choose([], { arg: 'e2e-tart-vm' }).path).toBe(`${MAIN}/.claude/worktrees/e2e-tart-vm`);
});

test('opens the worktree the session runs in', () => {
  const own = `${MAIN}/.claude/worktrees/e2e-tart-vm`;
  expect(
    choose([bash('git worktree add -b home-screen .claude/worktrees/home-screen main')], {
      cwdTop: own,
    }).path,
  ).toBe(own);
});

test('prefers the worktree this conversation created, even if another is mentioned later', () => {
  const messages = [
    bash('git worktree add -b home-screen .claude/worktrees/home-screen main'),
    say(`The other one, ${MAIN}/.claude/worktrees/e2e-tart-vm, is unrelated.`),
  ];
  expect(choose(messages).path).toBe(`${MAIN}/.claude/worktrees/home-screen`);
});

test('falls back to the newest worktree the conversation worked in, ignoring worktree listings', () => {
  const messages = [
    bash(`cd ${MAIN}/.claude/worktrees/home-screen && pnpm test`),
    bash(
      'git worktree list',
      `${MAIN}\n${MAIN}/.claude/worktrees/e2e-tart-vm\n${MAIN}/.claude/worktrees/home-screen`,
    ),
  ];
  expect(choose(messages).path).toBe(`${MAIN}/.claude/worktrees/home-screen`);
});

test('does not take a worktree whose name only starts another one', () => {
  const short = parseWorktreeList(`worktree ${MAIN}\n\nworktree ${MAIN}/.claude/worktrees/home\n`);
  const messages = [say(`Edited ${MAIN}/.claude/worktrees/home-screen/README.md`)];
  const choice = chooseWorktree({ arg: '', cwdTop: MAIN, ...short, messages });
  // Only one worktree exists, so it is still offered, but as the only one, not as mentioned.
  expect(choice.text).toContain('only worktree');
});

test('lists the choices when nothing points at one', () => {
  const choice = choose([say('Nothing about worktrees here.')]);
  expect(choice.path).toBeUndefined();
  expect(choice.text).toContain('/worktree-files home-screen');
});
