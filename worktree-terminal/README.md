# worktree-terminal

A Claude Code mod that adds `/terminal`: a terminal in the Claude desktop app's Terminal panel, beside the conversation, in the git worktree the conversation is working in.

## Use

```text
/terminal              show the tab already open in this conversation's worktree, or open one
/terminal -n           open a new tab there, even if one is open   (also --new)
/terminal <path>       the same for another folder: a worktree's name, ~/..., absolute or relative
/terminal -n <path>    a new tab in that folder
```

A tab counts as "in" a folder when its shell started there or anywhere inside it; the newest such tab is brought forward. Tabs started inside another worktree belong to that worktree, so the main checkout's terminal is never one that started in `.claude/worktrees/...`.

With no path it uses this conversation's worktree, chosen in order:

1. the worktree the session runs in;
2. the newest worktree this conversation created or entered (`git worktree add`, EnterWorktree);
3. the newest worktree this conversation ran commands or edited files in;
4. the repository's only linked worktree;
5. otherwise the repository's own folder (or the session's directory outside a repository).

Typing `/terminal` is the request, so the mod approves its own three calls (list the tabs, switch to one, open one); without that, auto mode's classifier has no request to judge them against and refuses them. The same tools called by Claude or another plugin are decided as usual, and the desktop app may still ask you to approve a folder. It needs the desktop app's Terminal panel: in a plain terminal session `/terminal` says it could not reach it.

## Install

Claude Code 2.1.287 or newer, and the Claude desktop app (for its Terminal panel). In a terminal:

```bash
claude plugin marketplace add cmorss/claude-mods
```

```bash
claude plugin install worktree-terminal@claude-mods
```

Then start a new session or type `/reload-plugins`. It is installed for you in every session and project. See the [repository README](../README.md) for more.

## Develop

`hooks/register.ts` is the command; `hooks/terminal.ts` holds the argument, path and tab rules; `hooks/worktree.ts` decides which worktree is the conversation's (the same file is in the worktree-files mod: keep the two alike). Run the tests with `claude plugin test <this folder>` and check it with `claude plugin validate <this folder>`.
