# claude-mods

Two [Claude Code](https://claude.com/claude-code) mods for working in git worktrees.

Claude often does its work in a git worktree (a second checkout of the same repository, for example under `.claude/worktrees/<name>`) while the session itself stays in the main checkout. These two slash commands find the worktree the current conversation is working in, so you can look at it without hunting for the folder.

| Command | Plugin | What it does |
| --- | --- | --- |
| `/terminal` | `worktree-terminal` | Shows the Terminal-panel tab already open in the conversation's worktree, or opens one there. `/terminal -n` always opens a new tab; `/terminal <path>` uses another folder. |
| `/worktree-files` | `worktree-files` | Opens the [filetree](https://github.com/data-goblin/claude-code-filetree) pane on the conversation's worktree. `/worktree-files <name or path>` opens another. |

Each plugin installs on its own: take one, the other, or both.

## Requirements

- Claude Code 2.1.287 or newer (mods need it). Check with `claude --version`.
- `/terminal` uses the Terminal panel of the Claude desktop app, so it works in the desktop app's Code sessions.
- `/worktree-files` needs the filetree mod (install steps below).

## Install

Run these in a terminal (macOS Terminal, iTerm, the desktop app's Terminal panel, any shell where the `claude` command works).

1. Add this repository as a plugin marketplace. You do this once; it lets Claude Code find the plugins in it.

   ```bash
   claude plugin marketplace add cmorss/claude-mods
   ```

2. Install the plugins you want:

   ```bash
   claude plugin install worktree-terminal@claude-mods
   ```

   ```bash
   claude plugin install worktree-files@claude-mods
   ```

3. For `/worktree-files`, also install the filetree mod if you don't have it:

   ```bash
   claude plugin marketplace add data-goblin/claude-code-filetree
   ```

   ```bash
   claude plugin install filetree@claude-code-filetree
   ```

4. Start a new Claude Code session, or type `/reload-plugins` in an open one. The commands then show up when you type `/`.

Plugins installed this way are installed for you (user scope): they load in every session, in every project, and after Claude Code restarts.

Inside a Claude Code terminal session you can do the same with `/plugin`, which walks you through adding the marketplace and installing.

## Use

```text
/terminal                 the terminal for this conversation's worktree (opens one if there is none)
/terminal -n              a new terminal there, even if one is open        (also --new)
/terminal <path>          the same for another folder: a worktree's name, ~/..., absolute or relative
/worktree-files           the file tree of this conversation's worktree
/worktree-files <name>    the file tree of another worktree, by its folder name, or any path
```

### Which worktree is "this conversation's"

Both commands pick, in order:

1. the worktree the session itself runs in;
2. the newest worktree the conversation created or entered (`git worktree add`, or Claude's EnterWorktree tool);
3. the newest worktree the conversation ran commands or edited files in;
4. the repository's only linked worktree, if it has just one.

When none of these applies, `/terminal` opens in the repository's own folder (or the session's folder outside a repository), and `/worktree-files` lists the worktrees as commands to pick from.

### Permissions

`/terminal` approves its own three tool calls (list the terminal tabs, switch to one, open one), because typing `/terminal` is the request for them. Without that, Claude Code's auto mode has no request to judge them against and refuses them. The same tools called by Claude or by any other plugin are decided exactly as before, and the desktop app may still ask you to approve a folder.

## Update and remove

```bash
claude plugin marketplace update claude-mods
```

```bash
claude plugin uninstall worktree-terminal@claude-mods
```

```bash
claude plugin uninstall worktree-files@claude-mods
```

`claude plugin list` shows what is installed.

## Develop

Each plugin is a folder: `.claude-plugin/plugin.json` names it, `hooks/register.ts` is the command, and `hooks/worktree.ts` decides which worktree is the conversation's. That file is the same in both plugins (they cannot import from each other); keep the copies alike.

To work on one against your own checkout, install from the folder instead of from GitHub:

```bash
claude plugin marketplace add /path/to/claude-mods
```

It is then read in place: edits apply at the next session or `/reload-plugins`. Check a plugin with `claude plugin validate <folder>` and run its tests with `claude plugin test <folder>`.
