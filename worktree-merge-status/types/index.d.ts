export type WorktreeMergeStatusEntry = {
  at: number
  kind: 'merged' | 'diverged' | 'blocked'
  branch: string
  to: string
  subjects: string[]
  files: string[]
  detail: string
  sessionId: string
  sessionTitle: string
}

export type WorktreeMergeStatusAttention = {
  key: string
  kind: 'conflict' | 'predicted' | 'behind' | 'blocked'
  detail: string
  branch: string
  worktree: string
  files: string[]
  sessionId: string
  sessionTitle: string
}

export type WorktreeMergeStatusRow = {
  branch: string
  worktree: string
  ahead: number
  behind: number
  state: 'in-main' | 'ahead' | 'diverged' | 'conflicted'
  added: number
  removed: number
  sessionId: string
  sessionTitle: string
}

export type WorktreeMergeStatusValue = {
  checkedAt: number
  main: string
  mainSubject: string
  seenEvents: number
  feed: WorktreeMergeStatusEntry[]
  attention: WorktreeMergeStatusAttention[]
  rows: WorktreeMergeStatusRow[]
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'worktree-merge-status': { status: WorktreeMergeStatusValue }
  }
}
