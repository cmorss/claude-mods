# worktree-files

A Claude Code mod that adds `/worktree-files`: open the [filetree](https://github.com/data-goblin/claude-code-filetree) pane on the git worktree the current conversation is working in.

Claude often works in a worktree under `.claude/worktrees/` while the session itself stays in the main checkout, so plain `/filetree` shows the wrong folder. This finds the right one.

## Use

```text
/worktree-files                 this conversation's worktree
/worktree-files home-screen     a worktree by its folder name
/worktree-files ~/code/other    any folder
```

With no argument it picks, in order:

1. the worktree the session runs in;
2. the newest worktree this conversation created or entered (`git worktree add`, EnterWorktree);
3. the newest worktree this conversation ran commands or edited files in;
4. the repository's only linked worktree.

When several worktrees exist and nothing points at one, it lists them as commands to type.

## Install

Claude Code 2.1.287 or newer, and the filetree mod. In a terminal:

```bash
claude plugin marketplace add cmorss/claude-mods
```

```bash
claude plugin install worktree-files@claude-mods
```

```bash
claude plugin marketplace add data-goblin/claude-code-filetree
```

```bash
claude plugin install filetree@claude-code-filetree
```

Then start a new session or type `/reload-plugins`. It is installed for you in every session and project. See the [repository README](../README.md) for more.

## Develop

`hooks/register.ts` is the command; `hooks/worktree.ts` decides which worktree is the conversation's (the same file is in the worktree-terminal mod: keep the two alike). Run the tests with `claude plugin test <this folder>` and check it with `claude plugin validate <this folder>`.
