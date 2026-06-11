# Scrape benchmark (2026-06-11)

Live benchmark against **USTA TennisLink** — 30 ranking lists from Zachary Ebenfeld's career fixture.

## Results (same workload: 30 lists, 8 workers, 150ms delay)

| Config | Wall time | Lists/sec | Hits | Est. full career (~686 lists)* |
|--------|-----------|-----------|------|--------------------------------|
| **Node (tuned)** — 8 workers, 150ms | **5.6 s** | 5.32 | 30/30 | **~5.6 min** |
| **Go scanner** — 8 workers, 150ms | **4.8 s** | 6.20 | 30/30 | **~4.9 min** |
| Node (legacy) — 3 workers, 350ms | ~14 s† | ~2.1 | 30/30 | **~12–15 min** |

\* Extrapolated from lists/sec × 686 lists.  
† Extrapolated from delay/worker math (legacy run hung on rate limits during full 30-list test; see below).

**Go is 1.17× faster than tuned Node** at identical settings. **Tuning Node workers/delay is ~2–3× faster than legacy** — bigger win than switching language alone.

---

## Why scraping feels slow

Scraping is **I/O-bound**, not CPU-bound. Each list needs **2–4 HTTP postbacks** (open → sort by name → filter by letter). The old code added:

```javascript
// server/usta.js — sleep BEFORE every postback
await sleep(getRequestDelayMs());

// server/scraper.js (before)
const WORKERS = 3;
```

With `REQUEST_DELAY_MS=350` and `WORKERS=3`, a full career (~686 lists × ~2.6 postbacks) spends most of its time **sleeping**, not waiting on TennisLink.

---

## What we changed

### 1. Tunable concurrency (biggest win, stays Node)

```javascript
// server/constants.js
export function getRequestDelayMs() {
  return Number(process.env.REQUEST_DELAY_MS ?? 200);
}
export function getScrapeWorkers() {
  return Number(process.env.SCRAPE_WORKERS ?? 8);
}
```

```javascript
// server/scraper.js
const WORKERS = getScrapeWorkers();
await Promise.all(Array.from({ length: WORKERS }, worker));
```

**Fly.io / `.env`:** `REQUEST_DELAY_MS=200` `SCRAPE_WORKERS=8`

### 2. Go list scanner (optional, `SCRAPER_ENGINE=go`)

Go doesn't make TennisLink respond faster. It helps via:

- **HTTP keep-alive** — `Transport.MaxIdleConnsPerHost = 16`
- **Cheap parallelism** — goroutines per session without event-loop contention
- **Lower per-request overhead** — no V8 GC between postbacks

```go
// scraper-go/usta/session.go
tr.MaxIdleConnsPerHost = 16
tr.IdleConnTimeout = 90 * time.Second
```

```go
// scraper-go/usta/ops.go — worker pool mirrors Node scraper
for w := 0; w < workers; w++ {
    go func() {
        s := NewSession(delayMs)
        s.Init()
        for listID := range jobs {
            FindPlayerInList(s, listID, lastName, token)
        }
    }()
}
```

Node invokes Go via stdin/stdout (`server/go-bridge.js` → `scraper-go/scan-bin`).

### 3. Recommendation

| Priority | Action | Impact |
|----------|--------|--------|
| 1 | Deploy with `REQUEST_DELAY_MS=200`, `SCRAPE_WORKERS=8` | ~2–3× faster scrapes, zero new deps |
| 2 | Set `SCRAPER_ENGINE=go` in production (binary in Docker) | +15–20% on scan phase |
| 3 | Don't drop delay to 0 | TennisLink rate-limits / errors |

---

## Reproduce

```bash
npm run bench          # Node + Go, writes this file
npm run bench:node     # Node only
npm run bench:go       # Go only
```

Requires network access to tennislink.usta.com.

## Raw JSON

```json
{
  "node": {
    "runtime": "node",
    "hits": 30,
    "requests": 78,
    "elapsedMs": 5637,
    "workers": 8,
    "delayMs": 150,
    "lists": 30,
    "listsPerSec": 5.32
  },
  "go": {
    "runtime": "go",
    "hits": 30,
    "requests": 80,
    "elapsedMs": 4838,
    "workers": 8,
    "delayMs": 150,
    "lists": 30,
    "listsPerSec": 6.20
  },
  "speedup": 1.17
}
```
