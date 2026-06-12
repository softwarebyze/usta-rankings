// Open Graph share-card renderer: builds an SVG in the site's court aesthetic
// and rasterizes it to PNG with resvg (no headless browser needed).
import { Resvg } from "@resvg/resvg-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_FILES = [
  path.join(__dirname, "fonts", "Fraunces-Black.ttf"),
  path.join(__dirname, "fonts", "Archivo-Bold.ttf"),
  path.join(__dirname, "fonts", "Archivo-Regular.ttf"),
].filter((f) => fs.existsSync(f));

const AGE_COLORS = { 10: "#9ad1ff", 12: "#5fd0a5", 14: "#d8e63a", 16: "#e8b54a", 18: "#e07a4f" };

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * player: { name, city, state }
 * bests:  [{ ageGroup: 'B12', rank: 2, year: 2008 }] sorted by bracket
 */
export function renderOgCard(player, bests) {
  const W = 1200;
  const H = 630;

  const name = player.name.includes(",")
    ? player.name.split(",").map((s) => s.trim()).reverse().join(" ")
    : player.name;
  const nameSize = name.length > 24 ? 56 : name.length > 17 ? 68 : 80;

  const cards = bests.slice(0, 5);
  const cardW = cards.length ? Math.min(212, (W - 100 - (cards.length - 1) * 18) / cards.length) : 0;
  const cardH = 190;
  const cardY = H - cardH - 64;
  const totalW = cards.length * cardW + (cards.length - 1) * 18;
  const startX = (W - totalW) / 2;

  const cardSvg = cards
    .map((b, i) => {
      const x = startX + i * (cardW + 18);
      const n = parseInt(String(b.ageGroup).slice(1), 10);
      const color = AGE_COLORS[n] || "#c9c4b4";
      const rankSize = String(b.rank).length > 2 ? 64 : 76;
      return `
      <g>
        <rect x="${x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14" fill="#0a2c21" stroke="rgba(255,255,255,0.14)"/>
        <rect x="${x}" y="${cardY}" width="${cardW}" height="6" rx="3" fill="${color}"/>
        <text x="${x + cardW / 2}" y="${cardY + 52}" text-anchor="middle" font-family="Archivo" font-weight="700" font-size="22" letter-spacing="2" fill="#c9c4b4">${esc(String(b.ageGroup).slice(1))}s</text>
        <text x="${x + cardW / 2}" y="${cardY + 128}" text-anchor="middle" font-family="Fraunces Black" font-size="${rankSize}" fill="${color}">#${esc(b.rank)}</text>
        <text x="${x + cardW / 2}" y="${cardY + 162}" text-anchor="middle" font-family="Archivo" font-size="20" fill="#c9c4b4">${esc(b.year ?? "")}</text>
      </g>`;
    })
    .join("");

  const loc = [player.city, player.state].filter(Boolean).join(", ");

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f3d2e"/>
      <stop offset="1" stop-color="#0a2c21"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="-0.1" r="0.9">
      <stop offset="0" stop-color="#d8e63a" stop-opacity="0.13"/>
      <stop offset="0.6" stop-color="#d8e63a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${[120, 240, 360, 480].map((y) => `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="2"/>`).join("")}
  ${[200, 400, 600, 800, 1000].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(255,255,255,0.05)" stroke-width="2"/>`).join("")}
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <text x="60" y="86" font-family="Fraunces Black" font-size="40" fill="#f4f1e8">Baseline<tspan fill="#d8e63a">.</tspan></text>
  <text x="${W - 60}" y="84" text-anchor="end" font-family="Archivo" font-weight="700" font-size="20" letter-spacing="3" fill="#c9c4b4">USTA JUNIOR RANKING HISTORY</text>
  <line x1="60" y1="112" x2="${W - 60}" y2="112" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>

  <text x="${W / 2}" y="218" text-anchor="middle" font-family="Fraunces Black" font-size="${nameSize}" fill="#f4f1e8">${esc(name)}</text>
  ${loc ? `<text x="${W / 2}" y="262" text-anchor="middle" font-family="Archivo" font-size="26" fill="#c9c4b4">${esc(loc)}</text>` : ""}
  ${cards.length ? `<text x="${W / 2}" y="${cardY - 26}" text-anchor="middle" font-family="Archivo" font-weight="700" font-size="20" letter-spacing="3" fill="#c9c4b4">CAREER-BEST RANKING BY AGE BRACKET</text>` : ""}
  ${cardSvg}
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Archivo" },
  });
  return resvg.render().asPng();
}
