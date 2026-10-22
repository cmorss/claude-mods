import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, SessionUsage } from 'claude-code'

import type { CacheMark, CacheTtl, Usage } from '../types'
import {
  FAMILIES,
  PRICES,
  TTL_MS,
  duration,
  familyOf,
  filled,
  leftColor,
  money,
  nextMessageCost,
  percentLeft,
  resetText,
  tokens as fmtTokens,
  warmth,
  windowLabel,
} from './format'

const PLUGIN = 'usage-band'
const STORE_EXPANDED = 'isExpanded'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)
const mark = atom({ plugin: 'usage-band', key: 'mark' } as const, null)
const isExpanded = atom({ plugin: 'usage-band', key: 'isExpanded' } as const, false)
const ttl = atom({ plugin: 'usage-band', key: 'ttl' } as const, '1h')

const DOTS = 10
const DOT = '●'
const GAP_DOT = '·'

function toUsage(u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Usage {
  return {
    contextTokens: u.context.tokens ?? null,
    window: u.context.window,
    percent: u.context.percent ?? null,
    windows: u.rateLimits.map((w) => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt })),
    costUsd: u.cost?.usd ?? null,
  }
}

async function refreshUsage($: EngineInterface) {
  try {
    const u = await $.session.usage()
    await update($, usage, () => toUsage(u))
  } catch {
    // Off a subscription, or before the first response: nothing to show yet.
  }
}

async function setMark($: EngineInterface, patch: Partial<CacheMark>) {
  await update($, mark, (m) => ({ requestAt: null, responseAt: null, model: null, ...m, ...patch }))
}

function isTtl(value: unknown): value is CacheTtl {
  return value === '5m' || value === '1h'
}

