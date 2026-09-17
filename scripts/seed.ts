// Creates the demo board from seed/tickets.json. Always creates a new board; it never looks for an old one.
// Run: npm run seed

import { trello, loadBoard, createTicket, readTickets, writeState } from "./trello.js";

// ---------- 1. Board definition ----------

const LISTS = ["Inbox", "Triage", "In progress", "Waiting on customer", "Done"];
const LABELS: Record<string, string> = { bug: "red", billing: "yellow", feature: "purple", question: "blue", blocked: "black" };
const FIELDS: { name: string; type: "list" | "text"; options?: string[] }[] = [
  { name: "Priority", type: "list", options: ["P1", "P2", "P3"] },
  { name: "Category", type: "list", options: ["Billing", "API", "Integration", "Account"] },
  { name: "Customer", type: "text" },
  { name: "Agent status", type: "text" },
];

// ---------- 2. Board and custom fields ----------

const { board: boardName, tickets } = await readTickets();

const created = await trello<{ id: string; shortUrl: string }>("/boards", "POST", {
  name: boardName,
  defaultLists: false,
  defaultLabels: false,
  prefs_permissionLevel: "private",
});
// The create response has no shortLink field; the last segment of shortUrl is the same value.
const board = { id: created.id, shortUrl: created.shortUrl, shortLink: created.shortUrl.split("/").pop()! };
console.log(`Board created: ${board.shortUrl}`);

// Custom Fields is a native Trello feature. Fields come first so a 403 stops the run before anything else exists.
for (const [i, f] of FIELDS.entries()) {
  try {
    await trello("/customFields", "POST", {
      idModel: board.id,
      modelType: "board",
      name: f.name,
      type: f.type,
      pos: i + 1,
      display_cardFront: true,
      options: f.options?.map((text, pos) => ({ value: { text }, color: "none", pos })),
    });
  } catch (e) {
    if ((e as { status?: number }).status !== 403) throw e;
    console.error(`Trello refused to create custom fields (403).\nEnable Custom Fields by hand on ${board.shortUrl} (board menu > Custom Fields), then tell me: the seed needs a way to continue on that board.`);
    process.exit(1);
  }
}
console.log(`Custom fields: ${FIELDS.map((f) => f.name).join(", ")}`);

// ---------- 3. Lists and labels ----------

// pos bottom keeps the order of LISTS.
for (const name of LISTS) await trello("/lists", "POST", { name, idBoard: board.id, pos: "bottom" });
console.log(`Lists: ${LISTS.join(", ")}`);

for (const [name, color] of Object.entries(LABELS)) await trello("/labels", "POST", { name, color, idBoard: board.id });
console.log(`Labels: ${Object.keys(LABELS).join(", ")}`);

// ---------- 4. Cards ----------

const ctx = await loadBoard(board.id);
const cards: Record<string, string> = {};
for (const t of tickets) {
  cards[t.key] = await createTicket(ctx, t);
  console.log(`  ${t.key} [${t.list}] ${t.name}`);
}

// ---------- 5. State and next steps ----------

await writeState({ board: { id: board.id, shortLink: board.shortLink, url: board.shortUrl }, cards });

console.log(`
Done: ${tickets.length} cards on ${board.shortUrl}
Add this line to .env:
  TRELLO_BOARD=${board.shortLink}

Timing: Trello sets dateLastActivity itself, so cards only become stale by aging.
Seed at least three days before the demo and do not touch the Waiting on customer cards.
`);
