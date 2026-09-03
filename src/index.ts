import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { CanvasMCP } from "./mcp";
import { handleAuthorize } from "./oauth";
import type { Env } from "./types";
import { bearerFrom, htmlResponse, secretsMatch } from "./util";

export { CanvasMCP };

const mcpHandler = CanvasMCP.serve("/mcp", { binding: "MCP_OBJECT" });

// The `as never` casts below exist because workers-oauth-provider's generics don't
// accept our Env type; behaviour is unaffected.

const defaultHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/authorize") return await handleAuthorize(request, env as Parameters<typeof handleAuthorize>[1]);
      if (path === "/") {
        return htmlResponse(
          `<h1>Canvas connector</h1>
<p>A private, read-only bridge between one person's Canvas courses and Claude.</p>
<p>To use it, add <code>${new URL(request.url).origin}/mcp</code> as a custom connector in claude.ai.</p>`
        );
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      console.error("Unhandled error:", (e as Error).message);
      return new Response("Internal error", { status: 500 });
    }
  },
};

/**
 * OAuth 2.1 provider in front of /mcp (for claude.ai / Claude Desktop custom
 * connectors): serves /.well-known metadata, /token, /register (DCR) and validates
 * issued tokens. Tokens are stored in KV.
 */
const oauthProvider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpHandler as never,
  defaultHandler: defaultHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      // DNS-rebinding protection: reject browser requests from foreign origins
      const origin = request.headers.get("Origin");
      if (origin) {
        try {
          if (new URL(origin).host !== url.host) return new Response("Forbidden", { status: 403 });
        } catch {
          return new Response("Forbidden", { status: 403 });
        }
      }
      // Static-bearer fast path (CLI clients that can't run the browser OAuth flow).
      // Everything else falls through to OAuth token validation in the provider.
      const bearer = bearerFrom(request);
      if (bearer && (await secretsMatch(bearer, env.MCP_SECRET))) {
        return mcpHandler.fetch(request, env, ctx);
      }
    }

    return oauthProvider.fetch(request, env as never, ctx);
  },
};
