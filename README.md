# trello-dust-mcp

An MCP server that lets a Dust agent work a Trello support board. One file for the server, two scripts for demo data, four docs for the knowledge base, a Dockerfile. The fictional company is Facturo, a B2B invoicing SaaS, and the agent is its pre-sales support assistant.

Built with Claude Code from a step-by-step plan, one phase at a time, each phase reviewed and tested before the next. (I, Claude Code, generated these lines too. Nabil read each one of them. He also ran the tests in Dust.)

Start with `CLICKME.html`: download it and open it in a browser. It holds the write-up with diagrams, the six pieces of the repo, and how it was built.

## Run locally

Needs Node 20.12 or newer, and a Trello API key and token from https://trello.com/power-ups/admin.

1. `npm install`
2. Copy `.env.example` to `.env`. Fill in `TRELLO_KEY`, `TRELLO_TOKEN` and `MCP_BEARER` (any long random string).
3. `npm run seed` creates the demo board and prints its short link. Put it in `.env` as `TRELLO_BOARD`.
4. `npm run dev` starts the server on port 3000. `GET /health` answers `ok`.

Try the tools with the MCP Inspector:

```
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --header "Authorization: Bearer <MCP_BEARER>" --method tools/list
```

Replace `--method tools/list` with `--method tools/call --tool-name list_cards --tool-arg list=Inbox` to call a tool. Without `--cli`, the Inspector opens its web UI instead.

## Deploy

Docker:

```
docker build -t trello-dust-mcp .
docker run -p 3000:3000 --env-file .env trello-dust-mcp
curl localhost:3000/health
```

Docker reads `.env` lines literally, so remove the inline comments from `.env` first.

Railway: New Project > Deploy from GitHub repo > this repo. Railway builds the Dockerfile. Set the variables `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD`, `MCP_BEARER` and `PORT=3000`. Generate a domain on port 3000. Open `https://<domain>/health` and expect `ok`.

## Connect to Dust

1. Upload the four files in `docs/` to a Google Drive folder that Dust syncs into a space.
2. Spaces > Tools > Add MCP Server. URL `https://<domain>/mcp`, authentication Bearer token, value `MCP_BEARER`. Dust lists the seven tools.
3. Create an agent with the instructions in `dust/agent-instructions.md`, the MCP server as a tool, and the space as knowledge.

## Demo data

- `npm run seed` creates a new board named "Facturo Support · demo" from `seed/tickets.json` every time it runs: custom fields, lists, labels, 15 cards with comments, and the screenshot from `seed/screenshots/` on the broken-PDF ticket. Card ids go to `seed/state.json`.
- `npm run reset` archives every open card except the five seeded cards outside Inbox, then recreates the 10 Inbox tickets. So a demo can move tickets anywhere; reset clears them and the aged cards keep aging.
- Aging: Trello sets `dateLastActivity` itself, so cards only become stale by aging. Seed at least three days before the demo and never touch the Waiting-on-customer cards, or `archive_stale_cards` has nothing to show.

## Tools

| Tool | Reads or writes | What it does |
|---|---|---|
| `list_cards` | reads | Cards in one list, with labels, members, custom fields by name, days since last activity. |
| `get_card` | reads | One card in full: description, fields, last 20 comments, attachments. |
| `get_attachment` | reads | Downloads an image attachment and returns it as an image. Refuses non-images. |
| `set_custom_field` | writes | Sets Priority, Category, Customer or Agent status by field name and human value. |
| `add_comment` | writes | Posts a comment. Prefixes: Analysis, Draft reply, Reply to customer, Note. |
| `move_card` | writes | Moves a card to another list by name. |
| `archive_stale_cards` | writes | Archives cards silent for N days (minimum 3). Skips future due dates and the blocked label. Dry run by default. |

Auth is one bearer token on `/mcp`. Every tool call logs one line: name, duration, ok or error. Test results are in `TESTING.md`.
