import { expect, mock, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const USAGE: SessionUsage = {
  startedAt: 0,
  context: { tokens: 597_000, window: 1_000_000, percent: 60 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: 55, resetsAt: new Date(NOW + 82 * 3_600_000).toISOString() },
    { kind: 'five_hour', percentUsed: 11, resetsAt: new Date(NOW + 30_000).toISOString() },
  ],
  cost: { usd: 12.5 },
}

test('the band shows the windows, the cache state and the next cost, compact and expanded', async ($, on) => {
  // Nothing sits beneath the mod: these hooks stand for the engine.
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /45% left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3d 10h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /89% left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resetting/ })).toBeDefined()
    // No request yet: the cost is the 1-hour cache write on Opus, 597k × $8/MTok.
    expect(await ui.find({ type: 'Text', text: /NO CACHE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$4\.78/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /RE-CACHE/ })).toBeUndefined()
    await ui.unmount()
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /RE-CACHE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /597k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /60% of the 1M context/ })).toBeDefined()
    // Every family is priced: Fable at $20/MTok, Haiku at $0.20/MTok.
    expect(await ui.find({ type: 'Text', text: /\$11\.94/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$0\.12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /session \$12\.50/ })).toBeDefined()
    // Pressing again folds it, so the next surface starts compact.
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /RE-CACHE/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the Show choice is kept in the store across sessions', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { isExpanded: true })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /RE-CACHE/ })).toBeDefined()
  expect(await ui.find({ key: 'toggle' })).toBeDefined()
  await ui.unmount()
})

test('a measurement from the engine moves the figures', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({
    ...USAGE,
    context: { tokens: 1_200_000, window: 1_000_000, percent: 100 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 90 }],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /10% left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /45% left/ })).toBeUndefined()
  // Sonnet, cold, 1.2M tokens at $4/MTok.
  expect(await ui.find({ type: 'Text', text: /\$4\.80/ })).toBeDefined()
  await ui.unmount()
})

test('the band is drawn above a survey, not instead of it', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, hasSurvey: true } })
    expect((await ui.find({ type: 'Text', text: /survey/ }))?.text).toBe('survey')
    expect(await ui.find({ type: 'Text', text: /USAGE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /45% left/ })).toBeDefined()
    await ui.unmount()
  }
})
