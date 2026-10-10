import type { EngineInterface, Register } from 'claude-code';
import { parseTabs, parseTerminalArgs, resolvePath, tabFor } from './terminal';
import { baseName, conversationWorktree, parseWorktreeList } from './worktree';

const COMMAND = 'terminal';
const USAGE = '/terminal [-n|--new] [path]';
const PLUGIN = 'worktree-terminal';

/**
 * The tool calls /terminal makes (read the tab list, switch to a tab, open one) are approved by
 * this mod itself: the person asked for them by typing the command. Auto mode's classifier judges
 * an action against the request behind it, and a command a mod runs has none, so without this it
 * gives no verdict and the call is refused. Only this mod's own calls: the same tools called by
 * the model or another plugin are decided as they always are.
 */
const ALLOW = {
  decision: 'allow',
  reason: 'Asked for with /terminal.',
} as const;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: "Show this conversation's worktree terminal, or open one (-n: a new one)",
        argumentHint: '[-n|--new] [path]',
      });
    } catch (error) {
      $.ui.toast(`worktree-terminal: /${COMMAND} could not be registered: ${message(error)}`);
    }
    return next(e);
  });

  on('tool.check', { tool: 'mcp__terminal__list_terminal_tabs' }, async ($, e, next) =>
    next.origin.plugin === PLUGIN ? ALLOW : next(e),
  );
  on('tool.check', { tool: 'mcp__ccd_view__show_pane' }, async ($, e, next) =>
    next.origin.plugin === PLUGIN ? ALLOW : next(e),
  );
  on('tool.check', { tool: 'mcp__terminal__open_terminal_tab' }, async ($, e, next) =>
    next.origin.plugin === PLUGIN ? ALLOW : next(e),
  );

  on('command.run', { command: COMMAND }, async ($, e) => {
    try {
      return await openTerminal($, e.args);
    } catch (error) {
      return { text: `Couldn't open a terminal: ${message(error)}` };
    }
  });
};

/**
 * Bring forward the Terminal-panel tab already open in the directory, or open one there. The
 * directory is the typed path, else this conversation's worktree, else the repository (or the
 * session's directory outside one).
 */
async function openTerminal($: EngineInterface, args: string): Promise<{ text: string }> {
  const asked = parseTerminalArgs(args);
  if (asked.unknown) return { text: `Unknown option ${asked.unknown}. Use ${USAGE}.` };

  const cwd = await $.session.cwd();
  const git = (gitArgs: string[]) =>
    $.process.run(['git', '--no-optional-locks', '-C', cwd, ...gitArgs], {
      timeoutMs: 10_000,
    });
  const list = await git(['worktree', 'list', '--porcelain']);
  const { main, linked } =
    list.exitCode === 0 ? parseWorktreeList(list.stdout) : { main: undefined, linked: [] };

  let dir: string;
  let where: string;
  if (asked.path) {
    const home = (await $.process.run(['printenv', 'HOME'], { timeoutMs: 5_000 })).stdout.trim();
    dir = resolvePath(asked.path, { cwd, home, linked });
    where = dir;
  } else {
    const top = list.exitCode === 0 ? await git(['rev-parse', '--show-toplevel']) : undefined;
    const cwdTop = top?.exitCode === 0 ? top.stdout.trim() : undefined;
    const found = conversationWorktree({
      cwdTop,
      main,
      linked,
      messages: await $.session.messages(),
    });
    dir = found?.tree.path ?? cwdTop ?? cwd;
    where = found ? `worktree ${found.tree.name} (${found.why})` : dir;
  }

  if (!asked.isNew) {
    const listed = await $.tool.call({
      tool: 'mcp__terminal__list_terminal_tabs',
    });
    if (listed.deny) return { text: `Couldn't read the terminal tabs: ${listed.deny}` };
    const tab = tabFor(
      parseTabs(listed.text),
      dir,
      linked.map((t) => t.path),
    );
    if (tab) {
      const shown = await $.tool.call({
        tool: 'mcp__ccd_view__show_pane',
        pane: 'terminal',
        tab_id: tab.tab_id,
      });
      if (shown.deny) return { text: `Couldn't show the terminal: ${shown.deny}` };
      if (shown.isError) return { text: `Couldn't show the terminal: ${shown.text ?? ''}` };
      return {
        text: `Terminal for ${where} brought forward. /terminal -n opens another.`,
      };
    }
  }

  const opened = await $.tool.call({
    tool: 'mcp__terminal__open_terminal_tab',
    cwd: dir,
    title: baseName(dir),
  });
  if (opened.deny) return { text: `Couldn't open a terminal: ${opened.deny}` };
  if (opened.isError) return { text: `Couldn't open a terminal: ${opened.text ?? ''}` };
  return { text: `New terminal in ${where}.` };
}
