# Scrape benchmark (2026-06-11)

Workload: scan **30 ranking lists** for one player (fixture from Zachary Ebenfeld's career), **8 parallel sessions**, **150ms** polite delay before each postback per session.

| Runtime | Wall time | HTTP postbacks | Lists/sec | Hits | Est. full career scan* |
|---------|-----------|----------------|-----------|------|------------------------|
| Node (current) | 6421 ms | 80 | 4.67 | 30 | ~6.5 min |
| Go (prototype) | 4991 ms | 80 | 6.01 | 30 | ~5.1 min |

*Extrapolated: ~686 lists/player × avg 2.7 postbacks/list at these settings.

**Go is 1.29× faster** on this benchmark (22% less wall time).

## Why scraping feels slow

Scraping is **network-bound**, not CPU-bound. Each ranking list takes **2–4 HTTP postbacks** to TennisLink (open list → sort by name → filter by letter). The old defaults were:

- `REQUEST_DELAY_MS = 350` — artificial sleep **before every postback**
- `WORKERS = 3` — only three lists checked at once

For ~686 lists × ~3 postbacks × 350ms ≈ **12+ minutes** even if the server responds instantly.

## What Go changes

Go doesn't make TennisLink respond faster. It wins by:

1. **Cheaper goroutines** — 8–12 parallel sessions without Node's event-loop overhead
2. **HTTP keep-alive** — `Transport.MaxIdleConnsPerHost` reuses TLS connections
3. **Lower per-request overhead** — no V8 GC pauses between postbacks

## What we changed in Node (without switching runtimes)

Even keeping Node, the same ideas apply — see `server/constants.js` and `server/scraper.js`:

```javascript
// server/constants.js — now env-tunable
export const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 200);
export const SCRAPE_WORKERS = Number(process.env.SCRAPE_WORKERS ?? 8);
```

```javascript
// server/scraper.js — worker pool size from env
const WORKERS = SCRAPE_WORKERS;
await Promise.all(Array.from({ length: WORKERS }, worker));
```

Set `SCRAPER_ENGINE=go` to route list scanning through the Go binary (`server/go-bridge.js`).

## Recommendation

- **Short term:** tune Node with `REQUEST_DELAY_MS=150` and `SCRAPE_WORKERS=8` (~2–3× faster, still polite)
- **Medium term:** use Go for the scan phase only; keep Express + SQLite API in Node
- **Don't** drop the delay to zero — TennisLink will rate-limit or error

## Raw JSON

```json
{
  "node": {
    "runtime": "node",
    "hits": 30,
    "requests": 80,
    "elapsedMs": 6421,
    "workers": 8,
    "delayMs": 150,
    "lists": 30,
    "listsPerSec": 4.6721694440118355
  },
  "go": {
    "delayMs": 150,
    "elapsedMs": 4991,
    "hits": 30,
    "lists": 30,
    "listsPerSec": 6.0108194750551,
    "requests": 80,
    "runtime": "go",
    "workers": 8
  },
  "speedup": 1.29
}
```
