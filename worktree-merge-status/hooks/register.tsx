import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type {
  WorktreeMergeStatusAttention as Attention,
  WorktreeMergeStatusEntry as Entry,
  WorktreeMergeStatusRow as Row,
} from '../types'

// What the hooks that worktree-autosync installs write, one line per outcome,
// to <git-common-dir>/worktree-sync/events.jsonl.
type SyncEvent = {
  ts: number
  kind: 'forwarded' | 'diverged' | 'blocked'
  branch: string
  worktree: string
  from: string
  to: string
  commits: string[]
  conflicts: string[]
  ahead: number
  behind: number
  detail: string
}

const SESSION_ID = /^local_[0-9a-f-]+$/
const PANE = 'merge-status'
const TARGET = 'main'
const EVERY_MS = 8000
const KEEP = 40
const SEED = 8
const RECENT = 3

const status = atom({ plugin: 'worktree-merge-status', key: 'status' } as const, {
  checkedAt: 0,
  main: '',
  mainSubject: '',
  seenEvents: 0,
  feed: [],
  attention: [],
  rows: [],
  error: '',
})

const lines = (text: string) => text.split('\n').filter(line => line !== '')
const subjectOf = (commit: string) => commit.slice(commit.indexOf(' ') + 1)
const sameSha = (a: string, b: string) => a !== '' && b !== '' && (a.startsWith(b) || b.startsWith(a))
const folder = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const two = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  try {
    const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: 15000 })
    return { ok: ran.exitCode === 0, out: ran.stdout.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

const parseEvents = (text: string): SyncEvent[] => {
  const events: SyncEvent[] = []
  for (const line of lines(text)) {
    try {
      events.push(JSON.parse(line) as SyncEvent)
    } catch {
      // a half-written line; the next poll reads it whole
    }
  }
  return events
}

const entryOf = (event: SyncEvent): Entry => ({
  at: event.ts * 1000,
  kind: event.kind === 'forwarded' ? 'merged' : event.kind,
  branch: event.branch,
  to: event.to,
  subjects: event.commits.map(subjectOf),
  files: event.conflicts,
  detail: event.detail,
  sessionId: '',
  sessionTitle: '',
})

const toastOf = (entry: Entry) => {
  if (entry.kind === 'merged') {
    return `main ← ${entry.branch}: ${entry.subjects.length} commit${entry.subjects.length === 1 ? '' : 's'}`
  }
  if (entry.kind === 'blocked') return `${entry.branch}: could not update main`
  if (entry.files.length > 0) {
    return `${entry.branch} conflicts with main: ${entry.files.slice(0, 3).join(', ')}`
  }
  return `${entry.branch} diverged from main (merges cleanly)`
}

type SessionRecord = { id: string; title: string; worktree: string; branch: string; isArchived: boolean; lastActivityAt: number }
type SessionIndex = { find: (worktree: string, branch: string) => { id: string; title: string } | undefined }

// The Claude app keeps one small JSON file per session; read again only when its mtime moves.
const sessionFiles = new Map<string, { mtimeMs: number; record: SessionRecord | undefined }>()

const sessionIndex = async ($: EngineInterface, worktrees: string[], cwd: string): Promise<SessionIndex> => {
  const none: SessionIndex = { find: () => undefined }
  const home = await $.env.get('HOME')
  if (home === undefined || cwd === '') return none
  const root = `${home}/Library/Application Support/Claude/claude-code-sessions`
  const records: SessionRecord[] = []
  try {
    for (const account of await $.fs.list(root)) {
      for (const org of account.kind === 'dir' ? await $.fs.list(`${root}/${account.name}`) : []) {
        if (org.kind !== 'dir') continue
        const dir = `${root}/${account.name}/${org.name}`
        for (const file of await $.fs.list(dir)) {
          if (!file.name.startsWith('local_') || !file.name.endsWith('.json')) continue
          const path = `${dir}/${file.name}`
          let held = sessionFiles.get(path)
          if (held === undefined || held.mtimeMs !== file.mtimeMs) {
            let record: SessionRecord | undefined
            try {
              const raw = JSON.parse((await $.fs.read(path)) as string)
              record = {
                id: String(raw.sessionId ?? ''),
                title: String(raw.title ?? ''),
                worktree: String(raw.worktreePath ?? raw.cwd ?? ''),
                branch: String(raw.branch ?? ''),
                isArchived: raw.isArchived === true,
                lastActivityAt: Number(raw.lastActivityAt ?? 0),
              }
            } catch {
              record = undefined
            }
            held = { mtimeMs: file.mtimeMs, record }
            sessionFiles.set(path, held)
          }
          if (held.record !== undefined && held.record.id !== '') records.push(held.record)
        }
      }
    }
  } catch {
    return none
  }
  const newest = (list: SessionRecord[]) =>
    [...list].sort((a, b) => Number(a.isArchived) - Number(b.isArchived) || b.lastActivityAt - a.lastActivityAt)[0]
  const primary = new Set(worktrees.filter(path => !path.includes('/.claude/worktrees/')))

  return {
    find: (worktree, branch) => {
      // A worktree made for a session belongs to it; several sessions share the primary
      // checkout, so there the branch the session recorded is the only tie.
      const byPath = worktree !== '' && !primary.has(worktree) ? newest(records.filter(r => r.worktree === worktree)) : undefined
      const found = byPath ?? (branch !== '' ? newest(records.filter(r => r.branch === branch)) : undefined)
      return found === undefined ? undefined : { id: found.id, title: found.title }
    },
  }
}

const check = async ($: EngineInterface, cwd: string) => {
  const common = (await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).out
  if (common === '') {
    await update($, status, s => ({ ...s, error: 'Not inside a git repository.' }))
    return
  }
  const tip = await git($, cwd, ['rev-parse', '--short', `refs/heads/${TARGET}`])
  if (!tip.ok) {
    await update($, status, s => ({ ...s, error: `No local ${TARGET} branch.` }))
    return
  }
  const subject = (await git($, cwd, ['log', '-1', '--format=%s', `refs/heads/${TARGET}`])).out
  const events = parseEvents(
    ((await $.fs.read(`${common}/worktree-sync/events.jsonl`).catch(() => '')) as string),
  )

  const listing = (await git($, cwd, ['worktree', 'list', '--porcelain'])).out
  const trees: { path: string; branch: string }[] = []
  for (const block of listing.split('\n\n')) {
    let path = ''
    let branch = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
      else if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length)
    }
    if (path !== '' && branch !== '' && branch !== TARGET) trees.push({ path, branch })
  }

  const sessions = await sessionIndex($, trees.map(tree => tree.path), cwd)

  const inspected = await Promise.all(
    trees.map(async tree => {
      const gitDir = (await git($, tree.path, ['rev-parse', '--path-format=absolute', '--git-dir'])).out
      const isMerging = gitDir !== '' && (await $.fs.exists(`${gitDir}/MERGE_HEAD`).catch(() => false))
      const unmerged = isMerging
        ? lines((await git($, tree.path, ['diff', '--name-only', '--diff-filter=U'])).out)
        : []
      const counts = await git($, tree.path, [
        'rev-list', '--left-right', '--count', `refs/heads/${TARGET}...refs/heads/${tree.branch}`,
      ])
      const [behind = 0, ahead = 0] = counts.out.split(/\s+/).map(Number)
      let predicted: string[] = []
      let added = 0
      let removed = 0
      if (ahead > 0) {
        const stat = (await git($, tree.path, ['diff', '--shortstat', `refs/heads/${TARGET}...refs/heads/${tree.branch}`])).out
        added = Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0)
        removed = Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0)
      }
      if (ahead > 0 && behind > 0) {
        const merged = await git($, tree.path, [
          'merge-tree', '--write-tree', '--name-only', '--no-messages', `refs/heads/${TARGET}`, `refs/heads/${tree.branch}`,
        ])
        predicted = merged.ok ? [] : lines(merged.out).slice(1)
      }
      const state: Row['state'] =
        unmerged.length > 0 ? 'conflicted' : ahead === 0 ? 'in-main' : behind === 0 ? 'ahead' : 'diverged'
      const found = sessions.find(tree.path, tree.branch)
      const row: Row = {
        branch: tree.branch, worktree: tree.path, ahead, behind, state, added, removed,
        sessionId: found?.id ?? '', sessionTitle: found?.title ?? '',
      }
      const items: Attention[] = []
      if (unmerged.length > 0) {
        items.push({ key: `conflict:${tree.path}`, kind: 'conflict', branch: tree.branch, worktree: tree.path, files: unmerged, detail: '', sessionId: row.sessionId, sessionTitle: row.sessionTitle })
      } else if (state === 'diverged') {
        items.push({
          key: `${predicted.length > 0 ? 'predicted' : 'behind'}:${tree.path}`,
          kind: predicted.length > 0 ? 'predicted' : 'behind',
          branch: tree.branch,
          worktree: tree.path,
          files: predicted,
          detail: '',
          sessionId: row.sessionId,
          sessionTitle: row.sessionTitle,
        })
      }
      if (state === 'ahead') {
        // Its commits are not in main and main has not moved: the hook could not forward them.
        const why = events.findLast(event => event.kind === 'blocked' && event.branch === tree.branch)
        items.push({
          key: `blocked:${tree.path}`,
          kind: 'blocked',
          branch: tree.branch,
          worktree: tree.path,
          files: [],
          detail: why === undefined ? `${ahead} commit${ahead === 1 ? '' : 's'} not in ${TARGET} yet` : why.detail.slice(0, 160),
          sessionId: row.sessionId,
          sessionTitle: row.sessionTitle,
        })
      }
      return { row, items }
    }),
  )
  const rows = inspected.map(one => one.row)
  const attention = inspected.flatMap(one => one.items)

  const before = await read($, status)
  const isFirst = before.checkedAt === 0
  const fresh = isFirst ? [] : events.slice(events.length >= before.seenEvents ? before.seenEvents : 0)
  const news: Entry[] = isFirst
    ? events.filter(event => event.kind === 'forwarded').slice(-SEED).map(entryOf)
    : fresh.map(entryOf)

  const now = await $.clock.now()
  const moved = !isFirst && before.main !== '' && !sameSha(before.main, tip.out)
  if (moved && !fresh.some(event => event.kind === 'forwarded' && sameSha(event.to, tip.out))) {
    const log = await git($, cwd, ['log', '--format=%s', '-8', `${before.main}..refs/heads/${TARGET}`])
    news.push({
      at: now,
      kind: 'merged',
      branch: '',
      to: tip.out,
      subjects: lines(log.out),
      files: [],
      detail: `${TARGET} moved to ${tip.out}`,
      sessionId: '',
      sessionTitle: '',
    })
  }

  const worktreeOf = new Map(events.map(event => [event.branch, event.worktree]))
  for (const entry of news) {
    const found = sessions.find(worktreeOf.get(entry.branch) ?? '', entry.branch)
    if (found) Object.assign(entry, { sessionId: found.id, sessionTitle: found.title })
  }

  const known = new Set(before.attention.map(item => item.key))
  const newConflicts = isFirst
    ? []
    : attention.filter(item => item.kind === 'conflict' && !known.has(item.key))

  await update($, status, () => ({
    checkedAt: now,
    main: tip.out,
    mainSubject: subject,
    seenEvents: events.length,
    feed: [...[...news].reverse(), ...before.feed].filter(entry => entry.kind === 'merged').slice(0, KEEP),
    attention,
    rows,
    error: '',
  }))

  const toasts = [
    ...news.map(toastOf),
    ...newConflicts.map(item => `Merge conflict in ${folder(item.worktree)}: ${item.files.length} file${item.files.length === 1 ? '' : 's'}`),
  ]
  if (!isFirst && toasts.length > 0) {
    for (const text of toasts.slice(0, 3)) $.ui.toast(text)
    if (toasts.length > 3) $.ui.toast(`and ${toasts.length - 3} more`)
    await $.ui.open({ id: PANE, title: 'Merge status' })
  }
}

