export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;

  // Secrets — set in the Deploy to Cloudflare flow, or with `wrangler secret put`.
  /** Your school's Canvas address, e.g. https://canvas.yourschool.edu */
  CANVAS_URL: string;
  /** Canvas access token (Canvas → Account → Settings → New Access Token). */
  CANVAS_TOKEN: string;
  /** The password you enter when connecting from claude.ai. */
  MCP_SECRET: string;

  // Optional: a short display name for the school (defaults to the Canvas hostname).
  CANVAS_LABEL?: string;

  // Optional second school (for people enrolled at two institutions).
  CANVAS_URL_2?: string;
  CANVAS_TOKEN_2?: string;
  CANVAS_LABEL_2?: string;
}

/** Key identifying a configured school — the label, or the Canvas hostname. */
export type School = string;

export interface SchoolConfig {
  key: School;
  base: string;
  token: string;
}
