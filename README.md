# Canvas MCP connector

**What this is:** an MCP server (a "custom connector") that lets Claude read your Canvas
courses — lecture slides, assignments, deadlines, announcements, reading lists,
discussion threads — so you can ask questions about them in plain language, in the
Claude app you already use. Built for Claude first; works with any AI client that speaks
MCP (Grok, Codex, Cursor, …) — see [Connect from other clients](#connect-from-other-clients).

**Installing it** means deploying this small server to your own free Cloudflare account
and pasting its address into Claude. It is complete as it is — nothing needs to be built
or designed to start using it. (Want to build something on top, like a dashboard? Go
ahead — the code is MIT and the tools are plain MCP.)

- **Runs in the cloud** (Cloudflare Workers, free tier). Nothing to install, nothing to
  keep running on your laptop. Works in claude.ai on web, desktop and phone.
- **Read-only, by construction.** The code can only *fetch* from Canvas. There is no
  code path that can submit, post, edit or delete anything.
- **Any institution that uses Canvas** — *if* your institution lets students create their own
  access tokens. Most do; some have turned it off, and then this connector can't be used
  there. Check first: [Step 1](#step-1--get-your-canvas-access-token) takes one minute
  and tells you before you set anything else up.
- **~10 minutes to set up**, no terminal, no programming.

> **Needs a paid claude.ai plan** (Pro, Max or Team) — custom connectors aren't available
> on the free plan. Everything else is free.

---

## Two ways to install

**A. Let Claude Code install it (recommended if you have Claude Code).**
Open Claude Code and paste:

> Install https://github.com/matcha-ai-test/canvas-mcp-connector

Claude Code downloads the project and runs the installer. Your browser opens once so you
can create a free Cloudflare account (or log in), then two dialog boxes ask for your
Canvas address and access token (see [Step 1](#step-1--get-your-canvas-access-token)
for where to find it). At the end Claude Code shows you a URL and a password, and the
exact three clicks to add them in claude.ai. That's it — no GitHub account, no terminal
commands to type.

**B. Click the button** (no Claude Code needed; you need a free GitHub account).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/matcha-ai-test/canvas-mcp-connector)

Then follow Steps 1–3 below.

---

## Before you start

You need a paid claude.ai plan plus two free accounts that take a minute each to create.

| Account | Why | Cost |
|---|---|---|
| **claude.ai** (Pro, Max or Team) | Custom connectors are a paid feature | your existing plan |
| **Cloudflare** account → [sign up](https://dash.cloudflare.com/sign-up) | Hosts the connector | free |
| **GitHub** account → [sign up](https://github.com/signup) — *only for way B* | The Deploy button works by copying this project into a Git account you own, and Cloudflare builds from there. (GitLab works too.) You never need to open it again. | free |

Do Step 1 first — if your institution doesn't allow access tokens, you can skip the rest.

---

## Step 1 — Get your Canvas access token

1. Log in to Canvas in your browser.
2. **Copy the address** from the address bar — only the first part, before the third
   slash. If the bar shows `https://canvas.yourschool.edu/courses/12345`, you want
   `https://canvas.yourschool.edu`. You'll need it in Step 2.
3. Click **Account** (your picture, at the top of the menu on the left — on a phone, tap
   **☰** first) → **Settings**.
4. Scroll down to **Approved Integrations** and click **+ New Access Token**.
5. Purpose: `Canvas MCP connector` (any label — it's just a note to yourself). Expiry: leave blank, or pick a date if your institution requires one.
6. Click **Generate Token** and **copy the token now** — Canvas only shows it once.

> **Treat the token like a password.** It gives full access to your Canvas account.
> Don't paste it anywhere except the Cloudflare form in Step 2.

**Don't see "+ New Access Token", or does it fail?** Your institution has restricted
self-service tokens — this is a policy decision by the institution, not something you can
change. Two options:
- Ask your IT help desk for a "Canvas API access token". Some institutions issue them on
  request, sometimes with a short expiry (e.g. 30 days).
- If they say no, this connector can't be used at your institution. Stop here — don't create
  the Cloudflare or GitHub accounts.

---

## Step 2 — Click Deploy

1. Click the **Deploy to Cloudflare** button at the top of this page.
2. **Sign in to Cloudflare** (or create the free account).
3. **Connect GitHub** when asked. Cloudflare creates a copy of this project in your
   GitHub account — that's normal; it's how Cloudflare knows what to run.
4. The page shows a few settings (Worker name, repository name, storage). **Leave all of
   them at their defaults.** The only three things you must fill in are these secrets:

   | Field | What to enter |
   |---|---|
   | `CANVAS_URL` | Your Canvas address from Step 1, e.g. `https://canvas.yourschool.edu` |
   | `CANVAS_TOKEN` | The token you copied in Step 1 |
   | `MCP_SECRET` | **A password you invent.** Make it long, and save it in your password manager — you'll type it once in Step 3, and Cloudflare won't show it to you again (you can only replace it). |

   Leave `CANVAS_LABEL`, `CANVAS_URL_2`, `CANVAS_TOKEN_2` and `CANVAS_LABEL_2` empty
   unless you study at two institutions — see [Two institutions](#two-institutions). All of these are
   stored encrypted on your Cloudflare account.

5. Click **Create and deploy**. Wait a minute or two while it builds.
6. When it's done you land on your Worker's page. Your connector's address is listed
   there (under *Domains & Routes*, or as the "Visit" link) and looks like
   `https://canvas-mcp-connector.something.workers.dev`. **Copy it.**

---

## Step 3 — Add it to claude.ai

1. Open [claude.ai](https://claude.ai) → **Settings** → **Connectors**.
2. Click **Add custom connector**.
3. Name: `Canvas`. In **Remote MCP server URL**, paste your address from Step 2 **with
   `/mcp` on the end**, e.g. `https://canvas-mcp-connector.something.workers.dev/mcp`
4. Click **Add**, then **Connect**.
5. A small page opens asking for a **connection password**. Enter the `MCP_SECRET` you
   invented in Step 2 and click **Approve**.

Done. Start a new chat, check that the Canvas connector is switched on (the tools /
sliders button next to the message box), and try:

> List my courses

---

## What you can ask

The assistant figures out which tools to use — you just ask. The examples below all work
as written; swap in your own course names.

**Getting oriented**
- "List my courses"
- "What deadlines do I have in the next two weeks, across all courses?"
- "Anything new from the teachers this week? Check the announcements in all my courses."
- "What's the structure of *Introduction to Marketing*? Walk me through the modules."

**Lectures**
- "Summarise the slides from lecture 4 in *Microeconomics* — I missed it."
- "Find the lecture files about *net present value* in my courses and explain it from
  those slides."
- "Turn the lecture 2 slides into a 10-question quiz and test me."
- "Compare what lecture 3 and the textbook chapter say about the same topic."

**Assignments and exams**
- "Read the full instructions for *Assignment 1* and tell me exactly what's expected: the
  question, the word limit, the format and the deadline."
- "What do the grading criteria say for each grade level? Put it in a table."
- "Does the syllabus say anything about using AI in this course?"
- "Which parts of *Course X* are mandatory attendance, according to the course page?"

**Reading lists and literature**
- "Which readings does the study guide list for week 1, and which of them are actually
  in Canvas as files?"
- "Give me download links for every PDF linked in the syllabus."
- "The Files tab is hidden in *Course Y* — find the articles through the modules and
  pages instead."
- "Read *article.pdf* and give me the argument in five bullet points with page references."

**Group work and seminars**
- "Read the discussion thread for *Seminar 1* and summarise what my group has posted so
  far."
- "What does the seminar instruction say we need to prepare, and by when?"

**Planning**
- "Build me a study plan for next week from the module structure and the deadlines."
- "Which course has the most work due soonest? Rank them."

**Downloading material to your computer** *(Claude Code or Cowork — see below)*
- "Download all lecture slides from *Course X* into `~/University/Course X/Slides/`."
- "Go through every module in *Course Y* and save all PDFs, PowerPoints and Excel files
  into folders named after the modules."
- "Download the reading list PDFs linked in the syllabus and name them
  `Author – Title.pdf`."

Tips: name the course the way Canvas does, and ask for page references when you want to
check something yourself. The connector reads PDFs and text files, not PowerPoint or
Word — for those, see the FAQ below.

### Which Claude to use for what

The connector is the same everywhere; what differs is what the client can do with the
result.

| Task | Use | Why |
|---|---|---|
| Quick questions, deadlines, announcements, one PDF at a time, quizzes | **claude.ai** (web, desktop, phone) | Fast, works anywhere, nothing extra needed |
| **Downloading files to disk** — slides, PDFs, PowerPoints, Excel, whole courses | **Claude Code** or **Cowork** | The connector hands out download links; only these clients can save files to your computer and name/sort them into folders |
| Long reads — whole textbooks, all slides of a course, cross-course comparisons | **Claude Code** or **Cowork** | Larger context, can work through material in batches and write summaries to files |
| PowerPoint / Word / Excel content | any client, **after** downloading | The connector can't extract text from Office files; a downloaded file dropped into the chat is read directly |

Cowork and Claude Desktop use the same connector you set up in Step 3. For Claude Code
and other command-line tools, see [Connect from other clients](#connect-from-other-clients).

---

## Two institutions

If you study at two institutions, fill in the optional fields in Step 2 (or add them
later under *Settings → Variables and Secrets* on your Worker in the Cloudflare
dashboard):

| Field | Example |
|---|---|
| `CANVAS_LABEL` | `uni` — a short name for the first institution (optional; defaults to the Canvas hostname) |
| `CANVAS_URL_2` | `https://canvas.otherschool.edu` |
| `CANVAS_TOKEN_2` | the token from the second Canvas |
| `CANVAS_LABEL_2` | `college` |

The assistant then asks you which institution, or queries both when the question spans
them ("all my deadlines").

---

## FAQ and troubleshooting

**The connection failed, or you're asked to reconnect.**
Go to your client's connector settings (in claude.ai: Settings → Connectors → Canvas →
Connect) and enter your `MCP_SECRET` again.

**"Canvas responded 401".**
Your token has expired or been revoked. Create a new one (Step 1), then open the
[Cloudflare dashboard](https://dash.cloudflare.com) → *Workers & Pages* → your Worker →
*Settings* → *Variables and Secrets* → edit `CANVAS_TOKEN`.

**"Canvas responded 406 Not Acceptable".**
A temporary block on the shared IP address your Worker uses — you did nothing wrong.
It clears on its own, typically within a few hours. Wait and try again; if it lasts more
than a day, open an issue.

**"No files found" but I know the course has files.**
The course hides its Files tab. Ask the assistant to go through the modules, the syllabus
or the course pages instead — files linked there are still readable.

**The assistant can't read a PowerPoint or Word file.**
Ask for the download link, download the file, then drag it into the chat — the assistant
reads it directly there.

**I forgot my `MCP_SECRET`.**
Set a new one in the Cloudflare dashboard (same place as `CANVAS_TOKEN`), then reconnect
in claude.ai.

**How do I remove everything?**
Delete the Worker in the Cloudflare dashboard, delete the copied repository in your
GitHub account, and revoke the token in Canvas (Account → Settings → Approved
Integrations → the trash icon).

---

## Connect from other clients

The connector is standard remote MCP over HTTPS, so any MCP client can use it. Clients
that can open a browser (claude.ai, Claude Desktop, Cowork) get the password page from
Step 3. Command-line clients send the password as a bearer token instead.

**Claude Code**

```bash
claude mcp add --transport http canvas https://YOUR-WORKER.workers.dev/mcp \
  --header "Authorization: Bearer YOUR_MCP_SECRET"
```

**Codex CLI** — in `~/.codex/config.toml`:

```toml
[mcp_servers.canvas]
url = "https://YOUR-WORKER.workers.dev/mcp"

[mcp_servers.canvas.http_headers]
Authorization = "Bearer YOUR_MCP_SECRET"
```

**Anything else**: URL `https://YOUR-WORKER.workers.dev/mcp`, transport *streamable
HTTP*, header `Authorization: Bearer YOUR_MCP_SECRET`.

No extra files are needed in this repository for that — the client only needs the URL
and the password.

---

## Security in short

- **The code can only read.** See [SECURITY.md](SECURITY.md) for how and why.
- **Your token stays with you.** It's stored as an encrypted secret on *your* Cloudflare
  account. It is never in this repository, never sent anywhere except to your institution's
  Canvas.
- **Only you can connect.** The connector is protected by the password you choose,
  with a limit on login attempts.
- **Your institution can see the token being used** — which pages, when, and any search
  terms you use — like any Canvas app. It cannot see what you ask the assistant.
- **Everything the assistant reads goes to your AI provider** (Anthropic, if you use
  Claude) as part of the conversation, under that account's privacy settings.

---

## For developers

<details>
<summary>Manual deploy, local development, CLI clients</summary>

```bash
npm install
cp .dev.vars.example .dev.vars      # fill in your values
npm run dev                         # http://localhost:8787/mcp
npm run typecheck
```

For a manual deploy, create a KV namespace and put its id in `wrangler.jsonc`:

```bash
npx wrangler kv namespace create OAUTH_KV
npx wrangler secret put CANVAS_URL
npx wrangler secret put CANVAS_TOKEN
npx wrangler secret put MCP_SECRET
npx wrangler deploy
```

**Tools (16, all read-only):** `list_courses`, `list_modules`, `list_module_items`,
`list_files`, `get_file_link`, `read_file`, `find_material`, `list_pages`, `get_page`,
`get_syllabus`, `get_assignment`, `get_discussion`, `list_assignments`,
`upcoming_deadlines`, `list_announcements`, `my_grades`. Each tool's Canvas endpoint is
noted in [`src/mcp.ts`](src/mcp.ts) and summarised in
[docs/canvas-api-notes.md](docs/canvas-api-notes.md) (tokens, status codes, throttling);
the API itself is documented at
[developerdocs.instructure.com/services/canvas](https://developerdocs.instructure.com/services/canvas).

**Layout:** `src/canvas.ts` (the GET-only client), `src/mcp.ts` (tools), `src/files.ts`
(PDF/text extraction with `unpdf`), `src/oauth.ts` (password consent page),
`src/index.ts` (OAuth provider + bearer fast path), `src/util.ts` (HTML→text, link
extraction, fencing of untrusted content).

</details>

---

## Related projects

- [vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) — the
  project this grew out of. It runs locally on your computer and offers 100+ tools,
  including ones that write to Canvas (for teachers and course designers). This
  connector is the opposite trade-off: cloud-hosted, read-only, student-focused, with
  deeper reading — full PDF text, assignment text, discussion threads, and files linked
  inside pages when the Files tab is hidden.

## License

[MIT](LICENSE)