// One check at a time: a caller that comes while one runs waits for that one.
let running: Promise<void> | undefined

const poll = ($: EngineInterface, cwd: string) => {
  running ??= check($, cwd)
    .catch(error => update($, status, s => ({ ...s, error: String(error) })).then(() => undefined))
    .finally(() => {
      running = undefined
    })

  return running
}

const STATE_TEXT: Record<Row['state'], string> = {
  'in-main': 'in main',
  ahead: 'ahead',
  diverged: 'diverged',
  conflicted: 'conflict',
}

export const register: Register = on => {
  let cwd = ''

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({
      name: 'merge-status',
      description: 'Show what has merged into local main and which worktrees conflict',
    })
    void poll($, cwd)
    $.clock.every(EVERY_MS, () => void poll($, cwd))

    return next(e)
  })

  on('command.run', { command: 'merge-status' }, async $ => {
    await poll($, cwd)
    await $.ui.open({ id: PANE, title: 'Merge status' })

    return { text: 'Merge status pane opened.' }
  })

  // A commit or merge the session just ran should show up now, not at the next tick.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    void $.clock.after(1500, () => void poll($, cwd))

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // The desktop draws only https links, so a press asks macOS to open the app's own
    // claude:// address, as the app's session list does.
    const open = (id: string, scope: string) =>
      !SESSION_ID.test(id) ? null : (
        <Button
          key={`open-${scope}-${id}`}
          plain
          dimColor
          label="↗ session"
          onPress={() => {
            void $.process.run(['open', `claude://claude.ai/epitaxy/${id}`]).catch(() => {
              $.ui.toast('Could not open the session')
            })
          }}
        />
      )
    const s = await read($, status)
    const live = s.rows.filter(row => row.state !== 'in-main')
    const settled = s.rows.length - live.length
    const recent = s.feed.filter(entry => entry.kind === 'merged').slice(0, RECENT)

    // The look of the app's own Changes panel: a rounded card per section, a glyph, a title
    // line with the action at its right, and a dim line under it.
    const item = (key: string, glyph: string, color: string, title: string, sub: RenderChildren, right: RenderChildren) => (
      <Box key={key} flexDirection="row" gap={1} marginTop={1}>
        <Text color={color}>{glyph}</Text>
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text wrap="truncate-end">{title}</Text>
            {right}
          </Box>
          {sub}
        </Box>
      </Box>
    )
    const card = (title: string, rows: RenderChildren) => (
      <Box borderStyle="round" flexDirection="column" paddingX={1} marginBottom={1}>
        <Text bold>
          {title} <Text dimColor>⌄</Text>
        </Text>
        {rows}
      </Box>
    )
    const counts = (row: Row) => (
      <Box flexDirection="row" gap={1}>
        <Text dimColor wrap="truncate-end">{row.branch}</Text>
        {row.added > 0 && <Text color="green">+{row.added}</Text>}
        {row.removed > 0 && <Text color="red">−{row.removed}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {s.error !== '' && <Text color="red">{s.error}</Text>}

        {card(
          `Local ${TARGET}`,
          item(
            'main',
            '⑂',
            'magenta',
            s.mainSubject === '' ? TARGET : s.mainSubject,
            <Text dimColor>{TARGET} · {s.main}</Text>,
            null,
          ),
        )}

        {s.attention.length > 0 &&
          card(
            'Needs attention',
            s.attention.map(a => {
              const row = s.rows.find(r => r.worktree === a.worktree)
              const kind =
                a.kind === 'conflict' ? 'merge conflict' : a.kind === 'predicted' ? 'would conflict' : a.kind === 'blocked' ? 'not in main' : 'needs main merged in'
              return item(
                `attention-${a.key}`,
                a.kind === 'behind' ? '!' : '✕',
                a.kind === 'behind' ? 'yellow' : 'red',
                a.sessionTitle === '' ? a.branch : a.sessionTitle,
                <Box flexDirection="column">
                  <Box flexDirection="row" justifyContent="space-between" gap={1}>
                    <Text dimColor wrap="truncate-end">{a.branch}</Text>
                    <Text color={a.kind === 'behind' ? 'yellow' : 'red'}>● {kind}</Text>
                  </Box>
                  {a.detail !== '' && <Text dimColor wrap="truncate-end">{a.detail}</Text>}
                  {a.files.slice(0, 3).map(file => (
                    <Text dimColor wrap="truncate-end">{file}</Text>
                  ))}
                  {a.files.length > 3 && <Text dimColor>and {a.files.length - 3} more</Text>}
                  {row !== undefined && counts(row)}
                </Box>,
                open(a.sessionId, `attention-${a.key}`),
              )
            }),
          )}

        {card(
          'Worktrees',
          <Box flexDirection="column">
            {live.map(row =>
              item(
                `row-${row.branch}`,
                '⑂',
                'magenta',
                row.sessionTitle === '' ? row.branch : row.sessionTitle,
                <Box flexDirection="row" justifyContent="space-between" gap={1}>
                  {counts(row)}
                  <Text dimColor>● {STATE_TEXT[row.state]} ↑{row.ahead} ↓{row.behind}</Text>
                </Box>,
                open(row.sessionId, `row-${row.branch}`),
              ),
            )}
            <Box marginTop={1}>
              <Text dimColor>{settled} worktree{settled === 1 ? '' : 's'} fully in {TARGET}</Text>
            </Box>
          </Box>,
        )}

        {card(
          `Last into ${TARGET}`,
          <Box flexDirection="column">
            {recent.length === 0 && <Text dimColor>Nothing yet.</Text>}
            {recent.map(entry =>
              item(
                `feed-${entry.at}-${entry.branch}`,
                '↑',
                'green',
                entry.subjects[0] ?? entry.detail,
                <Text dimColor wrap="truncate-end">
                  {entry.branch === '' ? TARGET : entry.branch} · {clock(entry.at)}
                  {entry.subjects.length > 1 ? ` · +${entry.subjects.length - 1} more` : ''}
                </Text>,
                open(entry.sessionId, `feed-${entry.at}-${entry.branch}`),
              ),
            )}
          </Box>,
        )}
      </Box>
    )
  })
}
