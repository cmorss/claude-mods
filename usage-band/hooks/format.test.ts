import { expect, test } from 'claude-code/testing'

import { BADGE_INK, badgeSvg, duration, familyOf, filled, leftColor, money, nextMessageCost, percentLeft, resetText, tokens, warmth } from './format'

test('durations read like the status line', async () => {
  expect(duration(0)).toBe('<1m')
  expect(duration(42 * 60_000)).toBe('42m')
  expect(duration((11 * 60 + 31) * 60_000)).toBe('11h 31m')
  expect(duration((3 * 24 + 10) * 3_600_000 + 5 * 60_000)).toBe('3d 10h')
  expect(duration(2 * 24 * 3_600_000)).toBe('2d')
})

test('tokens and money are short', async () => {
  expect(tokens(597_210)).toBe('597k')
  expect(tokens(1_000_000)).toBe('1M')
  expect(tokens(1_250_000)).toBe('1.3M')
  expect(tokens(820)).toBe('820')
  expect(money(4.776)).toBe('$4.78')
  expect(money(0.001)).toBe('<$0.01')
  expect(money(123.4)).toBe('$123')
})

test('the next message is priced per family, write when cold and read when warm', async () => {
  expect(Math.round(nextMessageCost('opus', 597_000, '1h', false) * 1e3) / 1e3).toBe(4.776)
  expect(Math.round(nextMessageCost('opus', 597_000, '5m', false) * 1e3) / 1e3).toBe(2.985)
  expect(Math.round(nextMessageCost('opus', 597_000, '1h', true) * 1e4) / 1e4).toBe(0.1194)
  expect(Math.round(nextMessageCost('fable', 597_000, '1h', false) * 1e2) / 1e2).toBe(11.94)
  expect(Math.round(nextMessageCost('fable', 597_000, '1h', true) * 1e5) / 1e5).toBe(0.14925)
})

test('a model name maps to its family', async () => {
  expect(familyOf('claude-fable-5-1')).toBe('fable')
  expect(familyOf('opus[1m]')).toBe('opus')
  expect(familyOf('Sonnet 5.5')).toBe('sonnet')
  expect(familyOf('claude-haiku-5-5')).toBe('haiku')
  expect(familyOf('gpt-x')).toBe(null)
  expect(familyOf(null)).toBe(null)
})

test('a window says what is left, in colour and in words', async () => {
  expect(percentLeft({ kind: 'seven_day', percentUsed: 55 })).toBe(45)
  expect(leftColor(45)).toBe('warning')
  expect(leftColor(89)).toBe('success')
  expect(leftColor(10)).toBe('error')
  expect(filled(0.45)).toBe(5)
  expect(filled(0.89)).toBe(9)
  const now = Date.UTC(2026, 9, 22, 12, 0, 0)
  expect(resetText({ kind: 'five_hour', percentUsed: 1, resetsAt: new Date(now + 30_000).toISOString() }, now)).toBe('resetting')
  expect(resetText({ kind: 'seven_day', percentUsed: 1, resetsAt: new Date(now + 82 * 3_600_000).toISOString() }, now)).toBe('3d 10h')
  expect(resetText({ kind: 'seven_day', percentUsed: 1 }, now)).toBe(null)
})

test('warmth follows the TTL from the request start', async () => {
  const at = 1_000_000
  expect(warmth(null, '1h', at)).toBe('unknown')
  expect(warmth(at, '1h', at + 59 * 60_000)).toBe('warm')
  expect(warmth(at, '1h', at + 61 * 60_000)).toBe('cold')
  expect(warmth(at, '5m', at + 6 * 60_000)).toBe('cold')
})

test('the badge is a rounded pill with its label', async () => {
  const svg = badgeSvg('COLD', BADGE_INK.cold)
  expect(svg.startsWith('<svg ')).toBe(true)
  expect(svg.includes('rx="9"')).toBe(true)
  expect(svg.includes('>COLD<')).toBe(true)
  expect(badgeSvg('A<B', BADGE_INK.warm).includes('A&lt;B')).toBe(true)
})
