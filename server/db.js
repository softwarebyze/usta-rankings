import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "usta.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  gender TEXT,
  years TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_scraped_at TEXT
);

CREATE TABLE IF NOT EXISTS ranking_lists (
  list_id INTEGER PRIMARY KEY,
  section_code TEXT,
  section TEXT,
  division_code TEXT,
  division_label TEXT,
  age_group TEXT,
  year INTEGER,
  month TEXT,
  title TEXT,
  list_type TEXT,
  variant TEXT,
  published_date TEXT,
  discovered_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS list_search_cache (
  section_code TEXT,
  division_code TEXT,
  year INTEGER,
  searched_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (section_code, division_code, year)
);

CREATE TABLE IF NOT EXISTS rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  list_id INTEGER NOT NULL REFERENCES ranking_lists(list_id),
  rank INTEGER,
  points INTEGER,
  row_p INTEGER,
  district TEXT,
  scraped_at TEXT DEFAULT (datetime('now')),
  UNIQUE (player_id, list_id)
);

CREATE TABLE IF NOT EXISTS checked_lists (
  player_id INTEGER NOT NULL REFERENCES players(id),
  list_id INTEGER NOT NULL REFERENCES ranking_lists(list_id),
  found INTEGER NOT NULL,
  checked_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, list_id)
);

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  status TEXT NOT NULL DEFAULT 'pending',
  phase TEXT,
  lists_total INTEGER DEFAULT 0,
  lists_checked INTEGER DEFAULT 0,
  rankings_found INTEGER DEFAULT 0,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rankings_player ON rankings(player_id);

CREATE TABLE IF NOT EXISTS utr_results_cache (
  player_id TEXT NOT NULL,
  year_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, year_key)
);
`);

export function upsertPlayer({ token, name, city, state }) {
  db.prepare(
    `INSERT INTO players (token, name, city, state) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET name=excluded.name, city=excluded.city, state=excluded.state`
  ).run(token, name, city, state);
  return db.prepare(`SELECT * FROM players WHERE token = ?`).get(token);
}

export function parseListMeta(title) {
  // e.g. "2016 Florida Tentative Ranking (Jul) (Combined)"
  const variant = /\(Combined\)/i.test(title)
    ? "Combined"
    : /\(Sectional\)/i.test(title)
      ? "Sectional"
      : /National/i.test(title)
        ? "National"
        : "Other";
  const typeMatch = title.match(
    /(Standing List|Tentative Ranking|Final Ranking|Endorsement List|Seeding List|Selection List|Qualifier List|Aging Up List|Bonus Points List|Points Race[^(]*|Year to Date[^(]*|12 Month Rolling[^(]*|Calendar Year[^(]*)/i
  );
  return { variant, listType: typeMatch ? typeMatch[1].trim() : "Other" };
}

export function upsertRankingList(l) {
  const { variant, listType } = parseListMeta(l.title);
  db.prepare(
    `INSERT INTO ranking_lists (list_id, section_code, section, division_code, division_label, age_group, year, month, title, list_type, variant, published_date)
     VALUES (@listId, @sectionCode, @section, @divisionCode, @divisionLabel, @ageGroup, @year, @month, @title, @listType, @variant, @publishedDate)
     ON CONFLICT(list_id) DO UPDATE SET title=excluded.title, published_date=excluded.published_date`
  ).run({ ...l, listType, variant });
}
