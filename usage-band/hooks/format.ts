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

/** The badge's colours per cache state: a pale fill with dark ink reads on a light or a dark theme. */
export const BADGE_INK: Record<Warmth, { fill: string; ink: string }> = {
  warm: { fill: '#9fe0b4', ink: '#0d2d18' },
  cold: { fill: '#8fd6ea', ink: '#0a2a33' },
  unknown: { fill: '#c9ccd1', ink: '#23262b' },
}

export const BADGE_HEIGHT = 18

/** A rounded pill with the label in it, as the desktop draws it. */
export function badgeSvg(label: string, colours: { fill: string; ink: string }): string {
  const width = Math.round(14 + label.length * 7.4)
  const text = label.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BADGE_HEIGHT}" viewBox="0 0 ${width} ${BADGE_HEIGHT}">` +
    `<rect width="${width}" height="${BADGE_HEIGHT}" rx="${BADGE_HEIGHT / 2}" fill="${colours.fill}"/>` +
    `<text x="${width / 2}" y="12.5" text-anchor="middle" font-family="-apple-system, 'Inter Tight', 'Helvetica Neue', sans-serif" font-size="10.5" font-weight="700" letter-spacing="0.8" fill="${colours.ink}">${text}</text>` +
    `</svg>`
  )
}

/** Dots in an expanded bar. */
export const BAR = 28

/**
 * The cache timeline the expanded view draws, split into dots: while warm, how much of the
 * TTL has elapsed and what is left; once cold, the warm hour against the time since it ended.
 */
export function cacheTimeline(
  sinceRequest: number | null,
  ttlMs: number,
  of = BAR,
): { warm: number; left: number; cold: number } {
  if (sinceRequest === null) return { warm: 0, left: of, cold: 0 }
  if (sinceRequest < ttlMs) {
    const warm = Math.max(1, filled(sinceRequest / ttlMs, of))
    return { warm, left: of - warm, cold: 0 }
  }
  const warm = Math.max(1, Math.min(of - 1, Math.round((of * ttlMs) / sinceRequest)))
  return { warm, left: 0, cold: of - warm }
}

/** How many of a 3×5 grid's dots a cost lights against the dearest cost shown: all for the dearest, none for nothing. */
export function barDots(cost: number | null, max: number, of = 15): number {
  if (cost === null || cost <= 0 || max <= 0) return 0
  return Math.max(1, Math.min(of, Math.round((cost / max) * of)))
}

/** A 3×5 grid of dots filled from the bottom like a bar, `lit` of them in `ink`, the rest faint. */
export function gridSvg(lit: number, ink: string): string {
  const cols = 3
  const rows = 5
  const step = 6
  const r = 1.9
  const w = cols * step
  const h = rows * step
  let dots = ''
  let n = 0
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = 0; col < cols; col += 1) {
      n += 1
      const isLit = n <= lit
      dots += `<circle cx="${col * step + step / 2}" cy="${row * step + step / 2}" r="${r}" fill="${isLit ? ink : '#9aa0a6'}" opacity="${isLit ? 1 : 0.35}"/>`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${dots}</svg>`
}

export const LEFT_INK = { success: '#1f9a45', warning: '#d98a00', error: '#d6372b' }

/** A row of small dots, `lit` of `of` in `ink`, the rest faint: a window's bar, kept narrow. */
export function dotsSvg(lit: number, of: number, ink: string): string {
  const step = 6
  const r = 2.2
  const w = of * step
  let dots = ''
  for (let i = 0; i < of; i += 1) {
    const isLit = i < lit
    dots += `<circle cx="${i * step + step / 2}" cy="${step / 2}" r="${r}" fill="${isLit ? ink : '#9aa0a6'}" opacity="${isLit ? 1 : 0.35}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${step}" viewBox="0 0 ${w} ${step}">${dots}</svg>`
}

export const YOU_INK = { fill: '#8fd6ea', ink: '#0a2a33' }
export const GLYPH_INK = { you: '#3b9ddd', other: '#9aa0a6' }
