# Data & deployment workflow

This document explains how ranking data is stored, when the scraper talks to USTA,
and what happens to the database when code ships.

**Core principle:** USTA junior rankings are a historical archive. Once a list row is
confirmed (`checked_lists.found = 1`), that list is never fetched from USTA again for
that player. Reads are served from SQLite.

---

## Data model

SQLite database at `{DATA_DIR}/usta.db` (production: `/data/usta.db` on the Fly volume).

| Table | Scope | Purpose |
|-------|-------|---------|
| `players` | Per player | Identity (`token`), metadata, `years` JSON, `last_scraped_at` |
| `ranking_lists` | **Global** | Catalog of every USTA list ever discovered (`list_id` PK) |
| `list_search_cache` | **Global** | “We already queried USTA for (section, division, year)” |
| `rankings` | Per player + list | Scraped row: rank, points, district |
| `checked_lists` | Per player + list | Scan state: was this list checked? was the player on it? |
| `scrape_jobs` | Per job | Queue status, phase, progress counters |

**WAL mode** is enabled (`journal_mode = WAL`) for safer concurrent reads during writes.

There are **no automatic schema migrations**. On startup the app runs `CREATE TABLE IF NOT
EXISTS` and creates missing indexes. Existing production databases are not altered beyond
that. If you add columns or change constraints, plan a manual migration on the volume
before deploying.

---

## Scrape pipeline

Triggered by `POST /api/scrape` after a player search. Jobs run in a single in-process
FIFO queue (one player job at a time globally).

### Phase 1 — Active years

- If `players.years` is already set → **skip** (no USTA year sweep).
- Otherwise sweep 2001 → present via USTA player search; store matching years.

### Phase 2 — List discovery

For each `(year, gender division, section)` combo relevant to the player:

- Check `list_search_cache` for `(section_code, division_code, year)`.
- **Cache hit** → read list IDs from `ranking_lists` in SQLite only.
- **Cache miss** → one USTA “Find a Ranking” search; upsert results into
  `ranking_lists`; mark the triple cached **forever**.

List discovery is global: the first player to need “Florida B18 2016” pays the USTA
cost; every later player reuses the catalog row.

### Phase 3 — Row extraction

For each candidate list:

1. Skip if `checked_lists.found = 1` for this player → **no HTTP** (scrape-once).
2. Otherwise open the list on USTA, look up the player by name/token, store result.
3. On hit → `rankings` upsert + `checked_lists.found = 1`.
4. On miss → `checked_lists.found = 0` (may retry on a future job).

**Pruning** (no HTTP, marked `found = 0`):

- Wrong gender after gender lock.
- National list when no sectional hit exists for the same `(year, age_group)`.

**Sort order:** sectional lists first (year ↑, bracket ↑), then national.

---

## Scrape-once rules

This is the behavior that keeps the site fast after the first build.

| Data | First scrape | Re-scrape (new job) | Deploy / restart |
|------|--------------|---------------------|------------------|
| `rankings` where `found = 1` | USTA fetch | **Skipped** — served from DB | **Preserved** on volume |
| `checked_lists` with `found = 1` | Written | **Never re-checked** | Preserved |
| `checked_lists` with `found = 0` | Written | **Retried** (miss, prune, or transient error) | Preserved; retried on next job |
| `players.years` | USTA sweep | **Skipped** if already set | Preserved |
| `list_search_cache` | USTA search | **Skipped** — global forever | Preserved |
| `ranking_lists` catalog | From discovery | Re-upsert title/date only on cache miss | Preserved |

**Historical data assumption:** a published 2008 Florida Tentative Ranking does not
change. `found = 1` is permanent for that `(player, list_id)` pair.

**When USTA is contacted again:**

- A list that was never successfully found (`found = 0`).
- A `(section, division, year)` never discovered before (new cache miss).
- A brand-new player with no rows yet.
- Phase 1 year sweep only if `players.years` is empty.

**When USTA is not contacted:**

- Any list already confirmed for that player (`found = 1`).
- List discovery for cached section/division/year triples.
- Player profile reads (`GET /api/players/:id/rankings`) — SQLite only.

---

## What happens when code updates ship

### Production (`main` → Fly.io)

Workflow: `.github/workflows/deploy.yml` — push to `main` runs `flyctl deploy`.

| Component | On deploy |
|-----------|-----------|
| **App binary** | Replaced (new Docker image) |
| **`/data/usta.db`** | **Unchanged** — persists on Fly volume `usta_data` |
| **Scrape jobs** | `running` → `pending` on startup (`resumeInterrupted()`); job resumes incrementally using caches above |
| **In-flight HTTP** | Lost on process restart; safe to retry via `found = 0` rows |
| **Schema** | Only `CREATE IF NOT EXISTS`; no automatic ALTER |