export const register: Register = (on, options) => {
  const configuredTtl = isTtl(options?.cacheTtl) ? options.cacheTtl : '1h'
  const tickMs = Math.max(5, Number(options?.tickSeconds) || 30) * 1000

  on('session.start', async ($, e, next) => {
    // The TTL the engine runs under: a settings key, else the mod's own option.
    let resolved: CacheTtl = configuredTtl
    try {
      const fromSettings = await $.settings.read({ key: 'promptCacheTtl' })
      if (isTtl(fromSettings)) resolved = fromSettings
    } catch {
      // Settings unreadable here: keep the option.
    }
    await update($, ttl, () => resolved)

    try {
      const expanded = await $.store.get(STORE_EXPANDED)
      if (typeof expanded === 'boolean') await update($, isExpanded, () => expanded)
    } catch {
      // No store: the band starts compact.
    }

    try {
      await setMark($, { model: await $.session.model() })
    } catch {
      // No model yet.
    }
    await refreshUsage($)

    // The idle timer and the cache's warmth move on their own; redraw as they do.
    $.clock.every(tickMs, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e))
    return next(e)
  })

  // The prompt cache's timer runs from the start of each main-thread request.
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    if (isMain) await setMark($, { requestAt: await $.clock.now(), model: e.model })
    const result = yield* next(e)
    if (isMain) await setMark($, { responseAt: await $.clock.now() })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await setMark($, { responseAt: await $.clock.now() })
      await refreshUsage($)
    }
    return next(e)
  })

  // A switch forfeits the old model's cache: the new one is cold until its first request.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await setMark($, { requestAt: null, model: e.to_model })
    if (isTtl(e.cache_ttl)) await update($, ttl, () => e.cache_ttl)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey holds the band while one is up (the app's next-step box is one): the band is
    // drawn above it rather than giving way, so it stays while the person can type.
    const below = e.props.hasSurvey ? await next(e) : null

    const u = await read($, usage)
    const m = await read($, mark)
    const cacheTtl = await read($, ttl)
    const expanded = await read($, isExpanded)
    const now = await $.clock.now()
    const isWorking = e.props.isWorking

    const { Box, Text, Button } = $.ui.resolve(e)
    const wrap = (band: RenderElement): RenderElement =>
      below === null ? (
        band
      ) : (
        <Box flexDirection="column" gap="sm">
          {band}
          {below}
        </Box>
      )

    const toggle = async () => {
      const nextExpanded = !(await read($, isExpanded))
      await update($, isExpanded, () => nextExpanded)
      try {
        await $.store.set(STORE_EXPANDED, nextExpanded)
      } catch {
        // The preference lives for the session alone.
      }
    }

    const contextTokens = u?.contextTokens ?? 0
    const heat = isWorking ? 'warm' : warmth(m?.requestAt ?? null, cacheTtl, now)
    const family = familyOf(m?.model)
    const idleMs = m?.responseAt !== null && m?.responseAt !== undefined ? now - m.responseAt : null
    const yourCost =
      family && contextTokens > 0 ? nextMessageCost(family, contextTokens, cacheTtl, heat === 'warm') : null

    const windows = (u?.windows ?? []).map((w) => {
      const left = percentLeft(w)
      const color = leftColor(left)
      const n = filled(left / 100, DOTS)
      const reset = resetText(w, now)
      return (
        <Box key={`win-${w.kind}`} flexDirection="row" gap="xs" alignItems="center">
          <Text weight="semibold" dimColor>
            {windowLabel(w.kind)}
          </Text>
          <Text color={color}>{DOT.repeat(n)}</Text>
          <Text dimColor>{GAP_DOT.repeat(DOTS - n)}</Text>
          <Text color={color} weight="semibold" tabular>
            {left}% left
          </Text>
          {reset ? <Text dimColor>· {reset}</Text> : null}
        </Box>
      )
    })

    const heatLabel = isWorking ? 'WORKING' : heat === 'warm' ? 'WARM' : heat === 'cold' ? 'COLD' : 'NO CACHE'
    const heatColor = heat === 'warm' ? 'success' : heat === 'cold' ? 'ide' : 'subtle'
    const badge = (
      <Text inverse color={heatColor} weight="semibold">
        {' '}
        {heatLabel}{' '}
      </Text>
    )
    const idleText = isWorking ? 'now' : idleMs === null ? '—' : duration(idleMs)

    const toggleButton = (
      <Button key="toggle" label={expanded ? 'Hide' : 'Show'} onPress={() => void toggle()} />
    )

    if (!expanded) {
      // The button keeps its place at the right end: the figures wrap, it never does.
      return wrap(
        <Box flexDirection="row" gap="md" alignItems="flex-start" justifyContent="space-between">
          <Box flexDirection="row" gap="md" alignItems="center" flexWrap="wrap" flexGrow={1} flexShrink={1}>
            <Text weight="bold">USAGE</Text>
            {windows.length > 0 ? windows : <Text dimColor>no usage windows yet</Text>}
            <Box flexDirection="row" gap="xs" alignItems="center">
              {badge}
              <Text weight="semibold" tabular>
                {idleText}
              </Text>
              {yourCost !== null ? <Text dimColor>· next {money(yourCost)}</Text> : null}
            </Box>
          </Box>
          <Box flexShrink={0}>{toggleButton}</Box>
        </Box>
      )
    }

    // Expanded: a header with the windows, then three columns.
    const ttlMs = TTL_MS[cacheTtl]
    const sinceRequest = m?.requestAt ? now - m.requestAt : null
    const warmShare = sinceRequest === null ? 0 : Math.min(1, sinceRequest / ttlMs)
    const warmDots = heat === 'warm' ? filled(1 - warmShare, DOTS) : 0
    const warmLine = isWorking
      ? `a request is in flight; the ${cacheTtl} cache timer restarts with it`
      : heat === 'warm' && sinceRequest !== null
        ? `cache holds ${duration(ttlMs - sinceRequest)} more`
        : heat === 'cold' && sinceRequest !== null
          ? `went cold ${duration(sinceRequest - ttlMs)} ago`
          : 'no request yet this session'

    const fillShare = u?.percent !== null && u?.percent !== undefined ? u.percent / 100 : 0
    const fillDots = filled(fillShare, DOTS)
    const windowText = u ? `${u.percent ?? 0}% of the ${fmtTokens(u.window)} context` : 'context not measured yet'

    const costs = FAMILIES.map((f) => {
      const isYou = f === family
      const cost = contextTokens > 0 ? nextMessageCost(f, contextTokens, cacheTtl, isYou && heat === 'warm') : null
      return (
        <Box key={`cost-${f}`} flexDirection="column" alignItems="flex-start" minWidth={10}>
          <Text size="caption" color={isYou ? 'ide' : 'subtle'} weight="semibold" inverse={isYou}>
            {isYou ? ' YOU ' : ' '}
          </Text>
          <Text weight={isYou ? 'bold' : 'regular'} size={isYou ? 'heading' : 'body'} tabular>
            {cost === null ? '—' : money(cost)}
          </Text>
          <Text size="caption" dimColor>
            {PRICES[f].label}
            {isYou && heat === 'warm' ? ' · read' : ''}
          </Text>
        </Box>
      )
    })

    const narrow = e.props.bodyColumns < 96

    return wrap(
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" gap="md" alignItems="flex-start" justifyContent="space-between">
          <Box flexDirection="row" gap="md" alignItems="center" flexWrap="wrap" flexGrow={1} flexShrink={1}>
            <Text weight="bold">USAGE</Text>
            {windows.length > 0 ? windows : <Text dimColor>no usage windows yet</Text>}
            {u?.costUsd !== null && u?.costUsd !== undefined ? (
              <Text dimColor>session {money(u.costUsd)}</Text>
            ) : null}
          </Box>
          <Box flexShrink={0}>{toggleButton}</Box>
        </Box>

        <Box flexDirection={narrow ? 'column' : 'row'} gap="lg" alignItems="flex-start">
          <Box flexDirection="column" gap="xs" minWidth={28}>
            <Box flexDirection="row" gap="xs" alignItems="center">
              {badge}
              <Text size="caption" dimColor weight="semibold">
                {isWorking ? 'REQUEST' : 'IDLE'}
              </Text>
            </Box>
            <Text size="title" weight="bold" tabular>
              {idleText}
            </Text>
            <Box flexDirection="row" gap="xs" alignItems="center">
              <Text color="success">{DOT.repeat(warmDots)}</Text>
              <Text dimColor>{GAP_DOT.repeat(DOTS - warmDots)}</Text>
              <Text size="caption" dimColor>
                {warmLine}
              </Text>
            </Box>
          </Box>

          <Box flexDirection="column" gap="xs" minWidth={28}>
            <Text size="caption" dimColor weight="semibold">
              RE-CACHE
            </Text>
            <Box flexDirection="row" gap="xs" alignItems="flex-end">
              <Text size="title" weight="bold" tabular>
                {contextTokens > 0 ? fmtTokens(contextTokens) : '—'}
              </Text>
              <Text dimColor>tokens</Text>
            </Box>
            <Box flexDirection="row" gap="xs" alignItems="center">
              <Text color="ide">{DOT.repeat(fillDots)}</Text>
              <Text dimColor>{GAP_DOT.repeat(DOTS - fillDots)}</Text>
              <Text size="caption" dimColor>
                {windowText}
              </Text>
            </Box>
          </Box>

          <Box flexDirection="column" gap="xs">
            <Text size="caption" dimColor weight="semibold">
              NEXT MESSAGE COSTS {heat === 'warm' && family ? '(yours at the cache-read rate)' : `(${cacheTtl} cache write)`}
            </Text>
            <Box flexDirection="row" gap="md" alignItems="flex-start" flexWrap="wrap">
              {costs}
            </Box>
          </Box>
        </Box>
      </Box>
    )
  })
}
