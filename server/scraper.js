// Background scrape job runner: discovers all ranking lists relevant to a
// player and extracts their row from each list.
import { db, upsertRankingList } from "./db.js";
import { UstaSession, searchPlayersForYear, searchRankingLists, findPlayerInList } from "./usta.js";
import { JUNIOR_DIVISIONS, STATE_TO_SECTIONS, SECTIONS, MIN_YEAR } from "./constants.js";

const CURRENT_YEAR = new Date().getFullYear();

let running = false;

export function enqueueScrape(playerId) {
  const existing = db
    .prepare(`SELECT * FROM scrape_jobs WHERE player_id = ? AND status IN ('pending','running')`)
    .get(playerId);
  if (existing) return existing.id;
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO scrape_jobs (player_id, status) VALUES (?, 'pending')`)
    .run(playerId);
  void pump();
  return Number(lastInsertRowid);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = db.prepare(`SELECT * FROM scrape_jobs WHERE status = 'pending' ORDER BY id LIMIT 1`).get();
      if (!job) break;
      await runJob(job).catch((err) => {
        db.prepare(`UPDATE scrape_jobs SET status='failed', error=?, completed_at=datetime('now') WHERE id=?`).run(
          String(err?.stack || err),
          job.id
        );
      });
    }
  } finally {
    running = false;
  }
}

const setPhase = (jobId, phase) => db.prepare(`UPDATE scrape_jobs SET phase=? WHERE id=?`).run(phase, jobId);

async function withRetries(session, fn, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(session.s);
    } catch (err) {
      if (attempt >= retries) throw err;
      // Fresh session: legacy ASP.NET state can sour; re-init recovers it.
      session.s = new UstaSession();
      await session.s.init();
    }
  }
}

async function runJob(job) {
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(job.player_id);
  if (!player) throw new Error("player not found");
  db.prepare(`UPDATE scrape_jobs SET status='running', started_at=datetime('now') WHERE id=?`).run(job.id);

  const lastName = player.name.split(",")[0].trim();
  const session = { s: new UstaSession() };
  await session.s.init();

  // Phase 1: which years does this player appear in? (already stored from search, else sweep)
  let years = player.years ? JSON.parse(player.years) : null;
  if (!years || years.length === 0) {
    setPhase(job.id, "Finding active years");
    years = [];
    for (let y = MIN_YEAR; y <= CURRENT_YEAR; y++) {
      const found = await withRetries(session, (s) => searchPlayersForYear(s, lastName, y));
      if (found.some((p) => p.token === player.token)) years.push(y);
    }
    db.prepare(`UPDATE players SET years=? WHERE id=?`).run(JSON.stringify(years), player.id);
  }
  if (years.length === 0) {
    db.prepare(
      `UPDATE scrape_jobs SET status='complete', phase='No ranking years found', completed_at=datetime('now') WHERE id=?`
    ).run(job.id);
    return;
  }

  // Phase 2: discover ranking lists for each (section, division, year)
  setPhase(job.id, "Discovering ranking lists");
  const sectionCodes = [...(STATE_TO_SECTIONS[player.state] ?? []), "00"]; // always include National
  const genders = player.gender ? [player.gender] : ["B", "G"];
  let lockedGender = player.gender || null;

  const combos = [];
  for (const year of years)
    for (const g of genders)
      for (const div of JUNIOR_DIVISIONS[g])
        for (const sec of sectionCodes) combos.push({ year, g, div, sec });

  const hasCache = db.prepare(`SELECT 1 FROM list_search_cache WHERE section_code=? AND division_code=? AND year=?`);
  const candidateListIds = new Set();
  let comboIdx = 0;
  for (const { year, g, div, sec } of combos) {
    comboIdx++;
    if (lockedGender && g !== lockedGender) continue;
    if (!hasCache.get(sec, div.code, year)) {
      const lists = await withRetries(session, (s) => searchRankingLists(s, sec, div.code, year));
      for (const l of lists) {
        upsertRankingList({
          listId: l.listId,
          sectionCode: sec,
          section: SECTIONS[sec],
          divisionCode: div.code,
          divisionLabel: l.divisionLabel || div.label,
          ageGroup: div.ageGroup,
          year,
          month: l.month,
          title: l.title,
          publishedDate: l.publishedDate,
        });
      }
      db.prepare(`INSERT OR REPLACE INTO list_search_cache (section_code, division_code, year) VALUES (?,?,?)`).run(
        sec,
        div.code,
        year
      );
    }
    setPhase(job.id, `Discovering ranking lists (${comboIdx}/${combos.length})`);
    for (const r of db
      .prepare(`SELECT list_id FROM ranking_lists WHERE section_code=? AND division_code=? AND year=?`)
      .all(sec, div.code, year)) {
      candidateListIds.add(r.list_id);
    }
  }

  // Phase 3: check each list for the player's row
  const alreadyChecked = new Set(
    db.prepare(`SELECT list_id FROM checked_lists WHERE player_id=?`).all(player.id).map((r) => r.list_id)
  );
  const toCheck = [...candidateListIds].filter((id) => !alreadyChecked.has(id));
  let found = db.prepare(`SELECT COUNT(*) c FROM rankings WHERE player_id=?`).get(player.id).c;
  db.prepare(`UPDATE scrape_jobs SET lists_total=?, rankings_found=? WHERE id=?`).run(toCheck.length, found, job.id);
  setPhase(job.id, "Scanning ranking lists");

  // Prioritize: check gender-matching lists; if gender unknown, alternate B/G until detected.
  const meta = new Map(
    db.prepare(`SELECT list_id, age_group FROM ranking_lists`).all().map((r) => [r.list_id, r.age_group])
  );
  toCheck.sort((a, b) => a - b);

  let checked = 0;
  for (const listId of toCheck) {
    const ag = meta.get(listId) || "";
    if (lockedGender && !ag.startsWith(lockedGender)) {
      db.prepare(`INSERT OR REPLACE INTO checked_lists (player_id, list_id, found) VALUES (?,?,0)`).run(
        player.id,
        listId
      );
      checked++;
      continue;
    }
    const { row } = await withRetries(session, (s) => findPlayerInList(s, listId, lastName, player.token));
    if (row) {
      db.prepare(
        `INSERT INTO rankings (player_id, list_id, rank, points, row_p, district) VALUES (?,?,?,?,?,?)
         ON CONFLICT(player_id, list_id) DO UPDATE SET rank=excluded.rank, points=excluded.points`
      ).run(player.id, listId, row.rank, row.points, row.rowP, row.district);
      found++;
      if (!lockedGender && ag) {
        lockedGender = ag[0];
        db.prepare(`UPDATE players SET gender=? WHERE id=?`).run(lockedGender, player.id);
      }
    }
    db.prepare(`INSERT OR REPLACE INTO checked_lists (player_id, list_id, found) VALUES (?,?,?)`).run(
      player.id,
      listId,
      row ? 1 : 0
    );
    checked++;
    db.prepare(`UPDATE scrape_jobs SET lists_checked=?, rankings_found=? WHERE id=?`).run(checked, found, job.id);
  }

  db.prepare(`UPDATE players SET last_scraped_at=datetime('now') WHERE id=?`).run(player.id);
  db.prepare(
    `UPDATE scrape_jobs SET status='complete', phase='Done', completed_at=datetime('now') WHERE id=?`
  ).run(job.id);
}

// Resume any jobs that were interrupted by a restart.
export function resumeInterrupted() {
  db.prepare(`UPDATE scrape_jobs SET status='pending' WHERE status='running'`).run();
  void pump();
}
