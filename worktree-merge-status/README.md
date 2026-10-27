# worktree-merge-status

`/merge-status` opens a pane for the git repo a conversation works in: what has merged into local
`main`, which worktrees are not in `main` yet, and which would conflict with it, each with a button
that opens the Claude session working in that worktree. The pane opens by itself, with a toast, when
`main` moves, a branch diverges, or a worktree is left mid-merge with conflicts.

The mod reads git directly, so the pane works in any repo with a local `main`. For the "merged" and
"could not update main" events it also reads `.git/worktree-sync/events.jsonl`, which the hooks in
`git-hooks/` write. They are adapted from
[claude-worktree-autosync](https://github.com/mwfoutch/claude-worktree-autosync) (MIT): after a
commit on any branch but `main`, they fast-forward `main` to it (never forcing, never resolving a
conflict), and record the outcome. Install them into a repo from inside it:

```bash
/path/to/claude-mods/worktree-merge-status/git-hooks/install.sh
```

With the [usage-band](../usage-band) mod loaded too, its band shows `✅ Git` or `❌ Conflicts` and
opens this pane when pressed.
