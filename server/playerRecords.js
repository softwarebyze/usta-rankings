// TennisLink archived player match records (RankingHome → PlayerListsRow).
import { UstaSession } from "./usta.js";
import { db } from "./db.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function getUpdatePanels(delta) {
  let i = 0;
  const panels = [];
  while (i < delta.length) {
    const m = /^(\d+)\|([^|]*)\|([^|]*)\|/.exec(delta.slice(i, i + 4000));
    if (!m) break;
    const len = parseInt(m[1], 10);
    const type = m[2];
    const id = m[3];
    const start = i + m[0].length;
    const content = delta.slice(start, start + len);
    if (type === "updatePanel") panels.push({ id, content });
    i = start + len + 1;
  }
  return panels;
}

function recordHtmlFromDelta(delta) {
  const panels = getUpdatePanels(delta);
  const preferred =
    panels.find((p) => /PlayerRecord/i.test(p.id)) ||
    panels.find((p) => /RankingHome/i.test(p.id)) ||
    panels[0];
  if (preferred?.content) return preferred.content;
  return panels.map((p) => p.content).join("\n");
}

function parseMdY(dateStr) {
  const m = String(dateStr ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function inferSingles(eventTitle, partner) {
  if (partner) return false;
  const t = String(eventTitle || "");
  if (/\bDoubles\b/i.test(t) || /\([A-Za-z]*d\)/i.test(t) || /Opd\b/i.test(t)) return false;
  return true;
}

/**
 * Parse the TennisLink player-record HTML into structured matches.
 */
export function parsePlayerRecordHtml(html) {
  const boldCells = [...html.matchAll(/<td class="bold">\s*([\s\S]*?)\s*<\/td>/gi)].map((m) =>
    decodeEntities(m[1]).replace(/\s+/g, " ").trim()
  );
  // Header value row: name | date range | W - L | residence
  let playerName = null;
  let overallWins = null;
  let overallLosses = null;
  let residence = null;
  if (boldCells.length >= 4) {
    playerName = boldCells[0] || null;
    const rec = boldCells[2].match(/^(\d+)\s*-\s*(\d+)$/);
    if (rec) {
      overallWins = parseInt(rec[1], 10);
      overallLosses = parseInt(rec[2], 10);
    }
    residence = boldCells[3] || null;
  } else {
    const textHead = decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    const rec = textHead.match(/(\d+)\s*-\s*(\d+)/);
    if (rec) {
      overallWins = parseInt(rec[1], 10);
      overallLosses = parseInt(rec[2], 10);
    }
  }

  const parts = html.split(/<span class="event_title"[^>]*>/i);
  const matches = [];

  for (const part of parts.slice(1)) {
    const titleRaw = part.match(/^([\s\S]*?)(?:<a\b|<\/span>)/)?.[1] ?? "";
    const eventName = decodeEntities(titleRaw).replace(/\s+/g, " ").trim();
    const dateRaw = part.match(/class="event_date">([^<]+)/i)?.[1];
    const date = parseMdY(dateRaw);
    const drawMatch = part.match(/ViewDraw\((\d+)\s*,\s*(\d+)\)/i);
    const drawId = drawMatch ? parseInt(drawMatch[1], 10) : null;
    const eventCode = drawMatch ? parseInt(drawMatch[2], 10) : null;

    const partnerMatch = part.match(/Partner Name:<\/strong>\s*([^<]+)/i);
    const partner = partnerMatch ? decodeEntities(partnerMatch[1]).replace(/\s+/g, " ").trim() : null;

    // Each match row: Round | Result | Opponent cell | Score
    const rowRe =
      /<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/gi;
    for (const m of part.matchAll(rowRe)) {
      const round = decodeEntities(m[1]).trim();
      const result = decodeEntities(m[2]).trim();
      const oppHtml = m[3];
      const score = decodeEntities(m[4]).trim();
      if (result !== "Win" && result !== "Loss") continue;

      const oppLinks = [...oppHtml.matchAll(/PlayerID=([^"']+)"[^>]*>([^<]+)</gi)].map((x) => ({
        token: decodeEntities(x[1]),
        name: decodeEntities(x[2]).trim(),
      }));
      let opponentName;
      let opponentToken = null;
      if (oppLinks.length >= 1) {
        opponentName = oppLinks.map((o) => o.name).join(" / ");
        opponentToken = oppLinks[0].token;
      } else {
        opponentName = decodeEntities(oppHtml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      }
      if (!opponentName || /^bye$/i.test(opponentName)) continue;

      matches.push({
        date,
        eventName,
        round,
        result,
        score,
        opponentName,
        opponentToken,
        opponentTokens: oppLinks.map((o) => o.token),
        partner,
        singles: inferSingles(eventName, partner),
        drawId,
        eventCode,
      });
    }
  }

  matches.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return {
    playerName,
    residence,
    overallWins,
    overallLosses,
    matches,
  };
}

function cacheMeta(token) {
  return db.prepare(`SELECT * FROM player_records WHERE token = ?`).get(token);
}

function cacheFresh(row) {
  if (!row?.fetched_at) return false;
  const ms = Date.parse(String(row.fetched_at).replace(" ", "T") + "Z");
  return Number.isFinite(ms) && Date.now() - ms < CACHE_TTL_MS;
}

function loadCachedMatches(token) {
  return db
    .prepare(
      `SELECT date, event_name AS eventName, round, result, score,
              opponent_name AS opponentName, opponent_token AS opponentToken,
              opponent_tokens AS opponentTokensJson,
              partner, singles, draw_id AS drawId
       FROM match_results WHERE player_token = ? ORDER BY date DESC`
    )
    .all(token)
    .map((r) => {
      let opponentTokens = [];
      if (r.opponentTokensJson) {
        try {
          opponentTokens = JSON.parse(r.opponentTokensJson);
        } catch {
          opponentTokens = [];
        }
      }
      if (!opponentTokens.length && r.opponentToken) opponentTokens = [r.opponentToken];
      return {
        date: r.date,
        eventName: r.eventName,
        round: r.round,
        result: r.result,
        score: r.score,
        opponentName: r.opponentName,
        opponentToken: r.opponentToken,
        opponentTokens,
        partner: r.partner,
        singles: !!r.singles,
        drawId: r.drawId,
      };
    });
}

function saveRecord(token, parsed) {
  if (parsed.matches.length === 0) {
    const prior = db.prepare(`SELECT COUNT(*) AS n FROM match_results WHERE player_token = ?`).get(token);
    if (prior?.n > 0) {
      throw new Error("player record parsed to zero matches; keeping cached record");
    }
  }
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO player_records (token, name, residence, overall_wins, overall_losses, match_count, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(token) DO UPDATE SET
         name=excluded.name, residence=excluded.residence,
         overall_wins=excluded.overall_wins, overall_losses=excluded.overall_losses,
         match_count=excluded.match_count, fetched_at=excluded.fetched_at`
    ).run(
      token,
      parsed.playerName,
      parsed.residence,
      parsed.overallWins,
      parsed.overallLosses,
      parsed.matches.length
    );
    db.prepare(`DELETE FROM match_results WHERE player_token = ?`).run(token);
    const ins = db.prepare(
      `INSERT INTO match_results
        (player_token, date, event_name, round, result, score, opponent_name, opponent_token, opponent_tokens, partner, singles, draw_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const m of parsed.matches) {
      const tokens = m.opponentTokens?.length ? m.opponentTokens : m.opponentToken ? [m.opponentToken] : [];
      ins.run(
        token,
        m.date,
        m.eventName,
        m.round,
        m.result,
        m.score,
        m.opponentName,
        m.opponentToken || tokens[0] || null,
        tokens.length ? JSON.stringify(tokens) : null,
        m.partner,
        m.singles ? 1 : 0,
        m.drawId
      );
    }
  });
  tx();
}

const inflight = new Map();

/** Fetch (or return cached) full TennisLink match history for a player token. */
export async function getPlayerMatchHistory(token, { force = false } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("player token required");

  const meta = cacheMeta(t);
  if (!force && cacheFresh(meta)) {
    return {
      token: t,
      playerName: meta.name,
      residence: meta.residence,
      overallWins: meta.overall_wins,
      overallLosses: meta.overall_losses,
      matches: loadCachedMatches(t),
      cached: true,
      fetchedAt: meta.fetched_at,
    };
  }

  const key = `${t}|${force ? "1" : "0"}`;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    const session = new UstaSession();
    await session.init();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      // UstaSession.post doesn't take AbortSignal yet; bound overall wait with Promise.race
      const delta = await Promise.race([
        session.post("ctl00_mainContent_UpdatePanel_RankingHome", {
          eventTarget: "ctl00_mainContent_UpdatePanel_RankingHome",
          eventArgument: `Sender=PlayerListsRow&Type=Rankings&PlayerId=${t}`,
        }),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error("TennisLink record fetch timed out after 120s"))
          );
        }),
      ]);
      const html = recordHtmlFromDelta(delta);
      if (!html || html.length < 500) {
        throw new Error("TennisLink returned an empty player record");
      }
      const parsed = parsePlayerRecordHtml(html);
      saveRecord(t, parsed);
      return {
        token: t,
        playerName: parsed.playerName,
        residence: parsed.residence,
        overallWins: parsed.overallWins,
        overallLosses: parsed.overallLosses,
        matches: parsed.matches,
        cached: false,
        fetchedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

function normName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a, b) {
  const keys = (name) => {
    const n = normName(name);
    const out = new Set();
    if (!n) return out;
    out.add(n);
    if (n.includes(" ")) {
      // "last, first" style already normalized without comma
      const parts = n.split(" ");
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        const first = parts.slice(0, -1).join(" ");
        out.add(`${first} ${last}`);
        out.add(`${last} ${first}`);
        out.add(`${last} ${parts[0]}`);
      }
    }
    return out;
  };
  // Also accept "Last, First"
  const expand = (name) => {
    const set = keys(name);
    const raw = String(name || "");
    if (raw.includes(",")) {
      const [last, first] = raw.split(",").map((s) => normName(s));
      if (last && first) {
        set.add(`${first} ${last}`);
        set.add(`${last} ${first}`);
        set.add(normName(`${last} ${first}`));
      }
    }
    return set;
  };
  const A = expand(a);
  const B = expand(b);
  for (const x of A) if (B.has(x)) return true;
  return false;
}

