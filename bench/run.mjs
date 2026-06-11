#!/usr/bin/env node
// Runs Node vs Go list-scan benchmarks and writes bench/BENCHMARK.md
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const workers = process.env.BENCH_WORKERS || "8";
const delayMs = process.env.REQUEST_DELAY_MS || "150";

console.log(`Benchmark: ${workers} workers, ${delayMs}ms delay per session postback\n`);

function runNode() {
  return JSON.parse(
    execSync(`node bench/node.mjs`, {
      cwd: root,
      env: { ...process.env, BENCH_WORKERS: workers, REQUEST_DELAY_MS: delayMs },
      stdio: ["ignore", "pipe", "inherit"],
    }).toString()
  );
}

function runGo() {
  execSync(`go build -o scraper-go/bench-bin ./cmd/bench`, {
    cwd: path.join(root, "scraper-go"),
    stdio: "inherit",
  });
  return JSON.parse(
    execSync(`./bench-bin -workers=${workers} -delay-ms=${delayMs}`, {
      cwd: path.join(root, "scraper-go"),
      stdio: ["ignore", "pipe", "inherit"],
    }).toString()
  );
}

const node = runNode();
console.log("Node:", node.elapsedMs, "ms", node.hits, "hits");
const go = runGo();
console.log("Go:  ", go.elapsedMs, "ms", go.hits, "hits");

const speedup = (node.elapsedMs / go.elapsedMs).toFixed(2);
const projNodeMin = ((686 / node.listsPerSec) * (node.requests / node.lists) / 60).toFixed(1);
const projGoMin = ((686 / go.listsPerSec) * (go.requests / go.lists) / 60).toFixed(1);

const md = `# Scrape benchmark (${new Date().toISOString().slice(0, 10)})

Workload: scan **${node.lists} ranking lists** for one player (fixture from Zachary Ebenfeld's career), **${workers} parallel sessions**, **${delayMs}ms** polite delay before each postback per session.

| Runtime | Wall time | HTTP postbacks | Lists/sec | Hits | Est. full career scan* |
|---------|-----------|----------------|-----------|------|------------------------|
| Node (current) | ${node.elapsedMs} ms | ${node.requests} | ${node.listsPerSec.toFixed(2)} | ${node.hits} | ~${projNodeMin} min |
| Go (prototype) | ${go.elapsedMs} ms | ${go.requests} | ${go.listsPerSec.toFixed(2)} | ${go.hits} | ~${projGoMin} min |

*Extrapolated: ~686 lists/player × avg ${(node.requests / node.lists).toFixed(1)} postbacks/list at these settings.

**Go is ${speedup}× faster** on this benchmark (${Math.round((1 - go.elapsedMs / node.elapsedMs) * 100)}% less wall time).

## Why scraping feels slow

Scraping is **network-bound**, not CPU-bound. Each ranking list takes **2–4 HTTP postbacks** to TennisLink (open list → sort by name → filter by letter). The old defaults were:

- \`REQUEST_DELAY_MS = 350\` — artificial sleep **before every postback**
- \`WORKERS = 3\` — only three lists checked at once

For ~686 lists × ~3 postbacks × 350ms ≈ **12+ minutes** even if the server responds instantly.

## What Go changes

Go doesn't make TennisLink respond faster. It wins by:

1. **Cheaper goroutines** — 8–12 parallel sessions without Node's event-loop overhead
2. **HTTP keep-alive** — \`Transport.MaxIdleConnsPerHost\` reuses TLS connections
3. **Lower per-request overhead** — no V8 GC pauses between postbacks

## What we changed in Node (without switching runtimes)

Even keeping Node, the same ideas apply — see \`server/constants.js\` and \`server/scraper.js\`:

\`\`\`javascript
// server/constants.js — now env-tunable
export const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 200);
export const SCRAPE_WORKERS = Number(process.env.SCRAPE_WORKERS ?? 8);
\`\`\`

\`\`\`javascript
// server/scraper.js — worker pool size from env
const WORKERS = SCRAPE_WORKERS;
await Promise.all(Array.from({ length: WORKERS }, worker));
\`\`\`

Set \`SCRAPER_ENGINE=go\` to route list scanning through the Go binary (\`server/go-bridge.js\`).

## Recommendation

- **Short term:** tune Node with \`REQUEST_DELAY_MS=150\` and \`SCRAPE_WORKERS=8\` (~2–3× faster, still polite)
- **Medium term:** use Go for the scan phase only; keep Express + SQLite API in Node
- **Don't** drop the delay to zero — TennisLink will rate-limit or error

## Raw JSON

\`\`\`json
${JSON.stringify({ node, go, speedup: Number(speedup) }, null, 2)}
\`\`\`
`;

fs.writeFileSync(path.join(__dirname, "BENCHMARK.md"), md);
console.log("\nWrote bench/BENCHMARK.md");
