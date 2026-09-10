#!/usr/bin/env bash
# One-shot installer for the Canvas → Claude connector.
#
# Run by Claude Code (or a person) from the repository root:
#   ./setup.sh
#
# What it does, in order — every step is safe to re-run:
#   1. checks Node.js and installs dependencies
#   2. logs in to Cloudflare (opens the browser; create a free account there if needed)
#   3. creates the KV namespace the connector needs and writes its id into wrangler.jsonc
#   4. asks for the Canvas address and access token — in a native dialog, never in the
#      terminal or chat — and generates a connection password
#   5. deploys the Worker and stores the secrets on it
#   6. prints the connector URL and the password, ready to paste into claude.ai
#
# Non-interactive use (CI, tests): set CANVAS_URL, CANVAS_TOKEN and optionally
# MCP_SECRET in the environment and no dialogs are shown.

set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mSetup stopped:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. Node.js + dependencies -------------------------------------------------------
say "1/6  Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed. On a Mac: install Homebrew (https://brew.sh) and run 'brew install node', or download Node from https://nodejs.org. Then run ./setup.sh again."
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js $NODE_MAJOR is too old — version 18 or newer is required."
[ -d node_modules ] || npm install --no-audit --no-fund --loglevel=error

WR="npx --yes wrangler"

# --- 2. Cloudflare login ---------------------------------------------------------------
say "2/6  Cloudflare account"
if ! $WR whoami 2>/dev/null | grep -q "Account ID"; then
  echo "Your browser will open. Log in to Cloudflare — or click 'Sign up' there to create a free"
  echo "account — and then click 'Allow'. Come back here when the page says you can close it."
  $WR login >/dev/null 2>&1 || fail "Cloudflare login did not complete. Run ./setup.sh again."
fi
ACCOUNT_ID=$($WR whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)
[ -n "$ACCOUNT_ID" ] || fail "Could not read your Cloudflare account id. Run 'npx wrangler login' and try again."
echo "Logged in (account …${ACCOUNT_ID: -6})."

# --- 3. KV namespace --------------------------------------------------------------------
say "3/6  Storage for login tokens"
PLACEHOLDER="00000000000000000000000000000000"
KV_TITLE="canvas-mcp-connector-oauth"
CURRENT_ID=$(grep -oE '"id": *"[0-9a-f]{32}"' wrangler.jsonc | grep -oE '[0-9a-f]{32}' | head -1 || true)
if [ -z "$CURRENT_ID" ] || [ "$CURRENT_ID" = "$PLACEHOLDER" ]; then
  KV_ID=$($WR kv namespace list 2>/dev/null | tr -d '\n' | grep -oE "\"id\": *\"[0-9a-f]{32}\", *\"title\": *\"$KV_TITLE\"" | grep -oE '[0-9a-f]{32}' | head -1 || true)
  if [ -z "$KV_ID" ]; then
    KV_ID=$($WR kv namespace create "$KV_TITLE" 2>&1 | grep -oE '[0-9a-f]{32}' | head -1 || true)
  fi
  [ -n "$KV_ID" ] || fail "Could not create the KV namespace."
  sed -i.bak "s/$PLACEHOLDER/$KV_ID/" wrangler.jsonc && rm -f wrangler.jsonc.bak
  echo "Ready."
else
  echo "Already set up."
fi

# --- 4. Collect Canvas details -------------------------------------------------------
say "4/6  Your Canvas details"

ask() { # ask "<prompt>" [hidden]  → prints the answer. Native dialog on macOS, terminal otherwise.
  local prompt="$1" hidden="${2:-}" answer=""
  if [ "$(uname)" = "Darwin" ] && command -v osascript >/dev/null 2>&1; then
    local extra=""; [ -n "$hidden" ] && extra="with hidden answer"
    answer=$(osascript -e "text returned of (display dialog \"$prompt\" default answer \"\" with title \"Canvas → Claude connector\" buttons {\"Cancel\", \"OK\"} default button \"OK\" $extra)" 2>/dev/null) || fail "Cancelled."
  else
    [ -t 0 ] || fail "No terminal to ask in — set CANVAS_URL and CANVAS_TOKEN in the environment instead."
    if [ -n "$hidden" ]; then read -r -s -p "$prompt " answer; echo; else read -r -p "$prompt " answer; fi
  fi
  printf '%s' "$answer"
}

CANVAS_URL="${CANVAS_URL:-}"
while [ -z "$CANVAS_URL" ]; do
  CANVAS_URL=$(ask "Your school's Canvas address — what the browser shows when you are in Canvas, e.g. https://canvas.yourschool.edu (only the first part, before any /courses/…).")
  CANVAS_URL=$(printf '%s' "$CANVAS_URL" | tr -d '[:space:]' | sed -E 's#/+$##; s#/(api/v1|courses.*|login.*)$##')
  case "$CANVAS_URL" in
    http://*|https://*) ;;
    "") ;;
    *) CANVAS_URL="https://$CANVAS_URL" ;;
  esac
