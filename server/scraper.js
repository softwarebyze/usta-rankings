// Background scrape job runner: discovers all ranking lists relevant to a
// player and extracts their row from each list.
import { db, upsertRankingList } from "./db.js";
import { UstaSession, searchPlayersForYear, searchRankingLists, findPlayerInList } from "./usta.js";
import { JUNIOR_DIVISIONS, STATE_TO_SECTIONS, SECTIONS, MIN_YEAR, getScrapeWorkers, getScraperEngine } from "./constants.js";
import { scanListsGo } from "./go-bridge.js";

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
          discipline: div.discipline,
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

  // Phase 3: check each list for the player's row.
  // Pruning rules keep this tractable (a season can have 600+ published lists):
  //  - once the player's gender is known, skip the other gender's divisions
  //  - players never age DOWN: skip brackets below the max bracket seen in earlier years
  //  - National lists are only checked for (year, bracket) where a sectional hit exists
  const alreadyChecked = new Set(
    db.prepare(`SELECT list_id FROM checked_lists WHERE player_id=?`).all(player.id).map((r) => r.list_id)
  );
  const candidateIds = [...candidateListIds];
  const listMeta = (
    candidateIds.length
      ? db
          .prepare(
            `SELECT list_id, age_group, year, section_code, discipline FROM ranking_lists WHERE list_id IN (${candidateIds.map(() => "?").join(",")})`
          )
          .all(...candidateIds)
      : []
  )
    .map((r) => ({
      listId: r.list_id,
      ageGroup: r.age_group,
      gender: r.age_group?.[0],
      bracket: parseInt(String(r.age_group).slice(1), 10) || 0,
      year: r.year,
      national: r.section_code === "00",
      discipline: r.discipline || "Singles",
    }));

  // sectional first (year asc, bracket asc), national afterwards
  const queue = listMeta
    .filter((m) => !alreadyChecked.has(m.listId))
    .sort(
      (a, b) =>
        Number(a.national) - Number(b.national) || a.year - b.year || a.bracket - b.bracket || a.listId - b.listId
    );

  let found = db.prepare(`SELECT COUNT(*) c FROM rankings WHERE player_id=?`).get(player.id).c;
  db.prepare(`UPDATE scrape_jobs SET lists_total=?, rankings_found=? WHERE id=?`).run(queue.length, found, job.id);
  setPhase(job.id, "Scanning ranking lists");

  // hits per year (max bracket) and per year+bracket, seeded from previous runs
  const maxBracketByYear = new Map();
  const hitYearBrackets = new Set();
  for (const r of db
    .prepare(
      `SELECT l.year, l.age_group, l.discipline FROM rankings r JOIN ranking_lists l ON l.list_id = r.list_id WHERE r.player_id=?`
    )
    .all(player.id)) {
    const b = parseInt(String(r.age_group).slice(1), 10) || 0;
    maxBracketByYear.set(r.year, Math.max(maxBracketByYear.get(r.year) ?? 0, b));
    hitYearBrackets.add(`${r.year}:${r.age_group}:${r.discipline || "Singles"}`);
  }

  const markChecked = db.prepare(`INSERT OR REPLACE INTO checked_lists (player_id, list_id, found) VALUES (?,?,?)`);
  const insertRanking = db.prepare(
    `INSERT INTO rankings (player_id, list_id, rank, points, row_p, district) VALUES (?,?,?,?,?,?)
     ON CONFLICT(player_id, list_id) DO UPDATE SET rank=excluded.rank, points=excluded.points`
  );

  let checked = 0;
  const bump = () =>
    db.prepare(`UPDATE scrape_jobs SET lists_checked=?, rankings_found=? WHERE id=?`).run(checked, found, job.id);

  function shouldSkip(m) {
    if (lockedGender && m.gender !== lockedGender) return true;
    for (const [y, b] of maxBracketByYear) if (y < m.year && m.bracket < b) return true;
    if (m.national && !hitYearBrackets.has(`${m.year}:${m.ageGroup}:${m.discipline}`)) return true;
    return false;
  }

  let qi = 0;
  const WORKERS = getScrapeWorkers();
  const useGo = getScraperEngine() === "go";

  if (useGo && queue.length > 0) {
    // Go engine: batch remaining queue through the native scanner.
    const batch = [];
    while (qi < queue.length) {
      const m = queue[qi++];
      if (shouldSkip(m)) {
        markChecked.run(player.id, m.listId, 0);
        checked++;
        continue;
      }
      batch.push(m);
    }
    if (batch.length) {
      setPhase(job.id, `Scanning ranking lists (Go, ${batch.length} lists)`);
      const hits = await scanListsGo({
        listIds: batch.map((m) => m.listId),
        lastName,
        token: player.token,
        onResult(listId, row) {
          const m = batch.find((b) => b.listId === listId);
          if (row && m) {
            insertRanking.run(player.id, m.listId, row.rank, row.points, row.rowP, row.district);
            found++;
            maxBracketByYear.set(m.year, Math.max(maxBracketByYear.get(m.year) ?? 0, m.bracket));
            hitYearBrackets.add(`${m.year}:${m.ageGroup}:${m.discipline}`);
            if (!lockedGender && m.gender) {
              lockedGender = m.gender;
              db.prepare(`UPDATE players SET gender=? WHERE id=?`).run(lockedGender, player.id);
            }
            markChecked.run(player.id, m.listId, 1);
          } else {
            markChecked.run(player.id, m.listId, 0);
          }
          checked++;
          if (checked % 10 === 0) bump();
        },
      });
      void hits;
      bump();
    }
  } else {
    async function worker() {
      const sess = { s: new UstaSession() };
      await sess.s.init();
      for (;;) {
        const m = queue[qi++];
        if (!m) return;
        if (shouldSkip(m)) {
          markChecked.run(player.id, m.listId, 0);
          checked++;
          if (checked % 20 === 0) bump();
          continue;
        }
        const { row } = await withRetries(sess, (s) => findPlayerInList(s, m.listId, lastName, player.token));
        if (row) {
          insertRanking.run(player.id, m.listId, row.rank, row.points, row.rowP, row.district);
          found++;
          maxBracketByYear.set(m.year, Math.max(maxBracketByYear.get(m.year) ?? 0, m.bracket));
          hitYearBrackets.add(`${m.year}:${m.ageGroup}:${m.discipline}`);
          if (!lockedGender && m.gender) {
            lockedGender = m.gender;
            db.prepare(`UPDATE players SET gender=? WHERE id=?`).run(lockedGender, player.id);
          }
        }
        markChecked.run(player.id, m.listId, row ? 1 : 0);
        checked++;
        bump();
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, worker));
  }
  bump();

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
