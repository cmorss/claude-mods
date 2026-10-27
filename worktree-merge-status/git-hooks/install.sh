#!/bin/bash
# Installs the post-commit and post-merge hooks into the current repo's shared .git/hooks
# (every worktree of the repo runs them). Refuses to overwrite a hook that differs from ours.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="$(git rev-parse --path-format=absolute --git-common-dir)/hooks"
mkdir -p "$HOOKS"

for hook in post-commit post-merge worktree-autosync.sh; do
  if [ -e "$HOOKS/$hook" ] && ! cmp -s "$HERE/$hook" "$HOOKS/$hook"; then
    echo "Not overwriting $HOOKS/$hook: it differs from ours. Merge it by hand: diff $HERE/$hook $HOOKS/$hook"
    exit 1
  fi
done
for hook in post-commit post-merge worktree-autosync.sh; do
  cp "$HERE/$hook" "$HOOKS/$hook"
  chmod +x "$HOOKS/$hook"
done
echo "Installed into $HOOKS"
