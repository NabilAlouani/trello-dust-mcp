// trello-dust-mcp: an MCP server that lets a Dust agent work a Trello support board.
// Sections: 1 configuration, 2 Trello client and cache, 3 shaping, 4 tools, 5 HTTP.

import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---------- 1. Configuration ----------

// Local runs read .env; Docker and Railway inject the variables, so a missing file is fine.
try { process.loadEnvFile(); } catch { /* no .env file */ }

const REQUIRED = ["TRELLO_KEY", "TRELLO_TOKEN", "TRELLO_BOARD", "MCP_BEARER"] as const;
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const cfg = {
  KEY: process.env.TRELLO_KEY!,
  TOKEN: process.env.TRELLO_TOKEN!,
  BOARD: process.env.TRELLO_BOARD!,
  BEARER: process.env.MCP_BEARER!,
  PORT: Number(process.env.PORT ?? 3000),
};

// ---------- 2. Trello client and cache ----------

const TRELLO = "https://api.trello.com/1";

interface List { id: string; name: string }
interface CustomFieldOption { id: string; value: { text: string } }
interface CustomField {
  id: string;
  name: string;
  type: "list" | "text" | "number" | "date" | "checkbox";
  options?: CustomFieldOption[];
}
interface CustomFieldItem {
  idCustomField: string;
  idValue?: string;
  value?: { text?: string; number?: string; date?: string; checked?: string };
}
interface Card {
  id: string;
  shortLink: string;
  name: string;
  desc: string;
  url: string;
  idList: string;
  due: string | null;
  dateLastActivity: string;
  labels: { name: string; color: string }[];
  members?: { username: string; fullName: string }[];
  customFieldItems?: CustomFieldItem[];
}
interface Action { id: string; date: string; data: { text?: string }; memberCreator: { username: string } }
interface Attachment { id: string; name: string; url: string; mimeType: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One entry point for every Trello call. Auth goes in the query string, as Trello expects.
async function trello<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const url = `${TRELLO}${path}${path.includes("?") ? "&" : "?"}key=${cfg.KEY}&token=${cfg.TOKEN}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    // Trello rate limits per token; a short wait absorbs a burst of tool calls.
    if (res.status === 429 && attempt < 3) { await sleep(1000 * (attempt + 1)); continue; }
    const raw = await res.text();
    if (!res.ok) throw new Error(`Trello ${res.status} on ${method} ${path}: ${raw.slice(0, 200)}`);
    return (raw ? JSON.parse(raw) : undefined) as T;
  }
}

// Board metadata changes rarely and never during a run: fetch once per process.
let lists: List[] | undefined;
let fields: CustomField[] | undefined;
const getLists = async () => (lists ??= await trello<List[]>(`/boards/${cfg.BOARD}/lists?fields=name`));
const getFields = async () => (fields ??= await trello<CustomField[]>(`/boards/${cfg.BOARD}/customFields`));

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function listByName(name: string): Promise<List> {
  const all = await getLists();
  const hit = all.find((l) => same(l.name, name));
  if (!hit) throw new Error(`Unknown list "${name}". Valid lists: ${all.map((l) => l.name).join(", ")}`);
  return hit;
}

async function fieldByName(name: string): Promise<CustomField> {
  const all = await getFields();
  const hit = all.find((f) => same(f.name, name));
  if (!hit) throw new Error(`Unknown field "${name}". Valid fields: ${all.map((f) => f.name).join(", ")}`);
  return hit;
}

// ---------- 3. Shaping ----------

const daysSilent = (card: Card) => Math.floor((Date.now() - Date.parse(card.dateLastActivity)) / 86_400_000);

// Trello stores list values as option ids and numbers as strings; return the human label instead.
function fieldValue(f: CustomField, item: CustomFieldItem): string | null {
  if (f.type === "list") return f.options?.find((o) => o.id === item.idValue)?.value.text ?? null;
  const v = item.value ?? {};
  return v.text ?? v.number ?? v.date ?? v.checked ?? null;
}

// What the agent sees for a card: short id, list name, label names, every custom field by name.
async function shape(card: Card) {
  const [allLists, allFields] = await Promise.all([getLists(), getFields()]);
  const custom: Record<string, string | null> = {};
  for (const f of allFields) {
    const item = card.customFieldItems?.find((i) => i.idCustomField === f.id);
    custom[f.name] = item ? fieldValue(f, item) : null;
  }
  return {
    id: card.shortLink,
    name: card.name,
    list: allLists.find((l) => l.id === card.idList)?.name ?? card.idList,
    labels: card.labels.map((l) => l.name),
    members: (card.members ?? []).map((m) => m.username),
    due: card.due,
    daysSilent: daysSilent(card),
    ...custom,
  };
}

const text = (s: string): CallToolResult => ({ content: [{ type: "text", text: s }] });
const json = (v: unknown): CallToolResult => text(JSON.stringify(v, null, 2));
const fail = (e: unknown): CallToolResult => ({
  content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
  isError: true,
});

// ---------- 4. Tools ----------

// Logs one line per call and turns any thrown error into an MCP error result.
async function timed(name: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  const t0 = Date.now();
  const result = await fn().catch(fail);
  console.log(`${name} ${Date.now() - t0}ms ${result.isError ? "error" : "ok"}`);
  return result;
}

const CARD_QUERY =
  "fields=shortLink,name,desc,url,idList,due,dateLastActivity,labels" +
  "&members=true&member_fields=username,fullName&customFieldItems=true";

const cardsIn = (list: List) => trello<Card[]>(`/lists/${list.id}/cards?${CARD_QUERY}`);

const cardArg = z.string().describe("Card id: the short id returned by list_cards");
const listArg = z.string().describe("List name: Inbox, Triage, In progress, Waiting on customer or Done");

// The SDK allows one transport per server instance, so each request gets its own server.
function createServer(): McpServer {
  const server = new McpServer({ name: "trello-dust-mcp", version: "0.1.0" });

  server.registerTool("list_cards", {
    description:
      "List the cards in one list of the support board: id, name, labels, members, custom fields " +
      "(Priority, Category, Customer, Agent status) and days since last activity. " +
      "Lists on the board: Inbox, Triage, In progress, Waiting on customer, Done. Call it first to see what needs attention.",
    inputSchema: { list: listArg },
  }, ({ list }) => timed("list_cards", async () => {
    const cards = await cardsIn(await listByName(list));
    return json(await Promise.all(cards.map(shape)));
  }));

  server.registerTool("get_card", {
    description:
      "Read one card in full: description, custom fields, the last 20 comments (oldest first) and its attachments. " +
      "Call it before analysing a ticket. Team comments carry a prefix: Analysis:, Draft reply:, Reply to customer: or Note:. " +
      "Image attachments can be viewed with get_attachment.",
    inputSchema: { card: cardArg },
  }, ({ card }) => timed("get_card", async () => {
    const [c, actions, attachments] = await Promise.all([
      trello<Card>(`/cards/${card}?${CARD_QUERY}`),
      trello<Action[]>(`/cards/${card}/actions?filter=commentCard&limit=20`),
      trello<Attachment[]>(`/cards/${card}/attachments`),
    ]);
    return json({
      ...(await shape(c)),
      desc: c.desc,
      url: c.url,
      comments: actions.reverse().map((a) => ({ by: a.memberCreator.username, at: a.date, text: a.data.text })),
      attachments: attachments.map((a) => ({ id: a.id, name: a.name, type: a.mimeType })),
    });
  }));

  server.registerTool("get_attachment", {
    description:
      "Download an image attachment (for example a screenshot) from a card and return it as an image you can look at. " +
      "Only images are supported. Use the attachment id from get_card.",
    inputSchema: { card: cardArg, attachment: z.string().describe("Attachment id from get_card") },
  }, ({ card, attachment }) => timed("get_attachment", async () => {
    const a = await trello<Attachment>(`/cards/${card}/attachments/${attachment}`);
    if (!a.mimeType?.startsWith("image/")) {
      return text(`Attachment "${a.name}" is ${a.mimeType || "of unknown type"}, not an image. Only images can be viewed.`);
    }
    // Uploaded files are private: Trello wants key and token in an OAuth header, not the query string.
    const res = await fetch(a.url, {
      headers: { Authorization: `OAuth oauth_consumer_key="${cfg.KEY}", oauth_token="${cfg.TOKEN}"` },
    });
    if (!res.ok) throw new Error(`Trello ${res.status} downloading attachment "${a.name}"`);
    const data = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { content: [{ type: "image", data, mimeType: a.mimeType }] };
  }));

  server.registerTool("set_custom_field", {
    description:
      "Set a custom field on a card by field name and human value. Fields on the board: Priority (P1, P2, P3), " +
      "Category (Billing, API, Integration, Account), Customer (text), Agent status (text). Use it to classify a ticket.",
    inputSchema: {
      card: cardArg,
      field: z.string().describe("Field name, for example Priority"),
      value: z.string().describe("Human value, for example P2"),
    },
  }, ({ card, field, value }) => timed("set_custom_field", async () => {
    const f = await fieldByName(field);
    let body: unknown;
    let label = value;
    if (f.type === "list") {
      const options = f.options ?? [];
      const o = options.find((o) => same(o.value.text, value));
      if (!o) throw new Error(`Unknown option "${value}" for ${f.name}. Valid options: ${options.map((o) => o.value.text).join(", ")}`);
      body = { idValue: o.id };
      label = o.value.text;
    } else if (f.type === "number") {
      body = { value: { number: value } };
    } else {
      body = { value: { text: value } };
    }
    await trello(`/cards/${card}/customField/${f.id}/item`, "PUT", body);
    return text(`Set ${f.name} to ${label} on card ${card}.`);
  }));

  server.registerTool("add_comment", {
    description:
      "Post a comment on a card. Start the text with a prefix: \"Analysis:\" for your assessment of the ticket, " +
      "\"Draft reply:\" for a proposed answer, \"Reply to customer:\" for an approved reply, \"Note:\" for anything else. " +
      "Never post a \"Reply to customer:\" comment without an explicit human go.",
    inputSchema: { card: cardArg, text: z.string().min(1).describe("Comment text, starting with one of the prefixes") },
  }, ({ card, text: comment }) => timed("add_comment", async () => {
    const a = await trello<Action>(`/cards/${card}/actions/comments`, "POST", { text: comment });
    return text(`Comment ${a.id} posted on card ${card}.`);
  }));

  server.registerTool("move_card", {
    description:
      "Move a card to another list by list name (Inbox, Triage, In progress, Waiting on customer, Done). " +
      "Use it after a reply is posted, or when the human asks.",
    inputSchema: { card: cardArg, list: listArg },
  }, ({ card, list }) => timed("move_card", async () => {
    const l = await listByName(list);
    await trello(`/cards/${card}`, "PUT", { idList: l.id });
    return text(`Moved card ${card} to ${l.name}.`);
  }));

  server.registerTool("archive_stale_cards", {
    description:
      "Find cards in a list with no activity for a number of days and archive them. Cards with a future due date " +
      "or a \"blocked\" label are never touched. Runs as a preview by default: call it with dry_run false only after " +
      "a human has seen the preview and confirmed.",
    inputSchema: {
      list: listArg,
      days: z.number().int().min(3).default(14).describe("Days without activity, minimum 3"),
      dry_run: z.boolean().default(true).describe("true previews, false archives"),
    },
  }, ({ list, days, dry_run }) => timed("archive_stale_cards", async () => {
    const cards = await cardsIn(await listByName(list));
    const stale = cards.filter((c) =>
      daysSilent(c) >= days &&
      !(c.due && Date.parse(c.due) > Date.now()) &&
      !c.labels.some((l) => same(l.name, "blocked")));
    const rows = stale.map((c) => ({ id: c.shortLink, name: c.name, daysSilent: daysSilent(c) }));
    const skipped = cards.length - stale.length;
    if (dry_run) return json({ dry_run: true, would_archive: rows, skipped });
    // Sequential on purpose: readable logs and no burst against the rate limit.
    for (const c of stale) await trello(`/cards/${c.id}`, "PUT", { closed: true });
    return json({ dry_run: false, archived: rows, skipped });
  }));

  return server;
}

// ---------- 5. HTTP ----------

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => { res.type("text/plain").send("ok"); });

// Exact match only: no query-string tokens, no basic auth.
app.use("/mcp", (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${cfg.BEARER}`) { res.status(401).send("unauthorized"); return; }
  next();
});

// Stateless: a fresh server and transport per request, nothing kept in memory between calls.
app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// The stateless transport would open an SSE stream on GET; the MCP spec wants a 405 instead.
app.all("/mcp", (_req, res) => { res.status(405).send("method not allowed"); });

app.listen(cfg.PORT, () => console.log(`trello-dust-mcp listening on :${cfg.PORT}, board ${cfg.BOARD}`));
