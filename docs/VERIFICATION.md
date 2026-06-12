# Data verification — June 2026

This document records investigation of reported data issues and what shipped in `release/v2-clean`.

## Reported issues

### “16s 32?” (Scott Plutt)

**Report:** Rank looked wrong — “was like 20 in the state at least.”

**Finding:** Data is **correct**. Scott Plutt’s best Florida B16 tentative combined rank is **#32**, verified live against USTA TennisLink.

| Source | Best B16 tentative rank |
|--------|-------------------------|
| Production DB | #32 (list 1256073, Sep 2013) |
| Live USTA fetch | #32, 1357 pts |

**Likely confusion:** Michael Plutt (same family) peaked at **#21** in Florida B16 (Sep 2013). The ~#20 figure matches Michael, not Scott.

**Hover proof:** Context API for list 1256073 @ rank 32:

```
#29 Litsky, Peter
#30 Kumar, Ninan
#31 Ortega, Jose Andres
#32 Plutt, Scott        ← highlighted
#33 Carvajal, Gabriel
#34 Mottice, David
#35 Moore, Michael
```

### David Ruttenberg — Chicago rankings

**Report:** Find David Ruttenberg’s Chicago rankings.

**Finding:** Player existed in prod with **0 snapshots** — scrape had never completed (job stuck `pending`).

- Token: `UYUMs/iIcTQPtp7V3BSRxA==`
- City: Highland Park, IL → **Midwest section (85)**, which covers Chicago
- Active years in player search: 2003, 2004, 2006, 2011

**USTA spot-check (manual):** Searched Midwest (`85`) singles + doubles lists across all age brackets for 2003–2011. **No published ranking rows found** for this token on any list checked (~145 list opens). The player appears in TennisLink **name search** for those years but may not have held a published sectional/national junior ranking during that window (common for players who competed but didn’t meet list thresholds).

**Action:** Full automated scrape still runs (~1600 candidate lists for IL + national). If it completes with 0 snapshots, that confirms no published junior list history in the archive for this profile — not a scraper bug.

After snapshots exist, use the **USTA ↗** link on any row to open the exact list on TennisLink.

## Bugs fixed in v2

### 1. Variant vs discipline conflation

**Before:** Lists titled `(Combined)` stored `variant=Combined`, mixing geographic scope with singles/doubles/combined points.

**After:** `variant` = Sectional | National; `discipline` = Singles | Doubles | Combined.

**Impact:** Compare page and best-ever cards now filter correctly. Standing lists no longer inflate “best rank” when ranking lists exist.

### 2. Compare chart — non-overlapping timelines

**Before:** Players active in different years appeared as separate flat segments on a calendar timeline (hard to compare).

**After:** **Season overlay** mode stacks Jan–Dec on one axis; each player-season is a line regardless of calendar year.

### 3. Tooltip — overlapping lines

**Before:** `payload[0]` only — hovering overlapping compare lines showed one player.

**After:** Tooltip lists **all series** at the hover point with color-coded ranks.

### 4. Ranking context on hover

**New:** Single-series tooltips fetch neighbors on the published list (ranks ±3) so you can see who was around you that week.

### 5. USTA source links restored

Each snapshot row links to the exact TennisLink list via `sourceUrl(list_id, row_p)`.

### 6. Doubles support

Scraper discovers doubles divisions (D1101–D1123 / D1115–D1123). Player page has discipline chips; doubles lines are dashed on the chart.

## What we did NOT merge (intentionally)

From `scraping-perf` / `improvements` branches:

- Pricing / Pro tier / Stripe stubs
- Marketing landing blocks / email capture
- About page (methodology prose — kept app focused on search + charts)
- Go scraper (separate perf PR if needed later)

## Re-scrape note for production

Existing players scraped under the old variant model should be **re-scraped** once to pick up doubles lists and corrected variant/discipline metadata. Rank numbers for singles/combined lists already stored should match USTA; bests may change slightly due to filtering ranking-only lists.

## Manual verification commands

```bash
# Scott Plutt B16 best rank from API
curl -s localhost:3001/api/players/5/rankings | jq '[.rankings[] | select(.age_group=="B16" and (.list_type|test("Ranking")))] | min_by(.rank)'

# List context (neighbors at rank 32)
curl -s "localhost:3001/api/lists/1256073/context?rank=32" | jq '.rows[] | "#\(.rank) \(.name)"'

# Live USTA spot-check
node -e "import { UstaSession, findPlayerInList } from './server/usta.js'; const s=new UstaSession(); await s.init(); const {row}=await findPlayerInList(s,1256073,'Plutt','t5PP/w2pcjhD7rVk6FFDgw=='); console.log(row);"
```
