// Shared by seed.ts and reset.ts: env, a Trello client, board lookup, and the steps that create one ticket.
// The server keeps its own client on purpose: scripts and server ship separately.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

// ---------- 1. Environment ----------

try { process.loadEnvFile(); } catch { /* checked below */ }

const KEY = process.env.TRELLO_KEY;
const TOKEN = process.env.TRELLO_TOKEN;
if (!KEY || !TOKEN) {
  console.error("Missing TRELLO_KEY or TRELLO_TOKEN. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// ---------- 2. Client ----------

const TRELLO = "https://api.trello.com/1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const url = `${TRELLO}${path}${path.includes("?") ? "&" : "?"}key=${KEY}&token=${TOKEN}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    // Seeding is a burst of writes; a short wait absorbs Trello's per-token limit.
    if (res.status === 429 && attempt < 3) { await sleep(1000 * (attempt + 1)); continue; }
    const raw = await res.text();
    // status rides on the error so callers can react to one code (seed stops on 403) without parsing text.
    if (!res.ok) throw Object.assign(new Error(`Trello ${res.status} on ${init.method} ${path}: ${raw.slice(0, 200)}`), { status: res.status });
    return (raw ? JSON.parse(raw) : undefined) as T;
  }
}

export const trello = <T = unknown>(path: string, method = "GET", body?: unknown) =>
  send<T>(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

// Multipart upload for attachments. fetch sets the boundary header itself.
export const trelloForm = <T = unknown>(path: string, form: FormData) => send<T>(path, { method: "POST", body: form });

// ---------- 3. Board lookup ----------

interface Named { id: string; name: string }
export interface CustomField {
  id: string;
  name: string;
  type: string;
  options?: { id: string; value: { text: string } }[];
}
export interface Board {
  id: string;
  lists: Record<string, string>;
  labels: Record<string, string>;
  fields: CustomField[];
}

const byName = (xs: Named[]) => Object.fromEntries(xs.map((x) => [x.name, x.id]));

// Names to ids, fetched from Trello so seed and reset share one source of truth.
export async function loadBoard(id: string): Promise<Board> {
  const [lists, labels, fields] = await Promise.all([
    trello<Named[]>(`/boards/${id}/lists?fields=name`),
    trello<Named[]>(`/boards/${id}/labels?fields=name`),
    trello<CustomField[]>(`/boards/${id}/customFields`),
  ]);
  return { id, lists: byName(lists), labels: byName(labels), fields };
}

function need(map: Record<string, string>, name: string, kind: string): string {
  const id = map[name];
  if (!id) throw new Error(`Unknown ${kind} "${name}". Valid: ${Object.keys(map).join(", ")}`);
  return id;
}

// ---------- 4. Tickets ----------

export interface Ticket {
  key: string;
  list: string;
  name: string;
  desc: string;
  labels: string[];
  fields: Record<string, string>;
  screenshot?: string;
  due?: string;
  comments: string[];
}

const SEED_DIR = new URL("../seed/", import.meta.url);

export async function readTickets(): Promise<{ board: string; tickets: Ticket[] }> {
  return JSON.parse(await readFile(new URL("tickets.json", SEED_DIR), "utf8"));
}

// Seed step 6, also used by reset: card, custom field values, comments in order, screenshot.
export async function createTicket(board: Board, t: Ticket): Promise<string> {
  const card = await trello<{ id: string }>("/cards", "POST", {
    idList: need(board.lists, t.list, "list"),
    name: t.name,
    desc: t.desc,
    idLabels: t.labels.map((l) => need(board.labels, l, "label")).join(","),
    due: t.due ?? null,
    pos: "bottom",
  });
  for (const [name, value] of Object.entries(t.fields)) {
    const f = board.fields.find((f) => f.name === name);
    if (!f) throw new Error(`Unknown field "${name}" on ${t.key}. Valid: ${board.fields.map((f) => f.name).join(", ")}`);
    const body = f.type === "list" ? { idValue: optionId(f, value, t.key) } : { value: { text: value } };
    await trello(`/cards/${card.id}/customField/${f.id}/item`, "PUT", body);
  }
  for (const text of t.comments) await trello(`/cards/${card.id}/actions/comments`, "POST", { text });
  if (t.screenshot) await attach(card.id, t.screenshot);
  return card.id;
}

function optionId(f: CustomField, value: string, key: string): string {
  const o = f.options?.find((o) => o.value.text === value);
  if (!o) throw new Error(`Unknown option "${value}" for ${f.name} on ${key}. Valid: ${f.options?.map((o) => o.value.text).join(", ")}`);
  return o.id;
}

// A missing screenshot is a warning, not a failure: drop the file later and run npm run reset.
async function attach(cardId: string, file: string) {
  const path = new URL(`screenshots/${file}`, SEED_DIR);
  if (!existsSync(path)) {
    console.warn(`  ! seed/screenshots/${file} not found, attachment skipped`);
    return;
  }
  const type = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("file", new Blob([await readFile(path)], { type }), file);
  await trelloForm(`/cards/${cardId}/attachments`, form);
}

// ---------- 5. State ----------

export interface State {
  board: { id: string; shortLink: string; url: string };
  cards: Record<string, string>;
}

const STATE = new URL("state.json", SEED_DIR);

export const readState = async (): Promise<State> => JSON.parse(await readFile(STATE, "utf8"));
export const writeState = (s: State) => writeFile(STATE, JSON.stringify(s, null, 2) + "\n");
