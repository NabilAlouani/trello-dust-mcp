// Restores the board for a new demo run: archives everything a demo left behind, wherever it ended up,
// keeps the seeded cards outside Inbox so they go on aging, and recreates the Inbox tickets.
// Run: npm run reset

import { trello, loadBoard, createTicket, readTickets, readState, writeState } from "./trello.js";

// ---------- 1. Load ----------

const state = await readState().catch(() => {
  console.error("seed/state.json not found. Run npm run seed first.");
  process.exit(1);
});
const board = await loadBoard(state.board.id);
const { tickets } = await readTickets();

// ---------- 2. Archive everything except the seeded aged cards ----------

// A demo run moves Inbox tickets to Waiting on customer or Done, so clearing Inbox and Triage is not enough.
const keep = new Set(tickets.filter((t) => t.list !== "Inbox").map((t) => state.cards[t.key]));
const open = await trello<{ id: string }[]>(`/boards/${board.id}/cards?fields=name`);
let archived = 0;
for (const c of open) {
  if (keep.has(c.id)) continue;
  await trello(`/cards/${c.id}`, "PUT", { closed: true });
  archived++;
}

// ---------- 3. Recreate the Inbox tickets ----------

const inbox = tickets.filter((t) => t.list === "Inbox");
for (const t of inbox) state.cards[t.key] = await createTicket(board, t);

// ---------- 4. State and summary ----------

await writeState(state);
console.log(`Archived ${archived} cards, kept ${keep.size} seeded cards, recreated ${inbox.length} Inbox tickets. Board: ${state.board.url}`);
