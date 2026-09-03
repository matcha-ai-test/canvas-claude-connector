import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types";
import { htmlResponse, rateLimitOk, secretsMatch } from "./util";

const AUTHORIZE_ATTEMPTS_PER_HOUR = 10;

function consentForm(clientName: string, failed = false): Response {
  const safe = clientName.replace(/[<>&]/g, "");
  return htmlResponse(
    `<h1>Canvas connector: approve connection</h1>
<p><code>${safe}</code> is requesting <strong>read-only access</strong> to your Canvas courses.</p>
${failed ? '<p style="color:#b00">Wrong password. Try again.</p>' : ""}
<form method="POST" autocomplete="off">
  <label>Connection password:<br>
    <input type="password" name="password" style="width:100%;max-width:420px;padding:.5em;margin:.5em 0" autofocus>
  </label><br>
  <button type="submit" style="padding:.5em 1.5em">Approve</button>
</form>
<p style="color:#666;font-size:.9em">Only you can approve this. The server is read-only — it cannot change anything in Canvas.</p>`,
    failed ? 401 : 200
  );
}

/**
 * Single-user OAuth authorize endpoint: the "login" is the connection password
 * (MCP_SECRET) only the owner holds. PKCE, token issuance and client registration are
 * handled by workers-oauth-provider.
 */
export async function handleAuthorize(request: Request, env: Env & { OAUTH_PROVIDER: OAuthHelpers }): Promise<Response> {
  const url = new URL(request.url);
  const parseReq = request.method === "GET" ? request : new Request(url.toString(), { method: "GET" });
  let oauthReq: AuthRequest;
  try {
    oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(parseReq);
  } catch {
    return htmlResponse("<h1>Invalid OAuth request</h1>", 400);
  }

  if (request.method === "GET") return consentForm(oauthReq.clientId);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!(await rateLimitOk(env.OAUTH_KV, "authorize", AUTHORIZE_ATTEMPTS_PER_HOUR, 3600_000))) {
    return htmlResponse("<h1>Too many attempts</h1><p>Wait an hour and try again.</p>", 429);
  }

  const form = await request.formData();
  const password = form.get("password")?.toString() ?? "";
  if (!(await secretsMatch(password, env.MCP_SECRET))) return consentForm(oauthReq.clientId, true);

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: "owner",
    metadata: { approvedAt: new Date().toISOString() },
    scope: oauthReq.scope ?? [],
    props: { user: "owner" },
  });
  return Response.redirect(redirectTo, 302);
}
