import express from "express";
import compression from "compression";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, upsertPlayer } from "./db.js";
import { searchPlayerAllYears } from "./search.js";
import { enqueueScrape, resumeInterrupted } from "./scraper.js";
import { renderOgCard, renderHomeOgCard } from "./og.js";
import { rankingMeetings, findLocalPlayer } from "./rankingH2h.js";
import { computeTennisLinkH2H, getPlayerMatchHistory } from "./playerRecords.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", true);
app.use(compression());
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

function bestsForPlayer(playerId) {
  const rows = db
    .prepare(
      `SELECT r.rank, l.age_group, l.year, l.published_date
       FROM rankings r JOIN ranking_lists l ON l.list_id = r.list_id
       WHERE r.player_id = ?`
    )
    .all(playerId);
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.age_group);
    if (!cur || r.rank < cur.rank) best.set(r.age_group, r);
  }
  return [...best.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ageGroup, r]) => ({ ageGroup, rank: r.rank, year: r.year }));
}

app.get("/api/players/:id/og.png", (req, res) => {
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(req.params.id);
  if (!player) return res.status(404).end();
  try {
    const png = renderOgCard(player, bestsForPlayer(player.id));
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(png);
  } catch (err) {
    console.error("og render failed:", err);
    res.status(500).end();
  }
});

app.get("/api/og.png", (_req, res) => {
  try {
    const png = renderHomeOgCard();
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(png);
  } catch (err) {
    console.error("home og render failed:", err);
    res.status(500).end();
  }
});

/**
 * Head-to-head match history from USTA TennisLink player records.
 * Query: token1, token2 (encrypted TennisLink PlayerIDs from /api/search).
 * Optional name1/name2/city1/state1/... for display + local ranking overlap.
 */
const TOKEN_RE = /^[A-Za-z0-9+/=_-]{8,256}$/;

function requireToken(value, label) {
  const t = String(value ?? "").trim();
  if (!t) throw Object.assign(new Error(`${label} is required`), { status: 400 });
  if (!TOKEN_RE.test(t)) throw Object.assign(new Error(`invalid ${label}`), { status: 400 });
  return t;
}

