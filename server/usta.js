// Pure-HTTP client for the legacy USTA TennisLink rankings site (ASP.NET
// WebForms + MS AJAX UpdatePanels). No headless browser required: we keep a
// form-state "session" and replay the async postbacks the page JS would send.
import { BASE_URL, USER_AGENT, REQUEST_DELAY_MS } from "./constants.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export class UstaSession {
  constructor() {
    this.cookies = new Map();
    this.fields = {};
    this.selects = {};
    this.ready = false;
    this.requestCount = 0;
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  storeCookies(res) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookies) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  absorbHtml(doc) {
    for (const m of doc.matchAll(/<input[^>]*name="([^"]+)"[^>]*>/gi)) {
      const tag = m[0];
      const name = decodeEntities(m[1]);
      const type = (tag.match(/type="([^"]*)"/i)?.[1] || "text").toLowerCase();
      if (["submit", "button", "image"].includes(type)) continue;
      if (["checkbox", "radio"].includes(type)) {
        if (/checked/i.test(tag)) {
          this.fields[name] = decodeEntities(tag.match(/value="([^"]*)"/i)?.[1] ?? "on");
        }
        continue;
      }
      this.fields[name] = decodeEntities(tag.match(/value="([^"]*)"/i)?.[1] ?? "");
    }
    for (const m of doc.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
      const name = decodeEntities(m[1]);
      const body = m[2];
      const opts = [...body.matchAll(/<option[^>]*value=['"]([^'"]*)['"][^>]*>([^<]*)/gi)].map(
        (o) => [decodeEntities(o[1]), decodeEntities(o[2]).trim()]
      );
      this.selects[name] = opts;
      const sel =
        body.match(/<option[^>]*selected[^>]*value=['"]([^'"]*)['"]/i) ||
        body.match(/<option[^>]*value=['"]([^'"]*)['"][^>]*selected/i);
      this.fields[name] = sel ? decodeEntities(sel[1]) : opts[0]?.[0] ?? "";
    }
  }

  // Parse MS AJAX delta response: len|type|id|content| ...
  absorbDelta(delta) {
    let i = 0;
    const panels = [];
    while (i < delta.length) {
      const m = /^(\d+)\|([^|]*)\|([^|]*)\|/.exec(delta.slice(i, i + 4000));
      if (!m) break;
      const len = parseInt(m[1], 10);
      const [, , type, id] = m;
      const start = i + m[0].length;
      const content = delta.slice(start, start + len);
      if (type === "hiddenField") this.fields[id] = content;
      else if (type === "updatePanel") {
        this.absorbHtml(content);
        panels.push({ id, content });
      } else if (type === "pageRedirect") {
        throw new Error(`unexpected pageRedirect: ${content}`);
      }
      i = start + len + 1;
    }
    return panels;
  }

  async init() {
    const res = await fetch(BASE_URL, { headers: { "User-Agent": USER_AGENT } });
    this.storeCookies(res);
    const html = await res.text();
    this.fields = {};
    this.selects = {};
    this.absorbHtml(html);
    this.ready = true;
  }

  async post(trigger, { eventTarget = "", eventArgument = "", extra = {} } = {}) {
    if (!this.ready) await this.init();
    await sleep(REQUEST_DELAY_MS);
    const f = { ...this.fields };
    f["ctl00$ScriptManager1"] = `ctl00$mainContent$UpdatePanel_RankingHome|${trigger}`;
    f["__EVENTTARGET"] = eventTarget;
    f["__EVENTARGUMENT"] = eventArgument;
    f["__ASYNCPOST"] = "true";
    Object.assign(f, extra);
    const body = new URLSearchParams(f).toString();
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "X-MicrosoftAjax": "Delta=true",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: BASE_URL,
        Cookie: this.cookieHeader(),
      },
      body,
    });
    this.storeCookies(res);
    const text = await res.text();
    this.requestCount++;
    if (!res.ok) throw new Error(`USTA postback failed: HTTP ${res.status}`);
    if (text.includes("|error|")) throw new Error("USTA postback returned server error");
    this.absorbDelta(text);
    return text;
  }
}

// ---------- High-level operations ----------

