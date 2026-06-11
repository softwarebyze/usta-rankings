# Baseline — USTA Junior Ranking History

Search any USTA junior tennis player by name and rebuild their **complete ranking
history** — every published sectional/national standing list, by age bracket
(10s/12s/14s/16s/18s), charted over time with best-ever ranks per bracket, plus
head-to-head comparison between players.

## How it works (no headless browser!)

The USTA TennisLink ranking archive is a legacy ASP.NET WebForms app driven by
`__doPostBack` UpdatePanel calls. Instead of scraping it with Playwright, this app
**replays the MS AJAX postback protocol over plain HTTP** (`server/usta.js`):

1. **Player search** — the "Search Archived Player Ranking" form is posted for each
   year (2001–present, a few sessions in parallel). Matches are merged by the
   player's stable encrypted `PlayerID` token. This also reveals which years the
   player was ranked.
2. **List discovery** — the "Find a Ranking" advanced search is posted per
   (section, junior division, year), returning every published ranking list with
   its `ListID`, title and publish date. The player's section is derived from
   their state; National lists are always included.
3. **Row extraction** — each candidate list is opened, switched to *order by name*,
   jumped to the player's last-name letter, and the player's row (rank, points,
   district) is parsed out. Results are cached in SQLite so re-scrapes are
   incremental.

Scrape jobs run on a DB-backed in-process queue with progress the frontend polls.

## Stack

- **Backend**: Node 22 + Express + better-sqlite3 (SQLite, WAL)
- **Frontend**: React + Vite + Recharts (rank axis inverted — #1 at the top)
- **Deploy**: single container (see `Dockerfile`), SQLite on a volume

## Run locally

```bash
npm install
(cd web && npm install && npm run build)
npm start            # serves API + built frontend on :3001
```

Dev mode with HMR: `npm start` in one terminal, `cd web && npm run dev` in another
(Vite proxies `/api` to :3001).

## Verify

`node server/test-scrape.js` checks the three known proof snapshots for
Zachary Ebenfeld (ListIDs 1626410/1682666/1756446 → ranks 75/63/88).

## API

- `POST /api/search` `{name}` → players with token + active years
- `POST /api/scrape` `{token, name, city, state, years}` → `{jobId, playerId}`
- `GET /api/jobs/:id` → status/phase/progress
- `GET /api/players` · `GET /api/players/:id` · `GET /api/players/:id/rankings`
