import express from "express";
import compression from "compression";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, upsertPlayer } from "./db.js";
import { searchPlayerAllYears } from "./search.js";
import { enqueueScrape, resumeInterrupted } from "./scraper.js";
import { renderOgCard } from "./og.js";
import { trackEvent, captureLead, growthStats, socialCopy, referralForPlayer } from "./marketing.js";
import { pricingInfo, exportRankingsCsv, proCheckoutUrl } from "./monetize.js";

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
  const { token, name, city, state, years, ref } = req.body ?? {};
  if (!token || !name) return res.status(400).json({ error: "token and name required" });
  const player = upsertPlayer({ token, name, city, state });
  if (Array.isArray(years) && years.length) {
    db.prepare(`UPDATE players SET years=? WHERE id=?`).run(JSON.stringify(years), player.id);
  }
  trackEvent("scrape_start", { refCode: ref || null, playerId: player.id });
  const jobId = enqueueScrape(player.id);
  res.json({ jobId, playerId: player.id, ref: referralForPlayer(player.id) });
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
      `SELECT r.rank, r.points, r.district, r.row_p,
              l.list_id, l.title, l.age_group, l.discipline, l.list_type, l.variant, l.section, l.published_date, l.year, l.month
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

// career-best singles rank per age bracket, used by the OG card + meta tags
function bestsForPlayer(playerId) {
  const rows = db
    .prepare(
      `SELECT r.rank, l.age_group, l.year, l.published_date
       FROM rankings r JOIN ranking_lists l ON l.list_id = r.list_id
       WHERE r.player_id = ? AND COALESCE(l.discipline,'Singles') IN ('Singles','Combined')`
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

// --- marketing & monetization ---

app.post("/api/leads", (req, res) => {
  try {
    captureLead(req.body?.email, { source: req.body?.source, refCode: req.body?.ref });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/events", (req, res) => {
  const { type, ref, playerId, meta } = req.body ?? {};
  if (!type) return res.status(400).json({ error: "type required" });
  trackEvent(type, { refCode: ref, playerId, meta });
  res.json({ ok: true });
});

app.get("/api/marketing/stats", (_req, res) => {
  res.json(growthStats());
});

app.get("/api/players/:id/social", (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json(socialCopy(req.params.id, origin));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get("/api/pricing", (req, res) => {
  res.json(pricingInfo(`${req.protocol}://${req.get("host")}`));
});

app.get("/api/players/:id/export.csv", (req, res) => {
  try {
    const csv = exportRankingsCsv(req.params.id);
    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", `attachment; filename="rankings-${req.params.id}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(402).json({ error: err.message, checkoutUrl: proCheckoutUrl(`${req.protocol}://${req.get("host")}`) });
  }
});

app.get("/r/:code", (req, res) => {
  trackEvent("referral_click", { refCode: req.params.code });
  res.redirect(`/?ref=${encodeURIComponent(req.params.code)}`);
});

app.get("/sitemap.xml", (_req, res) => {
  const players = db.prepare(`SELECT id, last_scraped_at FROM players ORDER BY id`).all();
  const origin = process.env.SITE_URL || "https://usta-rankings.fly.dev";
  const urls = ["/", "/compare", "/about", "/pricing", "/growth", ...players.map((p) => `/player/${p.id}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join("\n")}
</urlset>`;
  res.type("application/xml").send(xml);
});

app.get("/robots.txt", (_req, res) => {
  const origin = process.env.SITE_URL || "https://usta-rankings.fly.dev";
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
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
      // Vite emits content-hashed filenames under /assets — cache them forever.
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

const DEFAULT_DESC =
  "Search two decades of published USTA junior ranking lists and rebuild any player's complete ranking history — best rank per age bracket, charted over time.";

app.get(/^\/(?!api\/).*/, (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  sendIndex(res, {
    title: "Baseline — USTA Junior Ranking History",
    description: DEFAULT_DESC,
    url: `${origin}${req.path}`,
  });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`usta-rankings listening on :${port}`));
resumeInterrupted();
