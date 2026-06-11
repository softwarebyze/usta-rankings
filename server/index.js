import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { db, upsertPlayer } from "./db.js";
import { searchPlayerAllYears } from "./search.js";
import { enqueueScrape, resumeInterrupted } from "./scraper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// --- API ---

app.post("/api/search", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (name.length < 2) return res.status(400).json({ error: "Enter at least 2 characters" });
  try {
    const players = await searchPlayerAllYears(name);
    res.json({ players });
  } catch (err) {
    res.status(502).json({ error: "USTA search failed: " + (err?.message || err) });
  }
});

app.post("/api/scrape", (req, res) => {
  const { token, name, city, state, years } = req.body ?? {};
  if (!token || !name) return res.status(400).json({ error: "token and name required" });
  const player = upsertPlayer({ token, name, city, state });
  if (Array.isArray(years) && years.length) {
    db.prepare(`UPDATE players SET years=? WHERE id=?`).run(JSON.stringify(years), player.id);
  }
  const jobId = enqueueScrape(player.id);
  res.json({ jobId, playerId: player.id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = db.prepare(`SELECT * FROM scrape_jobs WHERE id = ?`).get(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

app.get("/api/players", (_req, res) => {
  const players = db
    .prepare(
      `SELECT p.*, COUNT(r.id) AS snapshots,
              (SELECT status FROM scrape_jobs j WHERE j.player_id = p.id ORDER BY j.id DESC LIMIT 1) AS last_job_status
       FROM players p LEFT JOIN rankings r ON r.player_id = p.id
       GROUP BY p.id ORDER BY p.created_at DESC`
    )
    .all();
  res.json({ players });
});

app.get("/api/players/:id", (req, res) => {
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(req.params.id);
  if (!player) return res.status(404).json({ error: "not found" });
  const job = db
    .prepare(`SELECT * FROM scrape_jobs WHERE player_id = ? ORDER BY id DESC LIMIT 1`)
    .get(player.id);
  res.json({ player, job });
});

app.get("/api/players/:id/rankings", (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.rank, r.points, r.district,
              l.list_id, l.title, l.age_group, l.list_type, l.variant, l.section, l.published_date, l.year, l.month
       FROM rankings r JOIN ranking_lists l ON l.list_id = r.list_id
       WHERE r.player_id = ?
       ORDER BY l.published_date`
    )
    .all(req.params.id);
  // normalize MM/DD/YYYY -> ISO for the client
  const rankings = rows.map((r) => {
    const m = String(r.published_date).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return { ...r, date: m ? `${m[3]}-${m[1]}-${m[2]}` : null };
  });
  rankings.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  res.json({ rankings });
});

// --- static frontend ---
const dist = path.join(__dirname, "..", "web", "dist");
app.use(express.static(dist));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`usta-rankings listening on :${port}`));
resumeInterrupted();