**Typical deploy:** new UI or API code goes live; all scraped ranking data remains.
Players already built load instantly from SQLite. No automatic re-scrape runs.

**Important:** deploying scraper fixes does **not** rewrite existing `rankings` rows.
The database on the Fly volume keeps whatever was stored by the previous scrape. After
a scraper bug fix ships, affected players need a one-time **Refresh history** (player
page button, or `POST /api/scrape` again). That job retries only `found = 0` lists;
confirmed rows (`found = 1`) are still not re-fetched from USTA.

### PR previews

Workflow: `.github/workflows/preview.yml` — ephemeral app `usta-rankings-pr-{N}`.

- Deployed per pull request; destroyed when the PR closes.
- Uses the same `fly.toml` volume mount; each preview app gets its **own** empty volume
  unless previously deployed.
- Expect an empty database on first preview deploy (no bundled seed in the Docker image).
- Building a player history in preview hits USTA live like production.

### Local development

- `DATA_DIR` defaults to `./data` (gitignored).
- First run creates an empty `usta.db`.
- Data survives between `npm start` restarts; wiped only if you delete `./data`.

---

## Cache invalidation (manual)

The app does not expire caches automatically. Use these only when you know USTA
published new lists for an already-cached triple, or catalog metadata is wrong.

```sql
-- Re-discover lists for Florida Boys' 18 Singles 2026
DELETE FROM list_search_cache
WHERE section_code = '15' AND division_code = 'D1001' AND year = 2026;

-- Force re-scan of one list for one player (rare)
DELETE FROM checked_lists WHERE player_id = ? AND list_id = ?;
DELETE FROM rankings WHERE player_id = ? AND list_id = ?;
```

Do **not** delete `found = 1` rows unless you have reason to believe the stored rank
is wrong — that forces a full USTA re-fetch for that list.

---

## Performance characteristics

Tuning constants (see `server/constants.js`, `server/scraper.js`, `server/search.js`):

| Knob | Default | Effect |
|------|---------|--------|
| `REQUEST_DELAY_MS` | 350 ms | Polite delay before each USTA postback |
| List scan workers | 3 | Parallel `UstaSession`s per scrape job (phase 3) |
| Year search parallelism | 6 | Parallel sessions in `POST /api/search` |
| Job queue | 1 at a time | Global FIFO — avoids hammering USTA |
| SQLite | WAL + `idx_rankings_player` | Fast per-player reads |
| Fly VM | shared-cpu-1x, 512 MB | Single warm instance (`min_machines_running = 1`) |

**Read path (player page):** `GET /api/players/:id/rankings` is a single indexed SQLite
join — no USTA calls. Frontend polls job status every 3s only while a scrape is active.

**Write path (first build):** dominated by phase 3 list scans. A full career can take
several minutes; subsequent loads are instant from cache.

**Not yet optimized (opportunities):**

- Express response compression
- Static asset cache headers
- Frontend route-level code splitting
- Configurable worker/delay via environment variables

---

## Operations quick reference

```bash
# Local
npm install && (cd web && npm install && npm run build)
npm start                    # :3001, DB at ./data/usta.db

# Verify USTA client against known snapshots
node server/test-scrape.js

# Production deploy
git push origin main         # triggers Fly deploy

# Inspect production DB (Fly SSH)
fly ssh console -a usta-rankings
sqlite3 /data/usta.db ".tables"
```

### API

| Endpoint | USTA? | Notes |
|----------|-------|-------|
| `POST /api/search` | Yes | Year sweep, 6 parallel sessions |
| `POST /api/scrape` | Queues job | Dedupes pending/running jobs per player |
| `GET /api/players/:id/rankings` | **No** | SQLite only |
| `GET /api/jobs/:id` | No | Poll while scrape runs |

---

## Related files

| File | Role |
|------|------|
| `server/scraper.js` | Job queue, 3-phase scrape, pruning, scrape-once logic |
| `server/db.js` | Schema bootstrap, `upsertPlayer`, `upsertRankingList` |
| `server/usta.js` | HTTP postback client |
| `server/search.js` | Multi-year name search |
| `server/index.js` | API routes, `resumeInterrupted()` on boot |
| `fly.toml` | Volume mount, VM size, `DATA_DIR=/data` |
| `Dockerfile` | Multi-stage build; no DB bundled |
| `.github/workflows/deploy.yml` | Production deploy |
| `.github/workflows/preview.yml` | PR preview apps |
