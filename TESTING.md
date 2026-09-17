# Testing

What was run and what was observed, in the order of the plan's Phase 7. Run by Claude Code on 16 and 17 September 2026, reviewed by Nabil. Local machine: Windows 11, Node 22.14, npm 10.9. Railway image: node:20-slim.

By the way, Nabil tested the agent directly in Dust against the Railway deploy and it worked. He is very excited for the demo.

## 1. Build

- [x] `npm run build`: zero errors. `dist/` holds `server.js` only; the scripts are not compiled.
- [x] `npx tsc -p scripts`: the three scripts type-check clean under strict mode.
- [x] Smoke test without Trello credentials, nine checks: missing env exits 1 and names the missing variables; `/health` answers 200 `ok`; wrong or absent bearer answers 401; `GET /mcp` answers 405; initialize and tools/list work; `days: 1` returns a validation error; a call with fake credentials returns `Trello 401 on GET /boards/fakeboard/lists?fields=name: invalid key` with `isError: true`, and the key and token never appear in the message.

## 2. Seed

- [x] `npm run seed` with the real `.env`.
- First run failed. `POST /boards/{id}/boardPlugins` answered 403, and the Custom Fields Power-Up was not among the 559 plugins returned by `GET /boards/{id}/plugins?filter=available`. Custom Fields is a native Trello feature now. Fix: create the fields directly with `POST /customFields`; on a 403, print a message and stop. The empty board from that run was deleted by hand.
- Second run created board `xSXLAOnj` (https://trello.com/b/xSXLAOnj): four custom fields, five lists, five labels, 15 cards.
- Found on the way: the create-board response has no `shortLink` field, so the printed `TRELLO_BOARD=` line was empty. Fix: derive it from `shortUrl`.
- Observed through the tools afterwards: Inbox 10, Triage 0, In progress 0, Waiting on customer 3, Done 2. Card T02 carries `error-screenshot.png` as `image/png`. Card T11 has its seeded `Reply to customer:` comment, Priority P2, Category Account, Agent status "Replied 2026-09-02".
- The first screenshot was 3.3 MB, which became 4.4 million characters of base64 in the tool result. Replaced with a 221 KB file and re-attached with `npm run reset`.

## 3. Inspector and tool calls

Local server started with `npm run dev`. MCP Inspector CLI with the bearer header, then a scripted sequence of 16 calls. The same sequence was repeated against the Railway deployment with the same results.

- [x] Inspector `tools/list`: 7 tools.
- [x] Inspector `tools/call`, `list_cards` with `list=Inbox`: 10 cards, with Priority, Category, Customer and Agent status resolved by name.
- [x] `get_card` on T01: id, name, list, labels, members, due, daysSilent, the four fields, desc, url, comments, attachments.
- [x] `get_card` on T02, then `get_attachment`: an `image` block, `image/png`, 294,644 base64 characters.
- [x] `set_custom_field` Priority P2 on T01: "Set Priority to P2 on card ...".
- [x] `add_comment` with a `Note:` on T01: comment id returned.
- [x] `move_card` T01 to Triage. Confirmed by `list_cards` on Triage (1 card, Priority P2) and a re-read of the card (list Triage, 1 comment).
- [x] `archive_stale_cards` on Waiting on customer with `days: 3`: `{ "dry_run": true, "would_archive": [], "skipped": 3 }`. Expected, since the cards were created the same day.
- Server log, one line per call, for example `list_cards 220ms ok`, `get_attachment 787ms ok`, and `move_card 0ms error` for the failed negative test below.

## 4. Negative tests

- [x] Wrong bearer: HTTP 401 `unauthorized`.
- [x] `move_card` to `Nowhere`: `Unknown list "Nowhere". Valid lists: Inbox, Triage, In progress, Waiting on customer, Done`.
- [x] `set_custom_field` Priority `P9`: `Unknown option "P9" for Priority. Valid options: P1, P2, P3`.
- [x] `archive_stale_cards` with `days: 1`: `MCP error -32602: Input validation error: Invalid arguments for tool archive_stale_cards: Too small: expected number to be >=3 at days`.
- [x] Unknown field `Mood`: `Unknown field "Mood". Valid fields: Priority, Category, Customer, Agent status`.

The four tool errors come back as results with `isError: true`, not as transport failures.

## 5. Reset

- [x] `npm run reset`: "Archived 10 cards in Inbox and Triage, recreated 10 Inbox tickets."
- Before: Inbox 9 and Triage 1, the card moved by the test above. After: Inbox 10 with new ids, Triage 0.
- Waiting on customer kept `MjNLIT9t MibjLphF iRjUUzXU`. Done kept `3N2msZxH FL7Y4Z4c`. Untouched.
- Run three times in total during testing, same behaviour each time.
- Found after the first full Dust run: the agent had moved 9 tickets to Waiting on customer and the duplicate to Done, so Inbox and Triage were empty and the reset archived nothing. It recreated 10 tickets on top of 25 open cards. The plan's reset only cleared Inbox and Triage.
- Fix: reset now archives every open card except the five seeded cards outside Inbox, whose ids are in the state file, then recreates the Inbox. Run on that board: "Archived 20 cards, kept 5 seeded cards, recreated 10 Inbox tickets." Counts afterwards: Inbox 10, Triage 0, In progress 0, Waiting on customer 3, Done 2, with the same aged ids as before and their last activity still at seed time.

## 6. Docker and deployment

- [ ] `docker build` and `docker run` on the development machine: not run. Docker is not installed there.
- [x] Railway built the same Dockerfile from the GitHub repo. Deploy log: `trello-dust-mcp listening on :3000, board xSXLAOnj`. `https://trello-dust-mcp-production.up.railway.app/health` answers `ok`.
- [x] The 16-call sequence from sections 3 and 4 passed against the Railway URL, followed by a reset.
- Two variable mistakes were caught by the log line: Railway injected `PORT=8080` while the domain targeted 3000, fixed by setting `PORT=3000`; and `TRELLO_BOARD` had been pasted one character short, fixed.
- [x] Dust: MCP server added with the URL and the bearer token. Seven tools discovered. The server had to be added to the Facturo_demo space before the agent builder would list it.
- [x] Nabil ran the agent from Dust against the Railway deployment: the scheduled run produced its report and set Priority on all 10 tickets, then, on his go, the agent posted a reply on each card, moved 9 to Waiting on customer and the duplicate to Done. Observed on the board afterwards: every one of those cards had one comment and a priority, and the three aged cards were untouched.

## Not covered

- The 429 retry path in the Trello client. The test runs stayed under the rate limit.
- `archive_stale_cards` with `dry_run: false`. No card was old enough. The preview path and the two exclusion filters are covered.
- Number-type custom fields. The board has none, so that branch of `set_custom_field` is untested.
