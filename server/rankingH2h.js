import { db } from "./db.js";

function parseDate(published) {
  const m = String(published ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/**
 * Ranking-list meetings: published USTA lists where both scraped players appear.
 * Complements UTR match H2H when players co-existed on the same standing lists.
 */
export function rankingMeetings(playerId1, playerId2) {
  const a = Number(playerId1);
  const b = Number(playerId2);
  if (!a || !b || a === b) return { meetings: [], summary: null };

  const p1 = db.prepare(`SELECT * FROM players WHERE id = ?`).get(a);
  const p2 = db.prepare(`SELECT * FROM players WHERE id = ?`).get(b);
  if (!p1 || !p2) return { meetings: [], summary: null, missing: !p1 ? a : b };

  const rows = db
    .prepare(
      `SELECT l.list_id, l.title, l.age_group, l.list_type, l.variant, l.section,
              l.published_date, l.year,
              r1.rank AS rank1, r1.points AS points1,
              r2.rank AS rank2, r2.points AS points2
       FROM rankings r1
       JOIN rankings r2 ON r2.list_id = r1.list_id AND r2.player_id = ?
       JOIN ranking_lists l ON l.list_id = r1.list_id
       WHERE r1.player_id = ?
       ORDER BY l.published_date DESC`
    )
    .all(b, a);

  const meetings = rows.map((r) => {
    const date = parseDate(r.published_date);
    const leaderId = r.rank1 === r.rank2 ? null : r.rank1 < r.rank2 ? a : b;
    return {
      listId: r.list_id,
      title: r.title,
      ageGroup: r.age_group,
      listType: r.list_type,
      variant: r.variant,
      section: r.section,
      date,
      year: r.year,
      player1Rank: r.rank1,
      player2Rank: r.rank2,
      player1Points: r.points1,
      player2Points: r.points2,
      higherRankedId: leaderId,
      rankDelta: Math.abs(r.rank1 - r.rank2),
    };
  });

  const p1Ahead = meetings.filter((m) => m.higherRankedId === a).length;
  const p2Ahead = meetings.filter((m) => m.higherRankedId === b).length;
  const ties = meetings.filter((m) => m.higherRankedId == null).length;

  return {
    player1: { id: p1.id, name: p1.name, city: p1.city, state: p1.state },
    player2: { id: p2.id, name: p2.name, city: p2.city, state: p2.state },
    summary: {
      meetings: meetings.length,
      player1Ahead: p1Ahead,
      player2Ahead: p2Ahead,
      ties,
    },
    meetings,
  };
}

/** Best-effort: match a display name + optional city/state to a local scraped player. */
export function findLocalPlayer({ name, city, state }) {
  const players = db.prepare(`SELECT * FROM players`).all();
  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const target = norm(name);
  if (!target) return null;

  const flipped = (n) => {
    if (!n.includes(",")) return norm(n);
    const [last, first] = n.split(",").map((x) => x.trim());
    return norm(`${first} ${last}`);
  };

  const exact = players.filter((p) => flipped(p.name) === target);
  const candidates = exact.length
    ? exact
    : players.filter((p) => {
        const pn = flipped(p.name);
        return pn.startsWith(`${target} `) || pn.endsWith(` ${target}`) || pn.includes(` ${target} `);
      });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const cityN = norm(city);
  const stateN = norm(state);
  const stateAbbrev = {
    florida: "fl",
    texas: "tx",
    california: "ca",
    "new york": "ny",
    illinois: "il",
    georgia: "ga",
    ohio: "oh",
    michigan: "mi",
    pennsylvania: "pa",
    "north carolina": "nc",
    "south carolina": "sc",
  };
  const stateWant = stateAbbrev[stateN] || stateN.slice(0, 2);
  const scored = candidates
    .map((p) => {
      let score = 0;
      if (cityN && norm(p.city) === cityN) score += 2;
      if (stateWant && norm(p.state).startsWith(stateWant)) score += 1;
      return { p, score };
    })
    .sort((x, y) => y.score - x.score);
  return scored[0].p;
}
