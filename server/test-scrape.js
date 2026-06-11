// Quick verification of the USTA client against known data.
import { UstaSession, searchPlayersForYear, searchRankingLists, findPlayerInList } from "./usta.js";

const s = new UstaSession();
await s.init();

console.log("1) name search 2016...");
const players = await searchPlayersForYear(s, "Ebenfeld", 2016);
console.log(players);
const token = players[0]?.token;

console.log("2) list search FL B18 2016...");
const lists = await searchRankingLists(s, "15", "D1001", 2016);
console.log(`   ${lists.length} lists; first:`, lists[0]);

console.log("3) known snapshots...");
for (const listId of [1626410, 1682666, 1756446]) {
  const { row, listTitle } = await findPlayerInList(s, listId, "Ebenfeld", token);
  console.log(`   list ${listId} (${listTitle}):`, row ? `rank=${row.rank} points=${row.points}` : "NOT FOUND");
}
console.log(`total requests: ${s.requestCount}`);
