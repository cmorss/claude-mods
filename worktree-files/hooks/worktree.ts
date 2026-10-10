import type { SessionMessage } from 'claude-code';

/**
 * Which git worktree belongs to this conversation. Pure: register.ts reads git and the transcript,
 * then asks here. The same file is in the worktree-files and worktree-terminal mods; keep the
 * two copies alike.
 */

/** One linked worktree of the repository. */
export interface Worktree {
  /** Absolute path. */
  path: string;
  /** Its folder's name (`home-screen`), what the person types after a command. */
  name: string;
}

/** The main working tree and the linked worktrees, from `git worktree list --porcelain`. */
export function parseWorktreeList(porcelain: string): {
  main: string | undefined;
  linked: Worktree[];
} {
  const paths = porcelain
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
  const [main, ...rest] = paths;
  return { main, linked: rest.map((path) => ({ path, name: baseName(path) })) };
}

export const baseName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where in `text` a worktree is last named, by its absolute or repo-relative path; -1 when not. */
function lastMention(text: string, tree: Worktree, main: string | undefined): number {
  const forms = [tree.path];
  if (main && tree.path.startsWith(`${main}/`)) forms.push(tree.path.slice(main.length + 1));
  let at = -1;
  for (const form of forms) {
    // Not followed by more of a name: `worktrees/home` must not match inside `worktrees/home-screen`.
    const re = new RegExp(`${escape(form)}(?![\\w.-])`, 'g');
    for (let m = re.exec(text); m; m = re.exec(text)) at = Math.max(at, m.index);
  }
  return at;
}

/** The worktree named last in the newest text that names one (texts newest first). */
export function newestNamed(
  texts: readonly string[],
  linked: readonly Worktree[],
  main: string | undefined,
): Worktree | undefined {
  for (const text of texts) {
    let best: { at: number; tree: Worktree } | undefined;
    for (const tree of linked) {
      const at = lastMention(text, tree, main);
      if (at >= 0 && (!best || at > best.at)) best = { at, tree };
    }
    if (best) return best.tree;
  }
  return undefined;
}

const commandOf = (input: Record<string, unknown>): string =>
  typeof input.command === 'string' ? input.command : '';

/**
 * What the conversation says about worktrees, newest first, in two tiers: `entered` holds what
 * created or entered one (EnterWorktree, `git worktree add`), `mentioned` everything else that
 * names paths. Output of `git worktree list` is left out: it names every worktree at once.
 */
export function worktreeTexts(messages: readonly SessionMessage[]): {
  entered: string[];
  mentioned: string[];
} {
  const entered: string[] = [];
  const mentioned: string[] = [];
  for (const message of messages) {
    if (message.text) mentioned.push(message.text);
    for (const use of message.toolUses) {
      const command = commandOf(use.input);
      if (use.tool === 'EnterWorktree') {
        entered.push(`${JSON.stringify(use.input)} ${use.text ?? ''}`);
      } else if (use.tool === 'Bash' && /\bworktree\s+add\b/.test(command)) {
        entered.push(command);
      }
      if (use.tool === 'Bash' && /\bworktree\s+(list|prune)\b/.test(command)) continue;
      mentioned.push(`${JSON.stringify(use.input)} ${use.text ?? ''}`);
    }
  }
  return { entered: entered.reverse(), mentioned: mentioned.reverse() };
}

export interface Found {
  tree: Worktree;
  /** Why this one, for the command's line in the transcript. */
  why: string;
}

/**
 * This conversation's worktree: the session's own, else the newest one the conversation created
 * or entered, else the newest one it worked in, else the repository's only one.
 */
export function conversationWorktree(input: {
  cwdTop: string | undefined;
  main: string | undefined;
  linked: readonly Worktree[];
  messages: readonly SessionMessage[];
}): Found | undefined {
  const { cwdTop, main, linked, messages } = input;
  const own = linked.find((t) => t.path === cwdTop);
  if (own) return { tree: own, why: 'the session runs in it' };
  const { entered, mentioned } = worktreeTexts(messages);
  const made = newestNamed(entered, linked, main);
  if (made) return { tree: made, why: 'created or entered in this conversation' };
  const used = newestNamed(mentioned, linked, main);
  if (used) return { tree: used, why: 'the newest one this conversation worked in' };
  if (linked.length === 1) return { tree: linked[0]!, why: "the repository's only worktree" };
  return undefined;
}