/** Search players by name for a given year. Returns matches with stable encrypted token. */
export async function searchPlayersForYear(session, name, year) {
  const resp = await session.post("ctl00$mainContent$btnSearch_PlayerRanking", {
    extra: {
      "ctl00$mainContent$txtRankingPlayerName": name,
      "ctl00$mainContent$ddlYearRanking": String(year),
      "ctl00$mainContent$btnSearch_PlayerRanking": "SEARCH",
    },
  });
  const players = [];
  const rowRe =
    /Sender=PlayerListsRow&(?:amp;)?Type=Rankings&(?:amp;)?PlayerId=([^&']*)&[^']*'\);?">([^<]+)<\/a><\/span>\s*<\/td><td>\s*<span[^>]*lblCity">([^<]*)<\/span>\s*<\/td><td>\s*<span[^>]*lblState">([^<]*)<\/span>/g;
  for (const m of resp.matchAll(rowRe)) {
    players.push({
      token: decodeEntities(m[1]),
      name: decodeEntities(m[2]).trim(),
      city: decodeEntities(m[3]).trim(),
      state: decodeEntities(m[4]).trim(),
      year,
    });
  }
  return players;
}

/** Find all ranking lists for a (sectionCode, divisionCode, year). */
export async function searchRankingLists(session, sectionCode, divisionCode, year) {
  const resp = await session.post("ctl00$mainContent$btnSearch_Ranking", {
    extra: {
      "ctl00$mainContent$SectionDistrict": sectionCode,
      "ctl00$mainContent$Division": divisionCode,
      "ctl00$mainContent$Year": String(year),
      "ctl00$mainContent$ListType": "-1",
      "ctl00$mainContent$btnSearch_Ranking": "FIND IT!",
    },
  });
  const lists = [];
  // rows: <td>Division</td><td>Month</td><td><a ...id=N>Title</a></td><td>MM/DD/YYYY</td>
  const rowRe =
    /<td>([^<]*)<\/td><td>([^<]*)<\/td><td><a href="javascript:__doPostBack\('ctl00_mainContent_UpdatePanel_RankingHome', 'Sender=RankingList&(?:amp;)?type=searchresults&(?:amp;)?id=(\d+)'\)">([^<]*)<\/a><\/td><td>([^<]*)<\/td>/g;
  for (const m of resp.matchAll(rowRe)) {
    lists.push({
      divisionLabel: decodeEntities(m[1]).trim(),
      month: decodeEntities(m[2]).trim(),
      listId: parseInt(m[3], 10),
      title: decodeEntities(m[4]).trim(),
      publishedDate: decodeEntities(m[5]).trim(),
    });
  }
  return lists;
}

function parsePlayerRows(html) {
  const rows = [];
  const re =
    /lblRank">([^<]*)<\/span>[\s\S]{0,400}?Sender=PlayerRecords&(?:amp;)?id=(\d+)&(?:amp;)?p=(\d+)&(?:amp;)?PlayerID=([^&']*)&(?:amp;)?Type=viewranklist'\)">([^<]*)<\/a>[\s\S]{0,300}?lblCity">([^<]*)<\/span>[\s\S]{0,300}?lblState">([^<]*)<\/span>[\s\S]{0,300}?lblSection">([^<]*)<\/span>[\s\S]{0,300}?lblDistrict">([^<]*)<\/span>[\s\S]{0,300}?lblPoints">([^<]*)<\/span>/g;
  for (const m of html.matchAll(re)) {
    rows.push({
      rank: parseInt(m[1].trim(), 10),
      listId: parseInt(m[2], 10),
      rowP: parseInt(m[3], 10),
      token: decodeURIComponent(decodeEntities(m[4])),
      name: decodeEntities(m[5]).trim(),
      city: decodeEntities(m[6]).trim(),
      state: decodeEntities(m[7]).trim(),
      section: decodeEntities(m[8]).trim(),
      district: decodeEntities(m[9]).trim(),
      points: parseInt(m[10].trim().replace(/,/g, ""), 10),
    });
  }
  return rows;
}

/**
 * Open a ranking list and find a player's row by encrypted token (or last name).
 * Uses the list page's "filter by last-name letter" to avoid paging through ranks.
 * Returns { row, listTitle } — row is null if the player isn't on the list.
 */
export async function findPlayerInList(session, listId, lastName, token) {
  const open = await session.post("ctl00_mainContent_UpdatePanel_RankingHome", {
    eventTarget: "ctl00_mainContent_UpdatePanel_RankingHome",
    eventArgument: `Sender=RankingList&type=searchresults&id=${listId}`,
  });
  const listTitle = open.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/)?.[1]?.trim() ?? null;
  const match = (rows) =>
    rows.find((r) => (token ? r.token === token : r.name.toLowerCase().startsWith(lastName.toLowerCase())));

  let row = match(parsePlayerRows(open));
  if (row) return { row, listTitle };

  // Switch ordering to "by name", then jump to the player's letter.
  const byName = await session.post("ctl00$mainContent$optNameOrder", {
    eventTarget: "ctl00$mainContent$optNameOrder",
    extra: { "ctl00$mainContent$optOrder": "optNameOrder" },
  });
  row = match(parsePlayerRows(byName));
  if (row) return { row, listTitle };

  const letter = lastName[0].toUpperCase();
  const ranges = session.selects["ctl00$mainContent$cboOrderOption"] ?? [];
  if (!ranges.some(([v]) => v.toUpperCase() === letter)) return { row: null, listTitle };

  let resp = await session.post("ctl00$mainContent$cboOrderOption", {
    eventTarget: "ctl00$mainContent$cboOrderOption",
    extra: { "ctl00$mainContent$cboOrderOption": letter },
  });
  row = match(parsePlayerRows(resp));
  if (row) return { row, listTitle };

  // Page through additional pages within the letter, if any (grid pager links).
  for (let page = 2; page <= 12; page++) {
    const pagerRe = new RegExp(
      `__doPostBack\\('(ctl00\\$mainContent\\$grdMain2)','(Page\\$${page})'\\)`
    );
    const pm = resp.match(pagerRe);
    if (!pm) break;
    resp = await session.post(pm[1], { eventTarget: pm[1], eventArgument: pm[2] });
    row = match(parsePlayerRows(resp));
    if (row) return { row, listTitle };
  }
  return { row: null, listTitle };
}
