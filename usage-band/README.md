# usage-band

A band above the prompt that shows where your Claude usage stands, in the terminal and in the Claude desktop app.

Compact, one row:

```
USAGE  7D ●●●●●·····  45% left · 3d 10h   5H ●●●●●●●●●· 89% left · resetting   [COLD] 11h 32m · next $4.78   [Show]
```

Expanded, after **Show**:

- **The windows**: the 5-hour and 7-day rate-limit windows (and a gateway's spend limit) as the last API response reported them, with how much is left and when each resets, plus what this session has cost so far.
- **The cache**: whether the prompt cache is warm or cold, how long the session has been idle, and how long the cache holds or how long ago it went cold. The timer runs from the start of the last main-thread request, as the API's does.
- **Re-cache**: the context the next message re-sends (the last response's input tokens) and its share of the model's window.
- **Next message costs**: what re-sending that context costs on Fable, Opus, Sonnet and Haiku. Your model is marked **YOU**. While the cache is warm, your model is priced at its cache-read rate; cold, every model is priced at the cache-write rate for the session's TTL (a switch forfeits the cache, so the other models always show the write cost).

The figures come from the engine (`$.session.usage()` and `session.measure`), so they match the status line and `/cost`. Prices are list prices for the current generation and live in `hooks/format.ts`.

## Options

- **Cache TTL** (`cacheTtl`): `1h` or `5m`, used when neither the `promptCacheTtl` setting nor a model switch says which. Default `1h`, the TTL of a Claude subscription.
- **Redraw every** (`tickSeconds`): how often the idle timer redraws. Default 30.

The Show/Hide choice is remembered across sessions.

## Running it

From this folder, in every session: add it to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, or start one session with `claude --plugin-dir <this folder>`.

```bash
claude plugin validate .
claude plugin test .
```
