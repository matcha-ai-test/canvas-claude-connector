# Security

## Read-only is built into the code

`src/canvas.ts` exposes a single function, `canvasGet()`, and it can only issue HTTP
GET. Every tool goes through it. There is no code path that writes to Canvas — no
submit, no post, no edit, no delete. This can't be misconfigured and needs no ongoing
supervision: if the code can't do it, it can't do it.

## What protects the connector

| Layer | What it does |
|---|---|
| **OAuth 2.1** (`@cloudflare/workers-oauth-provider`) | Your MCP client (claude.ai, Claude Desktop, Codex, …) connects through a standard OAuth flow. The "login" is the connection password (`MCP_SECRET`) that only you hold. |
| **Rate limit** | 10 password attempts per hour, tracked in KV. The limit is global, not per IP — so a stranger hammering your URL can lock *you* out for an hour too. If that keeps happening, change `MCP_SECRET`; the URL itself is not secret. |
| **DNS-rebinding protection** | Browser requests to `/mcp` from a foreign origin are rejected. |
| **Secrets, not files** | `CANVAS_TOKEN` and `MCP_SECRET` are Cloudflare Worker secrets — encrypted at rest, never in the repository, never in logs. |
| **Untrusted-content fencing** | Course content is written by other people. Pages, announcements, syllabi, assignments, discussions and file text are wrapped in `BEGIN/END UNTRUSTED CANVAS CONTENT` markers before they reach the model. |

## Prompt injection

Someone could write text in a Canvas page that tries to give the assistant instructions.
The fencing above makes that harder, not impossible. The important point is what the worst
case is: because there is no write path, the worst outcome is **misleading you**, not
changing anything in Canvas.

Be alert if the assistant suddenly proposes fetching a URL or sending something you didn't
ask for — check where that instruction came from.

## What your institution can see

This is **not anonymous**, and isn't meant to be. "Your institution" here means whoever
operates your Canvas — a university, a college, a school, or their IT provider. Your token
is personal and tied to your Canvas user. Their Canvas logs show:

- that your token is used, when, and from which IP address (a Cloudflare address)
- which endpoints — i.e. which courses and files you fetched
- **any search text you use** — `find_material` and `list_files` with a `search` send your
  term to Canvas as a `?search_term=…` query, so it can land in the server log. Most tools
  navigate by course/file ID instead and carry no search text; if you'd rather your
  institution not see a term, list files without `search` and let the assistant filter the
  results, or navigate by module/ID.
- the User-Agent (`User 1` — Canvas requires a non-empty one)
- that the pattern is automated (many files within seconds)
- "last used" on the token page in Canvas

They do **not** see what you ask the assistant or what it answers.

Your institution can revoke the token at any time, and everything stops working immediately.

**Is it allowed?** Canvas offers access tokens precisely so users can build their own
integrations — the token page says so. You are reading your own material with your own
key. But institutions can have separate AI policies, especially around examinations, and
those are your responsibility to know.

**Bulk downloads** can trigger abuse detection even when legitimate. If you're pulling a
lot of material, do it in batches.

## Data to your AI provider

Everything the assistant reads for you becomes part of the conversation and therefore goes
to your AI provider's servers — that's the mechanism, not a bug. If you use Claude, that's
Anthropic; if you connect a different MCP client, it's that client's provider. Whether it's
used for training depends on that account's privacy settings.

## Canvas access tokens

Canvas tokens have **full account access and cannot be scoped**. Treat yours as a
password:

- Never paste it anywhere except the Cloudflare secret field.
- If you suspect it leaked, revoke it in Canvas (Account → Settings → Approved
  Integrations) and create a new one.
- Rotate it in the Cloudflare dashboard: *Workers & Pages* → your Worker → *Settings* →
  *Variables and Secrets*.

## Reporting a problem

Open an issue in this repository. Don't include your token, your `MCP_SECRET`, or
course content in the report.
