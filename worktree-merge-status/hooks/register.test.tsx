import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'worktree-merge-status',
  component: 'Pane',
  requestId: 'merge-status',
  props: {
    title: 'Merge status',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const PORCELAIN = [
  'worktree /repo',
  'HEAD 1111111',
  'branch refs/heads/scratch',
  '',
  'worktree /repo/.claude/worktrees/wt-b',
  'HEAD 2222222',
  'branch refs/heads/B',
].join('\n')

const EVENT = {
  ts: 1793035918,
  kind: 'forwarded',
  branch: 'A',
  worktree: '/repo/.claude/worktrees/wt-a',
  from: 'aaaaaaa',
  to: 'bbbbbbb',
  commits: ['bbbbbbb Site: the privacy page'],
  conflicts: [],
  ahead: 1,
  behind: 0,
  detail: 'fast-forwarded main by 1 commit(s)',
}

test('a forward opens the pane, a conflicting branch is listed', async ($, on) => {
  let events = ''
  let tip = 'aaaaaaa'
  const toasts: string[] = []
  const opened: string[] = []

  on('command.register', () => ({ value: { command: 'merge-status' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1793035920000 }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.list', (_, e) => {
    const root = '/home/me/Library/Application Support/Claude/claude-code-sessions'
    const entry = (name: string, kind: 'dir' | 'file') => ({ name, kind, size: 0, mtimeMs: 1, isLink: false })
    if (e.path === root) return { value: [entry('acct', 'dir')] }
    if (e.path === `${root}/acct`) return { value: [entry('org', 'dir')] }
    return { value: [entry('local_a1b2.json', 'file')] }
  })
  on('fs.read', (_, e) =>
    e.path.endsWith('local_a1b2.json')
      ? {
          value: JSON.stringify({
            sessionId: 'local_a1b2',
            title: 'Fix B',
            worktreePath: '/repo/.claude/worktrees/wt-b',
            branch: 'old-name',
          }),
        }
      : { value: events },
  )
  on('fs.exists', () => ({ value: false }))
  const ran: (readonly string[])[] = []
  on('process.run', (_, e) => {
    ran.push(e.argv.slice(0, 2))
    const args = e.argv.slice(1).join(' ')
    const ok = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (args.includes('--git-common-dir')) return ok('/repo/.git')
    if (args.includes('--git-dir')) return ok('/repo/.git/worktrees/x')
    if (args.startsWith('rev-parse --short')) return ok(tip)
    if (args.startsWith('log -1')) return ok('Site: the privacy page')
    if (args.startsWith('worktree list')) return ok(PORCELAIN)
    if (args.startsWith('rev-list') && args.endsWith('refs/heads/B')) return ok('3\t2')
    if (args.startsWith('rev-list')) return ok('0\t0')
    if (args.startsWith('merge-tree')) return ok('0123abc\nsrc/app.ts', 1)
    return ok('')
  })

  const runCommand = () =>
    $.command.run({ command: 'merge-status' } as Parameters<typeof $.command.run>[0])

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await runCommand()

  // The first look seeds the pane quietly; the command is what opened it.
  expect(toasts).toEqual([])

  events = JSON.stringify(EVENT) + '\n'
  tip = 'bbbbbbb'
  opened.length = 0
  await runCommand()
  expect(toasts[0]).toBe('main ← A: 1 commit')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /would conflict/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /src\/app\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Site: the privacy page$/ })).toBeDefined()
  const button = await ui.find({ type: 'Button', text: /session/ })
  expect(button).toBeDefined()
  await ui.press({ key: button?.key ?? '' })
  expect(opened.at(-1)).toBeDefined()
  expect(ran).toContainEqual(['open', 'claude://claude.ai/epitaxy/local_a1b2'])
  await ui.unmount()
})