app.get("/api/h2h", async (req, res) => {
  let token1;
  let token2;
  try {
    token1 = requireToken(req.query.token1 ?? req.query.t1 ?? req.query.player1, "token1");
    token2 = requireToken(req.query.token2 ?? req.query.t2 ?? req.query.player2, "token2");
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (token1 === token2) {
    return res.status(400).json({ error: "Pick two different players" });
  }

  const player1 = {
    token: token1,
    name: req.query.name1 || null,
    city: req.query.city1 || null,
    state: req.query.state1 || null,
  };
  const player2 = {
    token: token2,
    name: req.query.name2 || null,
    city: req.query.city2 || null,
    state: req.query.state2 || null,
  };
  const force = String(req.query.force || "") === "1";

  try {
    const matches = await computeTennisLinkH2H(player1, player2, { force });

    const local1 = findLocalPlayer(player1);
    const local2 = findLocalPlayer(player2);
    let rankings = null;
    if (local1 && local2) {
      rankings = rankingMeetings(local1.id, local2.id);
    }

    res.json({
      ...matches,
      localPlayers: {
        player1: local1 ? { id: local1.id, name: local1.name } : null,
        player2: local2 ? { id: local2.id, name: local2.name } : null,
      },
      rankingMeetings: rankings,
    });
  } catch (err) {
    console.error("h2h failed:", err);
    res.status(502).json({ error: "Head-to-head lookup failed: " + (err?.message || err) });
  }
});

/** Fetch/cache a single player's TennisLink match record (used for prefetch). */
app.get("/api/records", async (req, res) => {
  try {
    const token = requireToken(req.query.token, "token");
    const force = String(req.query.force || "") === "1";
    const data = await getPlayerMatchHistory(token, { force });
    res.json({
      token: data.token,
      playerName: data.playerName,
      residence: data.residence,
      overallWins: data.overallWins,
      overallLosses: data.overallLosses,
      matchCount: data.matches.length,
      cached: data.cached,
      fetchedAt: data.fetchedAt,
    });
  } catch (err) {
    const status = err.status || 502;
    if (status === 400) return res.status(400).json({ error: err.message });
    console.error("record fetch failed:", err);
    res.status(502).json({ error: "Player record fetch failed: " + (err?.message || err) });
  }
});

/** Ranking-list H2H for two locally scraped players. */
app.get("/api/players/:id/h2h/:otherId", (req, res) => {
  const data = rankingMeetings(req.params.id, req.params.otherId);
  if (data.missing) return res.status(404).json({ error: "player not found" });
  res.json(data);
});

// --- static frontend, with per-player OG meta injection ---
const dist = path.join(__dirname, "..", "web", "dist");
const indexHtml = () => fs.readFileSync(path.join(dist, "index.html"), "utf8");

function sendIndex(res, { title, description, image, url } = {}) {
  let html = indexHtml();
  if (title) html = html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  const meta = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Baseline" />`,
    title && `<meta property="og:title" content="${title}" />`,
    description && `<meta property="og:description" content="${description}" />`,
    description && `<meta name="description" content="${description}" />`,
    image && `<meta property="og:image" content="${image}" />`,
    image && `<meta property="og:image:width" content="1200" />`,
    image && `<meta property="og:image:height" content="630" />`,
    url && `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    title && `<meta name="twitter:title" content="${title}" />`,
    image && `<meta name="twitter:image" content="${image}" />`,
  ]
    .filter(Boolean)
    .join("\n    ");
  html = html.replace("</head>", `    ${meta}\n  </head>`);
  res.set("Cache-Control", "no-cache");
  res.send(html);
}

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

app.use(
  express.static(dist, {
    index: false,
    setHeaders(res, file) {
      if (file.includes(`${path.sep}assets${path.sep}`)) {
        res.set("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);

app.get("/player/:id", (req, res) => {
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(req.params.id);
  if (!player) return sendIndex(res);
  const origin = `${req.protocol}://${req.get("host")}`;
  const niceName = player.name.includes(",")
    ? player.name.split(",").map((s) => s.trim()).reverse().join(" ")
    : player.name;
  const bests = bestsForPlayer(player.id);
  const bestStr = bests.map((b) => `#${b.rank} in ${String(b.ageGroup).slice(1)}s`).join(" · ");
  sendIndex(res, {
    title: escAttr(`${niceName} — USTA Junior Ranking History | Baseline`),
    description: escAttr(
      bestStr
        ? `Career-best USTA junior rankings: ${bestStr}. Full ranking history, charted.`
        : `Full USTA junior ranking history, charted by age bracket.`
    ),
    image: `${origin}/api/players/${player.id}/og.png`,
    url: `${origin}/player/${player.id}`,
  });
});

app.get("/h2h/:slug", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  const slug = String(req.params.slug || "");
  const m = slug.match(/^(.+)-vs-(.+)$/i);
  const unslug = (s) =>
    s
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  const titlePair = m ? `${unslug(m[1])} vs ${unslug(m[2])}` : "Head to Head";
  sendIndex(res, {
    title: escAttr(`${titlePair} — Match History | Baseline`),
    description: escAttr(
      `Head-to-head USTA TennisLink match history${m ? ` for ${titlePair}` : ""}. Scores, rounds, and events.`
    ),
    image: `${origin}/api/og.png`,
    url: `${origin}/h2h/${encodeURIComponent(slug)}`,
  });
});

const DEFAULT_DESC =
  "Search two decades of published USTA junior ranking lists and rebuild any player's complete ranking history — best rank per age bracket, charted over time.";

app.get(/^\/(?!api\/).*/, (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  const isH2h = req.path === "/h2h" || req.path === "/h2h/";
  sendIndex(res, {
    title: isH2h ? "Head to Head — Match History | Baseline" : "Baseline — USTA Junior Ranking History",
    description: isH2h
      ? "Compare any two USTA players' TennisLink match history — head-to-head record, scores, and events."
      : DEFAULT_DESC,
    image: `${origin}/api/og.png`,
    url: `${origin}${req.path}`,
  });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`usta-rankings listening on :${port}`));
resumeInterrupted();
