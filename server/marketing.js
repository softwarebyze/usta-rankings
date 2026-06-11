// Growth loop: referrals, event tracking, lead capture, automated social copy.
import { db } from "./db.js";
import { niceNameForDb } from "./util.js";

const insertEvent = db.prepare(
  `INSERT INTO marketing_events (event_type, ref_code, player_id, meta) VALUES (?, ?, ?, ?)`
);
const insertLead = db.prepare(
  `INSERT INTO leads (email, source, ref_code) VALUES (?, ?, ?)
   ON CONFLICT(email) DO UPDATE SET source=excluded.source, ref_code=COALESCE(excluded.ref_code, leads.ref_code)`
);

export function trackEvent(eventType, { refCode = null, playerId = null, meta = null } = {}) {
  insertEvent.run(eventType, refCode, playerId, meta ? JSON.stringify(meta) : null);
}

export function captureLead(email, { source = "landing", refCode = null } = {}) {
  const clean = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Invalid email");
  insertLead.run(clean, source, refCode);
  trackEvent("lead", { refCode, meta: { source } });
  return { ok: true };
}

/** Stable referral code for a player profile share link. */
export function referralForPlayer(playerId) {
  const code = `p${playerId}`;
  db.prepare(
    `INSERT INTO referrals (code, player_id, label) VALUES (?, ?, 'player')
     ON CONFLICT(code) DO NOTHING`
  ).run(code, playerId);
  return code;
}

export function resolveReferral(code) {
  if (!code) return null;
  return db.prepare(`SELECT * FROM referrals WHERE code = ?`).get(code) ?? { code, player_id: null };
}

export function growthStats() {
  const events = db
    .prepare(`SELECT event_type, COUNT(*) c FROM marketing_events GROUP BY event_type ORDER BY c DESC`)
    .all();
  const leads = db.prepare(`SELECT COUNT(*) c FROM leads`).get().c;
  const shares = db.prepare(`SELECT COUNT(*) c FROM marketing_events WHERE event_type='share'`).get().c;
  const scrapes = db.prepare(`SELECT COUNT(*) c FROM marketing_events WHERE event_type='scrape_start'`).get().c;
  const players = db.prepare(`SELECT COUNT(*) c FROM players`).get().c;
  const recent = db
    .prepare(`SELECT event_type, ref_code, player_id, created_at FROM marketing_events ORDER BY id DESC LIMIT 20`)
    .all();
  return { events, leads, shares, scrapes, players, recent };
}

/** Auto-generated social post copy for a player profile. */
export function socialCopy(playerId, origin) {
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
  if (!player) throw new Error("player not found");
  const name = niceNameForDb(player.name);
  const ref = referralForPlayer(playerId);
  const url = `${origin}/player/${playerId}?ref=${ref}`;
  const bests = db
    .prepare(
      `SELECT l.age_group, MIN(r.rank) best, l.year
       FROM rankings r JOIN ranking_lists l ON l.list_id=r.list_id
       WHERE r.player_id=? AND COALESCE(l.discipline,'Singles') IN ('Singles','Combined')
       GROUP BY l.age_group ORDER BY l.age_group`
    )
    .all(playerId);
  const bestLine = bests.map((b) => `#${b.best} in ${String(b.age_group).slice(1)}s`).join(" · ");
  const tweet = `${name}'s full USTA junior ranking history — ${bestLine || "every list, charted"}. Built from official TennisLink data.\n\n${url}\n\n#USTA #JuniorTennis`;
  const linkedin = `I mapped ${name}'s complete USTA junior ranking trajectory (${player.city}, ${player.state}) — career bests: ${bestLine || "see chart"}. Every data point links back to the original published list on TennisLink.\n\n${url}`;
  trackEvent("social_copy", { playerId, refCode: ref });
  return { tweet, linkedin, url, ref, ogImage: `${origin}/api/players/${playerId}/og.png` };
}
