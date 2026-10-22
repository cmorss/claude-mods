import type { CacheTtl, Window } from '../types'

export const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

/** A model family the band prices, with its list price in US dollars per million input tokens. */
export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku'

/**
 * List prices as of 2026-10 for the current generation: input per MTok and a cache read per
 * MTok. A cache write is the input price times 1.25 for the 5-minute TTL and 2 for the 1-hour TTL.
 */
export const PRICES: Record<Family, { label: string; input: number; read: number }> = {
  fable: { label: 'FABLE', input: 10, read: 0.25 },
  opus: { label: 'OPUS', input: 4, read: 0.2 },
  sonnet: { label: 'SONNET', input: 2, read: 0.2 },
  haiku: { label: 'HAIKU', input: 0.1, read: 0.01 },
}

export const FAMILIES: Family[] = ['fable', 'opus', 'sonnet', 'haiku']

/** Which family a model name belongs to, from an alias (`opus`), an id (`claude-opus-5-5`) or a label. */
export function familyOf(model: string | null | undefined): Family | null {
  const name = (model ?? '').toLowerCase()
  if (name.includes('fable') || name.includes('mythos')) return 'fable'
  if (name.includes('opus')) return 'opus'
  if (name.includes('sonnet')) return 'sonnet'
  if (name.includes('haiku')) return 'haiku'
  return null
}

/** What re-sending `tokens` of context costs on a family, in dollars: a cache write when cold, a read when warm. */
export function nextMessageCost(family: Family, tokens: number, ttl: CacheTtl, isWarm: boolean): number {
  const price = PRICES[family]
  const perMillion = isWarm ? price.read : price.input * (ttl === '1h' ? 2 : 1.25)
  return (tokens / 1_000_000) * perMillion
}

export function money(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`
  if (usd >= 0.005 || usd === 0) return `$${usd.toFixed(2)}`
  return '<$0.01'
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/** `3d 10h`, `11h 31m`, `42m`, `<1m`. */
export function duration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`
  return `${mins}m`
}

export const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5H',
  seven_day: '7D',
  spend_limit: 'SPEND',
}

export function windowLabel(kind: string): string {
  return WINDOW_LABELS[kind] ?? kind.replace(/_/g, ' ').toUpperCase()
}

/** Percent of a window still unused, 0 to 100. */
export function percentLeft(window: Window): number {
  return Math.max(0, Math.min(100, Math.round(100 - window.percentUsed)))
}

/** When a window resets, said relative to `now`: `resetting` once it is due. */
export function resetText(window: Window, now: number): string | null {
  if (!window.resetsAt) return null
  const at = Date.parse(window.resetsAt)
  if (Number.isNaN(at)) return null
  return at - now < 60_000 ? 'resetting' : duration(at - now)
}

/** A theme colour for how much of a window is left: the text beside it says the number. */
export function leftColor(left: number): 'success' | 'warning' | 'error' {
  if (left >= 50) return 'success'
  if (left >= 20) return 'warning'
  return 'error'
}

/** How many of `of` dots to fill for a share from 0 to 1. */
export function filled(share: number, of = 10): number {
  return Math.max(0, Math.min(of, Math.round(share * of)))
}

export type Warmth = 'warm' | 'cold' | 'unknown'

export function warmth(requestAt: number | null, ttl: CacheTtl, now: number): Warmth {
  if (requestAt === null) return 'unknown'
  return now - requestAt < TTL_MS[ttl] ? 'warm' : 'cold'
}
