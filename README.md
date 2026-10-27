# claude-mods

Four [Claude Code](https://claude.com/claude-code) mods for working in git worktrees and keeping an eye on usage.

Claude often does its work in a git worktree (a second checkout of the same repository, for example under `.claude/worktrees/<name>`) while the session itself stays in the main checkout. Three of these mods find the worktree the current conversation is working in, or the state of all of them, so you can look without hunting for the folder. The fourth is a band above the prompt that shows your usage.

| Plugin | Adds | What it does |
| --- | --- | --- |
| `worktree-terminal` | `/terminal` | Shows the Terminal-panel tab already open in the conversation's worktree, or opens one there. `/terminal -n` always opens a new tab; `/terminal <path>` uses another folder. |
| `worktree-files` | `/worktree-files` | Opens the [filetree](https://github.com/data-goblin/claude-code-filetree) pane on the conversation's worktree. `/worktree-files <name or path>` opens another. |
| `worktree-merge-status` | `/merge-status` | A pane with what has merged into local `main`, which worktrees are not in `main` yet, and which would conflict with it, each with a button that opens the Claude session working in that worktree. It opens by itself, with a toast, when `main` moves, a branch diverges, or a worktree is left mid-merge. |
| `usage-band` | a band above the prompt | Shows the 5-hour and 7-day usage windows, whether the prompt cache is warm or cold and for how long, the context the next message re-sends, and what that costs on each model. Expands from one row; shows the merge status indicator when `worktree-merge-status` is loaded. |

Each plugin installs on its own: take any of them.

## Requirements

- Claude Code 2.1.287 or newer (mods need it). Check with `claude --version`.
- `/terminal` and `/merge-status` use the Claude desktop app (the Terminal panel; session links), so they work in its Code sessions.
- `/worktree-files` needs the filetree mod (install steps below).
- `worktree-merge-status` reads git, so it needs a repository with a local `main`. Its optional git hooks (below) keep `main` up to date.
- `usage-band` works in the terminal and in the desktop app.

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

   ```bash
   claude plugin install worktree-merge-status@claude-mods
   ```

   ```bash
   claude plugin install usage-band@claude-mods
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
/merge-status             open or close the merge status pane
```

### Which worktree is "this conversation's"

`/terminal` and `/worktree-files` pick, in order:
### Which worktree is "this conversation's"

Both commands pick, in order:

1. the worktree the session itself runs in;
2. the newest worktree the conversation created or entered (`git worktree add`, or Claude's EnterWorktree tool);
3. the newest worktree the conversation ran commands or edited files in;
4. the repository's only linked worktree, if it has just one.

When none of these applies, `/terminal` opens in the repository's own folder (or the session's folder outside a repository), and `/worktree-files` lists the worktrees as commands to pick from.

### Merge status

`/merge-status` opens a pane for the repository the conversation works in. It lists:

- what has merged into local `main`;
- the worktrees whose branches are not in `main` yet, and which of them would conflict with it;
- a button on each that opens the Claude session working in that worktree.

It reads git directly, so it works in any repository with a local `main`. For the "merged" and "could not update main" events it also reads `.git/worktree-sync/events.jsonl`, which optional git hooks write. They are adapted from [claude-worktree-autosync](https://github.com/mwfoutch/claude-worktree-autosync) (MIT): after a commit on any branch but `main` they fast-forward `main` to it (never forcing, never resolving a conflict) and record the outcome. Install them into a repository from inside it:

```bash
/path/to/claude-mods/worktree-merge-status/git-hooks/install.sh
```

It refuses to overwrite a hook that already differs from ours.

### Usage band

A band above the prompt, one row until you press the chevron (**⌄**) to expand it; the choice is remembered. Compact:

```text
USAGE  7D ●●●●●·····  45% left · 3d 10h   5H ●●●●●●●●●· 89% left · resetting   [COLD] 11h 32m · next $4.78   [⌄]
```

Expanded, it adds the windows with what each has left and when it resets plus this session's cost; the cache's state and idle time; the context the next message re-sends and its share of the model's window; and what that costs on Fable, Opus, Sonnet and Haiku, with your model marked. The figures come from the engine, so they match the status line and `/cost`. Options: `cacheTtl` (`1h` or `5m`, default `1h`) and `tickSeconds` (how often the idle timer redraws, default 30). Details: [usage-band/README.md](usage-band/README.md).

With `worktree-merge-status` loaded too, the band shows `✅ Git`, `⚠️ Git` (branches waiting to merge) or `❌ Conflicts`; pressing it opens that mod's pane, and again closes it.

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

```bash
claude plugin uninstall worktree-merge-status@claude-mods
```

```bash
claude plugin uninstall usage-band@claude-mods
```

`claude plugin list` shows what is installed.

## Develop

Each plugin is a folder: `.claude-plugin/plugin.json` names it and `hooks/register.ts(x)` is the command or band. In `worktree-terminal` and `worktree-files`, `hooks/worktree.ts` decides which worktree is the conversation's; that file is the same in both (they cannot import from each other), so keep the copies alike.

To work on one against your own checkout, install from the folder instead of from GitHub:

```bash
claude plugin marketplace add /path/to/claude-mods
```

It is then read in place: edits apply at the next session or `/reload-plugins`. Check a plugin with `claude plugin validate <folder>` and run its tests with `claude plugin test <folder>`.

## License

[MIT](LICENSE).
