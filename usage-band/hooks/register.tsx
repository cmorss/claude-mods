import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, SessionUsage } from 'claude-code'

import type { CacheMark, CacheTtl, Usage } from '../types'
import {
  BADGE_HEIGHT,
  BADGE_INK,
  BAR,
  FAMILIES,
  GLYPH_INK,
  PRICES,
  TTL_MS,
  YOU_INK,
  badgeSvg,
  barDots,
  cacheTimeline,
  duration,
  gridSvg,
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

    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
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
        <Box key={`win-${w.kind}`} flexDirection="row" gap="xs" alignItems="center" flexShrink={0}>
          <Text weight="semibold" dimColor>
            {windowLabel(w.kind)}
          </Text>
          <Text color={color} size="caption">
            {DOT.repeat(n)}
          </Text>
          <Text dimColor size="caption">
            {GAP_DOT.repeat(DOTS - n)}
          </Text>
          <Text color={color} weight="semibold" tabular>
            {left}% left
          </Text>
          {reset ? <Text dimColor>· {reset}</Text> : null}
        </Box>
      )
    })

    const heatLabel = isWorking ? 'BUSY' : heat === 'warm' ? 'WARM' : heat === 'cold' ? 'COLD' : 'NO CACHE'
    const heatColor = heat === 'warm' ? 'success' : heat === 'cold' ? 'ide' : 'subtle'
    // The terminal draws the badge as an inverse run; a graphical surface as a rounded pill.
    const badge =
      e.surface !== 'terminal' && 'Svg' in table ? (
        <table.Svg source={badgeSvg(heatLabel, BADGE_INK[heat])} alt={heatLabel} height={BADGE_HEIGHT} />
      ) : (
        <Text inverse color={heatColor} weight="semibold">
          {' '}
          {heatLabel}{' '}
        </Text>
      )
    const runningMs = m?.requestAt !== null && m?.requestAt !== undefined ? now - m.requestAt : null
    const idleText = isWorking
      ? runningMs === null
        ? 'now'
        : duration(runningMs)
      : idleMs === null
        ? '—'
        : duration(idleMs)

    const toggleButton = (
      <Button key="toggle" label={expanded ? 'Hide' : 'Show'} onPress={() => void toggle()} />
    )

    if (!expanded) {
      // The button keeps its place at the right end: the figures wrap, it never does.
      return wrap(
        <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
          <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="nowrap" flexGrow={1} flexShrink={1} overflow="hidden">
            <Text weight="bold">USAGE</Text>
            {windows.length > 0 ? windows : <Text dimColor>no usage windows yet</Text>}
            <Box flexDirection="row" gap="xs" alignItems="center" flexShrink={0}>
              {badge}
              <Text weight="semibold" tabular>
                {idleText}
              </Text>
              {yourCost !== null ? <Text dimColor>· {money(yourCost)}</Text> : null}
            </Box>
          </Box>
          <Box flexShrink={0}>{toggleButton}</Box>
        </Box>
      )
    }

    // Expanded: the header with the windows, then three columns: the cache, the re-cache, the costs.
    const ttlMs = TTL_MS[cacheTtl]
    const sinceRequest = m?.requestAt ? now - m.requestAt : null
    const line = cacheTimeline(isWorking ? 0 : sinceRequest, ttlMs, BAR)
    const timelineLeft = `warm ${cacheTtl}`
    const timelineRight = isWorking
      ? 'busy'
      : heat === 'warm' && sinceRequest !== null
        ? `cold in ${duration(ttlMs - sinceRequest)}`
        : heat === 'cold' && sinceRequest !== null
          ? `cold for ${duration(sinceRequest - ttlMs)}`
          : 'no request yet'

    const fillShare = u?.percent !== null && u?.percent !== undefined ? u.percent / 100 : 0
    const fillDots = filled(fillShare, BAR)
    const windowText = u ? `${u.percent ?? 0}% of the ${fmtTokens(u.window)} context` : 'context not measured yet'

    const isGraphical = e.surface !== 'terminal' && 'Svg' in table
    const youPill = isGraphical ? (
      <table.Svg source={badgeSvg('YOU', YOU_INK)} alt="YOU" height={BADGE_HEIGHT} />
    ) : (
      <Text inverse color="ide" weight="semibold">
        {' '}
        YOU{' '}
      </Text>
    )

    const priced = FAMILIES.map((f) => {
      const isYou = f === family
      const cost = contextTokens > 0 ? nextMessageCost(f, contextTokens, cacheTtl, isYou && heat === 'warm') : null
      return { f, isYou, cost }
    })
    const dearest = Math.max(0, ...priced.map((x) => x.cost ?? 0))
    const costs = priced.map(({ f, isYou, cost }) => {
      const lit = barDots(cost, dearest)
      const glyph = isGraphical ? (
        <table.Svg
          source={gridSvg(lit, isYou ? GLYPH_INK.you : GLYPH_INK.other)}
          alt={`${PRICES[f].label}, ${lit} of 15 against the dearest`}
          height={30}
        />
      ) : null
      return (
        <Box key={`cost-${f}`} flexDirection="row" gap="xs" alignItems="flex-end">
          {glyph}
          <Box flexDirection="column" alignItems="flex-start">
            {isYou ? youPill : <Text size="caption"> </Text>}
            <Text weight={isYou ? 'bold' : 'semibold'} size="heading" color={isYou ? 'text' : 'subtle'} tabular>
              {cost === null ? '—' : money(cost)}
            </Text>
            <Text size="caption" dimColor>
              {PRICES[f].label}
              {isYou && heat === 'warm' ? ' · read' : ''}
            </Text>
          </Box>
        </Box>
      )
    })

    const caption = (text: string) => (
      <Text size="caption" dimColor weight="semibold">
        {text}
      </Text>
    )

    return wrap(
      <Box flexDirection="column" gap="md">
        <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
          <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="nowrap" flexGrow={1} flexShrink={1} overflow="hidden">
            <Text weight="bold">USAGE</Text>
            {windows.length > 0 ? windows : <Text dimColor>no usage windows yet</Text>}
          </Box>
          <Box flexShrink={0}>{toggleButton}</Box>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" gap="xl" alignItems="flex-start">
          <Box flexDirection="column" gap="xs">
            <Box flexDirection="row" gap="xs" alignItems="center">
              {badge}
              {caption(isWorking ? 'RUNNING' : 'IDLE')}
            </Box>
            <Text size="title" weight="bold" tabular>
              {idleText}
            </Text>
            <Box flexDirection="row" alignItems="center">
              <Text color="warning" size="caption">
                {DOT.repeat(line.warm)}
              </Text>
              <Text dimColor size="caption">
                {GAP_DOT.repeat(line.left + Math.max(0, line.cold - 1))}
              </Text>
              {line.cold > 0 ? (
                <Text color="ide" size="caption">
                  {DOT}
                </Text>
              ) : null}
            </Box>
            <Box flexDirection="row" justifyContent="space-between" gap="md">
              <Text size="caption" color="warning">
                {timelineLeft}
              </Text>
              <Text size="caption" color={heat === 'cold' ? 'ide' : 'subtle'}>
                {timelineRight}
              </Text>
            </Box>
          </Box>

          <Box flexDirection="column" gap="xs">
            {caption('RE-CACHE')}
            <Box flexDirection="row" gap="xs" alignItems="flex-end">
              <Text size="title" weight="bold" tabular>
                {contextTokens > 0 ? fmtTokens(contextTokens) : '—'}
              </Text>
              <Text dimColor>tokens</Text>
            </Box>
            <Box flexDirection="row" alignItems="center">
              <Text color="ide" size="caption">
                {DOT.repeat(fillDots)}
              </Text>
              <Text dimColor size="caption">
                {GAP_DOT.repeat(BAR - fillDots)}
              </Text>
            </Box>
            <Text size="caption" dimColor>
              {windowText}
            </Text>
          </Box>

          <Box flexDirection="column" gap="xs">
            {caption(
              `NEXT MESSAGE COSTS${heat === 'warm' && family ? ' · yours at the cache-read rate' : ` · ${cacheTtl} cache write`}` +
                (u?.costUsd !== null && u?.costUsd !== undefined ? ` · session so far ${money(u.costUsd)}` : ''),
            )}
            <Box flexDirection="row" gap="lg" alignItems="flex-end" flexWrap="wrap">
              {costs}
            </Box>
          </Box>
        </Box>
      </Box>
    )
  })
}
