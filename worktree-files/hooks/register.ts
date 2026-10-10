import type { EngineInterface, Register, SessionMessage } from 'claude-code';
import { conversationWorktree, parseWorktreeList, type Worktree } from './worktree';

const COMMAND = 'worktree-files';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface Choice {
  path?: string;
  /** What the command says in the transcript. */
  text: string;
}

/**
 * Which folder to show: the worktree named in `arg` (or the path typed), else this
 * conversation's worktree; when nothing points at one, the choices to type.
 */
export function chooseWorktree(input: {
  arg: string;
  cwdTop: string | undefined;
  main: string | undefined;
  linked: readonly Worktree[];
  messages: readonly SessionMessage[];
}): Choice {
  const { arg, linked } = input;
  if (arg) {
    const named = linked.find((t) => t.name === arg || t.path === arg);
    if (named) return { path: named.path, text: `Files of worktree ${named.name}.` };
    return { path: arg, text: `Files of ${arg}.` };
  }
  const found = conversationWorktree(input);
  if (found) {
    return { path: found.tree.path, text: `Files of worktree ${found.tree.name} (${found.why}).` };
  }
  if (linked.length === 0) return { text: 'This repository has no linked worktrees.' };
  return {
    text: `This conversation names no worktree. Pick one: ${linked
      .map((t) => `/${COMMAND} ${t.name}`)
      .join(', ')}`,
  };
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: "Open the file tree on this conversation's worktree",
        argumentHint: '[worktree name or path]',
      });
    } catch (error) {
      $.ui.toast(`worktree-files: /${COMMAND} could not be registered: ${message(error)}`);
    }
    return next(e);
  });

  on('command.run', { command: COMMAND }, async ($, e) => {
    try {
      return await openFiles($, e.args);
    } catch (error) {
      return { text: `Couldn't open the worktree's files: ${message(error)}` };
    }
  });
};

/** Find this conversation's worktree and open the filetree mod's pane on it. */
async function openFiles($: EngineInterface, args: string): Promise<{ text: string }> {
  const cwd = await $.session.cwd();
  const git = (gitArgs: string[]) =>
    $.process.run(['git', '--no-optional-locks', '-C', cwd, ...gitArgs], { timeoutMs: 10_000 });
  const list = await git(['worktree', 'list', '--porcelain']);
  if (list.exitCode !== 0) return { text: `${cwd} is not inside a git repository.` };
  const { main, linked } = parseWorktreeList(list.stdout);
  const top = await git(['rev-parse', '--show-toplevel']);
  const choice = chooseWorktree({
    arg: args.trim(),
    cwdTop: top.exitCode === 0 ? top.stdout.trim() : undefined,
    main,
    linked,
    messages: await $.session.messages(),
  });
  const path = choice.path;
  if (path) {
    // A command run from inside another command's hook waits for the session to be idle, so it
    // goes once this one has answered.
    $.clock.after(0, () => {
      $.command.run({ command: 'filetree', args: path }).catch((error: unknown) => {
        $.ui.toast(`Couldn't open filetree (is the filetree mod installed?): ${message(error)}`);
      });
    });
  }
  return { text: choice.text };
}
