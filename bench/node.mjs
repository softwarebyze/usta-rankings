// Node benchmark: same workload as scraper-go/cmd/bench (scan fixture list IDs).
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workers = parseInt(process.env.BENCH_WORKERS || "8", 10);
const delayMs = parseInt(process.env.REQUEST_DELAY_MS || "150", 10);
process.env.REQUEST_DELAY_MS = String(delayMs);

const fixturePath = process.argv.includes("--fixture")
  ? process.argv[process.argv.indexOf("--fixture") + 1]
  : path.join(__dirname, "fixture.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const { lastName, token, listIds } = fixture;

const { UstaSession, findPlayerInList } = await import(pathToFileURL(path.join(__dirname, "../server/usta.js")).href);

async function worker(queue, stats) {
  const session = new UstaSession();
  await session.init();
  for (;;) {
    const listId = queue.shift();
    if (listId === undefined) return;
    const before = session.requestCount;
    try {
      const { row } = await findPlayerInList(session, listId, lastName, token);
      stats.requests += session.requestCount - before;
      if (row) stats.hits++;
    } catch (err) {
      stats.error = err;
      return;
    }
  }
}

const start = performance.now();
const stats = { hits: 0, requests: 0, error: null };
const queue = [...listIds];
await Promise.all(Array.from({ length: workers }, () => worker(queue, stats)));
const elapsedMs = Math.round(performance.now() - start);

if (stats.error) {
  console.error(stats.error);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      runtime: "node",
      hits: stats.hits,
      requests: stats.requests,
      elapsedMs,
      workers,
      delayMs,
      lists: listIds.length,
      listsPerSec: listIds.length / (elapsedMs / 1000),
    },
    null,
    2
  )
);
