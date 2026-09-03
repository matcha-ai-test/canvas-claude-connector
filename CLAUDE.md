# Instructions for AI coding agents (Claude Code, Codex, Grok, …)

**What this repository is:** a finished, read-only **MCP server** ("custom connector")
that gives an AI assistant access to the user's Canvas LMS courses. It runs on Cloudflare
Workers. Built for Claude first, usable from any MCP-capable client.

**When the user asks to "install" or "set up" it, that means deploy — not build.** The
code is complete: run `./setup.sh`, which deploys it to the user's Cloudflare account, and
hand them the resulting URL and password. Don't start designing a dashboard, website or UI
unless the user explicitly asks for that *in addition* — and if they do, do the install
first so they have a working connector to build on. People who are not developers will ask
you to install this. Make it painless.

Canvas API questions during installation (token errors, 401/403/406/429, what an
endpoint returns): see [docs/canvas-api-notes.md](docs/canvas-api-notes.md) first, then
https://developerdocs.instructure.com/services/canvas.

## When the user says "install", "set up", "installera" or pastes this repo's URL

Run the installer and let it do the work:

```bash
./setup.sh
```

It is idempotent. It handles: Node check, `npm install`, Cloudflare login (opens the
browser — the user creates a free account there if they don't have one), KV namespace,
Worker deploy, secrets, and registering the connector in Claude Code. It asks the user
for the Canvas address and access token in a **native dialog**, not in the terminal.

Your job around it:

1. **Before running:** tell the user in one or two sentences what will happen: the browser
   will open for Cloudflare, then two dialog boxes will ask for their Canvas address and
   token. Tell them where the token is (Canvas → Account → Settings → "+ New Access
   Token"). Then run the script.
2. **If Node.js is missing** (the script says so): install it for them — `brew install
   node` on a Mac with Homebrew, otherwise offer to install Homebrew first or point to
   https://nodejs.org — then re-run `./setup.sh`.
3. **If the script stops with "Setup stopped:"**, read the message, fix what it says
   (usually: login not completed, or the token was wrong), and re-run. Don't improvise
   around the script — re-running it is always safe.
4. **After it finishes:** show the user the block the script printed (connector URL and
   connection password) and the four claude.ai steps. That's the hand-off.

## Rules

- **Never ask the user to paste their Canvas access token into the chat**, and never
  echo it. The token gives full access to their Canvas account. The script collects it
  in a dialog and sends it straight to Cloudflare as an encrypted secret. If the dialog
  can't be used (Linux without a display), have the user run
  `npx wrangler secret put CANVAS_TOKEN` in their own terminal.
- The connection password (`MCP_SECRET`) may be shown — the user needs it for claude.ai.
- **Don't modify Canvas, and don't add code that could.** `src/canvas.ts` only issues
  GET requests, on purpose. Pull requests that add write access are rejected.
- Don't commit `.dev.vars`, `wrangler.jsonc` with a real KV id from this machine, or
  any downloaded course material. `.gitignore` covers the common cases; check
  `git status` before committing.

## Working on the code

```bash
npm install
npm run typecheck        # tsc --noEmit
npm run dev              # local Worker on http://localhost:8787 (needs .dev.vars)
npm run deploy
```

Layout: `src/canvas.ts` GET-only client · `src/mcp.ts` the 16 tools (each headed with
its Canvas endpoint) · `src/files.ts` PDF/text extraction · `src/oauth.ts` password
consent page · `src/index.ts` OAuth provider + bearer fast path · `src/util.ts`
HTML→text, link extraction, fencing of untrusted content.

Canvas API reference: https://developerdocs.instructure.com/services/canvas
