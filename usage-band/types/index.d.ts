/** One rate-limit window as the last API response reported it. */
export type Window = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string
  /** 0 to 100, at most one decimal. */
  percentUsed: number
  /** ISO 8601; absent when the API gave none. */
  resetsAt?: string
}

/** The status line's figures, as the engine last measured them. */
export type Usage = {
  /** Input tokens the last response was answered over: what the next request re-sends. */
  contextTokens: number | null
  /** The model's context window, in tokens. */
  window: number
  /** `contextTokens` over `window`, 0 to 100. */
  percent: number | null
  windows: Window[]
  /** What the session has cost so far, in US dollars; null where the host keeps no ledger. */
  costUsd: number | null
}

/** When the main thread last talked to the API, in `$.clock.now()` milliseconds. */
export type CacheMark = {
  /** Start of the last main-thread request; the prompt cache's timer runs from it. Null before the first, or after a model switch. */
  requestAt: number | null
  /** End of the last main-thread response; the idle timer runs from it. */
  responseAt: number | null
  /** The model the main loop runs, as the engine names it. */
  model: string | null
}

export type CacheTtl = '5m' | '1h'

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      usage: Usage | null
      mark: CacheMark | null
      isExpanded: boolean
      ttl: CacheTtl
    }
  }
}