function isAgainst(match, opponentToken, opponentName) {
  if (opponentToken) {
    const tokens = match.opponentTokens?.length
      ? match.opponentTokens
      : match.opponentToken
        ? [match.opponentToken]
        : [];
    if (tokens.some((t) => t === opponentToken)) return true;
  }
  if (opponentName && namesMatch(match.opponentName, opponentName)) return true;
  // doubles: "Smith, A / Kast, Jourdan"
  if (opponentName) {
    const parts = String(match.opponentName).split(/\s*\/\s*/);
    if (parts.some((p) => namesMatch(p, opponentName))) return true;
  }
  return false;
}

/**
 * Head-to-head from TennisLink player records.
 * Uses player1's record filtered to meetings vs player2 (token and/or name).
 */
export async function computeTennisLinkH2H(player1, player2, { force = false } = {}) {
  const a = await getPlayerMatchHistory(player1.token, { force });
  // Warm player2 cache in parallel for symmetry / future use
  const bPromise = getPlayerMatchHistory(player2.token, { force }).catch(() => null);
  const b = await bPromise;

  const name1 = player1.name || a.playerName || "Player 1";
  const name2 = player2.name || b?.playerName || "Player 2";

  const meetings = a.matches.filter((m) => isAgainst(m, player2.token, name2));

  // Also pull from player2 side in case of parse gaps; key without score orientation.
  if (b?.matches) {
    const keyOf = (m) => `${m.date}|${m.drawId ?? ""}|${m.eventName}|${m.round}`;
    const keys = new Set(meetings.map(keyOf));
    for (const m of b.matches) {
      if (!isAgainst(m, player1.token, name1)) continue;
      const flipped = {
        ...m,
        result: m.result === "Win" ? "Loss" : m.result === "Loss" ? "Win" : m.result,
        opponentName: name2,
        opponentToken: player2.token,
        partner: null,
      };
      const key = keyOf(flipped);
      if (!keys.has(key)) {
        keys.add(key);
        meetings.push(flipped);
      }
    }
  }

  meetings.sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));

  const singles = meetings.filter((m) => m.singles);
  const doubles = meetings.filter((m) => !m.singles);
  const recordFor = (list) => {
    const wins = list.filter((m) => m.result === "Win").length;
    const losses = list.filter((m) => m.result === "Loss").length;
    return { player1Wins: wins, player2Wins: losses, meetings: list.length };
  };

  return {
    player1: {
      token: player1.token,
      name: name1,
      city: player1.city || null,
      state: player1.state || null,
      residence: a.residence,
      overallRecord: a.overallWins != null ? `${a.overallWins}-${a.overallLosses}` : null,
    },
    player2: {
      token: player2.token,
      name: name2,
      city: player2.city || null,
      state: player2.state || null,
      residence: b?.residence || null,
      overallRecord: b?.overallWins != null ? `${b.overallWins}-${b.overallLosses}` : null,
    },
    record: recordFor(meetings),
    singlesRecord: recordFor(singles),
    doublesRecord: recordFor(doubles),
    matches: meetings.map((m) => ({
      date: m.date,
      eventName: m.eventName,
      drawName: m.round ? `Round ${m.round}` : null,
      round: m.round,
      score: m.score,
      singles: m.singles,
      partner: m.partner,
      player1Won: m.result === "Win",
      winnerName: m.result === "Win" ? name1 : name2,
      drawId: m.drawId,
    })),
    source: "USTA TennisLink",
    cached: !!(a.cached && b?.cached),
  };
}
