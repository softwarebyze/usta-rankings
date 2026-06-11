// Bridge to the Go list scanner (SCRAPER_ENGINE=go).
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getRequestDelayMs, getScrapeWorkers } from "./constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, "..", "scraper-go", "scan-bin");

function ensureBinary() {
  if (fs.existsSync(binPath)) return;
  const { status, stderr } = spawnSync("go", ["build", "-o", binPath, "./cmd/scan"], {
    cwd: path.join(__dirname, "..", "scraper-go"),
    encoding: "utf8",
  });
  if (status !== 0) throw new Error(`Go build failed: ${stderr}`);
}

/**
 * Scan listIds in parallel via Go. Calls onResult(listId, row|null) for each list.
 * Returns hit count.
 */
export async function scanListsGo({ listIds, lastName, token, onResult, workers, delayMs }) {
  ensureBinary();
  const job = {
    lastName,
    token,
    listIds,
    workers: workers ?? getScrapeWorkers(),
    delayMs: delayMs ?? getRequestDelayMs(),
  };
  const { status, stdout, stderr } = spawnSync(binPath, [], {
    input: JSON.stringify(job),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (status !== 0) throw new Error(stderr || "Go scan failed");
  const { results } = JSON.parse(stdout);
  let hits = 0;
  for (const r of results) {
    onResult(r.listId, r.row);
    if (r.row) hits++;
  }
  return hits;
}
