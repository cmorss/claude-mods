#!/bin/bash
# worktree-autosync, adapted for Suffra on macOS from
# https://github.com/mwfoutch/claude-worktree-autosync (MIT).
#
# Runs from post-commit and post-merge in every worktree of this repo. After a
# commit on a branch other than the target (local `main`):
#   - if the target is an ancestor of the branch, fast-forward the target to the
#     branch (`git fetch . branch:main`: ff-only, never touches a working tree);
#   - if the branch is already contained in the target, do nothing;
#   - otherwise the two have diverged: predict the conflicts with a read-only
#     `git merge-tree` and record them, changing nothing.
# Every outcome that matters is one JSON line in
# <git-common-dir>/worktree-sync/events.jsonl, which the merge-status mod reads.
#
# If the target is checked out in a worktree, that worktree is fast-forwarded instead.
#
# Differences from upstream: no flock (not on macOS; a mkdir lock instead), the
# target is a branch that need not be checked out anywhere, and nothing is ever
# committed to a working tree (upstream commits a status file onto the main
# checkout; here the log lives inside .git).
#
# Config (env, all optional):
#   WORKTREE_AUTOSYNC_TARGET        branch to forward into (default: main)
#   WORKTREE_AUTOSYNC_LOCK_TIMEOUT  seconds to wait for the lock (default: 30)

set -uo pipefail

TARGET="${WORKTREE_AUTOSYNC_TARGET:-main}"
LOCK_TIMEOUT="${WORKTREE_AUTOSYNC_LOCK_TIMEOUT:-30}"

BRANCH="$(git symbolic-ref --short -q HEAD)" || exit 0
[ "$BRANCH" = "$TARGET" ] && exit 0
git rev-parse --verify -q "refs/heads/$TARGET" >/dev/null || exit 0
[ -e "$(git rev-parse --git-dir)/rebase-merge" ] && exit 0
[ -e "$(git rev-parse --git-dir)/rebase-apply" ] && exit 0

COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
DIR="$COMMON/worktree-sync"
EVENTS="$DIR/events.jsonl"
LOCK="$DIR/lock.d"
WORKTREE="$(git rev-parse --show-toplevel)"
mkdir -p "$DIR"

json() { printf '%s' "$1" | LC_ALL=C tr -d '\000-\010\013-\037' | LC_ALL=C sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | tr -d '\n'; }

# JSON array of strings from stdin, one string per line.
json_array() {
  local first=1 line
  printf '['
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    [ $first -eq 1 ] || printf ','
    first=0
    printf '"%s"' "$(json "$line")"
  done
  printf ']'
}

emit() { # kind, from, to, commits(json), conflicts(json), ahead, behind, detail
  printf '{"ts":%s,"kind":"%s","branch":"%s","worktree":"%s","head":"%s","from":"%s","to":"%s","commits":%s,"conflicts":%s,"ahead":%s,"behind":%s,"detail":"%s"}\n' \
    "$(date +%s)" "$1" "$(json "$BRANCH")" "$(json "$WORKTREE")" "$(git rev-parse --short HEAD)" \
    "$2" "$3" "$4" "$5" "$6" "$7" "$(json "$8")" >> "$EVENTS"
}

# mkdir is atomic; a lock whose owner is gone is stale.
acquired=0
waited=0
while [ "$waited" -lt $((LOCK_TIMEOUT * 5)) ]; do
  if mkdir "$LOCK" 2>/dev/null; then
    echo $$ > "$LOCK/pid"
    acquired=1
    break
  fi
  owner="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
    rm -rf "$LOCK"
    continue
  fi
  sleep 0.2
  waited=$((waited + 1))
done
if [ "$acquired" -ne 1 ]; then
  emit blocked "" "" '[]' '[]' 0 0 "could not take the lock in ${LOCK_TIMEOUT}s; skipped this commit"
  exit 0
fi
trap 'rm -rf "$LOCK"' EXIT

OLD="$(git rev-parse --short "refs/heads/$TARGET")"

# Branch already contained in the target: nothing to report.
if git merge-base --is-ancestor HEAD "refs/heads/$TARGET"; then
  exit 0
fi

if git merge-base --is-ancestor "refs/heads/$TARGET" HEAD; then
  COMMITS="$(git log --format='%h %s' "refs/heads/$TARGET..HEAD" | head -8 | json_array)"
  COUNT="$(git rev-list --count "refs/heads/$TARGET..HEAD")"
  # git will not move a branch that is checked out somewhere with `fetch`; there, fast-forward
  # that checkout instead (git refuses if it has local changes the merge would overwrite).
  TARGET_WT="$(git worktree list --porcelain | awk -v b="refs/heads/$TARGET" '/^worktree /{p=substr($0,10)} $0=="branch " b {print p}')"
  if [ -n "$TARGET_WT" ]; then
    ERR="$(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_PREFIX git -C "$TARGET_WT" merge --ff-only --quiet "$BRANCH" 2>&1)"
  else
    ERR="$(git fetch --quiet . "$BRANCH:$TARGET" 2>&1)"
  fi
  if [ $? -eq 0 ]; then
    emit forwarded "$OLD" "$(git rev-parse --short "refs/heads/$TARGET")" "$COMMITS" '[]' "$COUNT" 0 "fast-forwarded $TARGET by $COUNT commit(s)"
  else
    # Usually: the target is checked out in a worktree, which git will not move.
    emit blocked "$OLD" "" "$COMMITS" '[]' "$COUNT" 0 "could not fast-forward $TARGET: $ERR"
  fi
  exit 0
fi

# Diverged. merge-tree prints a tree id, then the conflicted paths.
read -r AHEAD BEHIND <<EOF
$(git rev-list --left-right --count "HEAD...refs/heads/$TARGET")
EOF
MERGE_OUT="$(git merge-tree --write-tree --name-only --no-messages "refs/heads/$TARGET" HEAD 2>/dev/null)"
if [ $? -eq 0 ]; then
  emit diverged "$OLD" "" '[]' '[]' "$AHEAD" "$BEHIND" "diverged from $TARGET but merges cleanly: merge $TARGET into this branch, then it forwards"
else
  FILES="$(printf '%s\n' "$MERGE_OUT" | sed 1d)"
  emit diverged "$OLD" "" '[]' "$(printf '%s\n' "$FILES" | json_array)" "$AHEAD" "$BEHIND" "diverged from $TARGET with content conflicts: needs a manual merge"
fi
exit 0