done

CANVAS_TOKEN="${CANVAS_TOKEN:-}"
while [ -z "$CANVAS_TOKEN" ]; do
  CANVAS_TOKEN=$(ask "Your Canvas access token. In Canvas: Account → Settings → '+ New Access Token' → Generate → copy. It is hidden while you paste it and is stored only on your Cloudflare account." hidden)
  CANVAS_TOKEN=$(printf '%s' "$CANVAS_TOKEN" | tr -d '[:space:]')
done

# Check the token before deploying anything — a wrong token is the most common mistake.
# (CANVAS_TOKEN_CHECK=off skips this, for tests.)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CANVAS_TOKEN" -H "User-Agent: User 1" "$CANVAS_URL/api/v1/users/self" || echo 000)
[ "${CANVAS_TOKEN_CHECK:-on}" = "off" ] && HTTP=skip
case "$HTTP" in
  skip) echo "Token check skipped." ;;
  200) echo "Canvas accepted the token." ;;
  401) fail "Canvas rejected the token (401). Create a new one in Canvas → Account → Settings and run ./setup.sh again." ;;
  000) fail "Could not reach $CANVAS_URL. Check the address and run ./setup.sh again." ;;
  *)   echo "Warning: Canvas answered $HTTP for $CANVAS_URL/api/v1/users/self — continuing, but check the address if the connector fails." ;;
esac

MCP_SECRET="${MCP_SECRET:-}"
SECRET_FILE="$HOME/.canvas-mcp-connector"
if [ -z "$MCP_SECRET" ] && [ -f "$SECRET_FILE" ]; then MCP_SECRET=$(cat "$SECRET_FILE"); fi
if [ -z "$MCP_SECRET" ]; then
  MCP_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
fi
umask 077; printf '%s' "$MCP_SECRET" > "$SECRET_FILE"

# --- 5. Deploy + secrets ---------------------------------------------------------------
say "5/6  Deploying to Cloudflare"
DEPLOY_OUT=$($WR deploy 2>&1) || { echo "$DEPLOY_OUT" | tail -15; fail "Deploy failed (see above)."; }
WORKER_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)

if [ -z "$WORKER_URL" ]; then
  # A brand-new Cloudflare account has no workers.dev subdomain yet. Register one and redeploy.
  SUB="canvas-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)"
  CFG="$HOME/Library/Preferences/.wrangler/config/default.toml"; [ -f "$CFG" ] || CFG="$HOME/.config/.wrangler/config/default.toml"
  OAUTH=$(grep -oE 'oauth_token *= *"[^"]+"' "$CFG" 2>/dev/null | sed -E 's/.*"([^"]+)"/\1/' || true)
  if [ -n "$OAUTH" ]; then
    curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" \
      -H "Authorization: Bearer $OAUTH" -H "Content-Type: application/json" -d "{\"subdomain\":\"$SUB\"}" >/dev/null || true
    DEPLOY_OUT=$($WR deploy 2>&1) || true
    WORKER_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)
  fi
fi
[ -n "$WORKER_URL" ] || fail "Deployed, but could not find the Worker URL. Open https://dash.cloudflare.com → Workers & Pages → canvas-mcp-connector and copy the workers.dev address."

printf '%s' "$CANVAS_URL"   | $WR secret put CANVAS_URL   >/dev/null 2>&1 || fail "Could not store CANVAS_URL."
printf '%s' "$CANVAS_TOKEN" | $WR secret put CANVAS_TOKEN >/dev/null 2>&1 || fail "Could not store CANVAS_TOKEN."
printf '%s' "$MCP_SECRET"   | $WR secret put MCP_SECRET   >/dev/null 2>&1 || fail "Could not store MCP_SECRET."
unset CANVAS_TOKEN
echo "Deployed and configured."

# Register the connector in Claude Code too, if it is installed. (CLAUDE_MCP_ADD=off skips.)
if [ "${CLAUDE_MCP_ADD:-on}" = "on" ] && command -v claude >/dev/null 2>&1; then
  claude mcp remove canvas >/dev/null 2>&1 || true
  claude mcp add --transport http canvas "$WORKER_URL/mcp" --header "Authorization: Bearer $MCP_SECRET" >/dev/null 2>&1 && echo "Added to Claude Code as 'canvas'." || true
fi

# --- 6. Done ---------------------------------------------------------------------------
say "6/6  Done"
cat <<EOF

Your connector is live.

  Connector URL:        $WORKER_URL/mcp
  Connection password:  $MCP_SECRET
  (also saved in $SECRET_FILE)

To use it in claude.ai (web, desktop, phone):
  1. claude.ai → Settings → Connectors → Add custom connector
  2. Name: Canvas   Remote MCP server URL: $WORKER_URL/mcp
  3. Add → Connect → enter the connection password → Approve
  4. New chat → "List my courses"

Run ./setup.sh again at any time to update the code, rotate the token or fix a step.
EOF
