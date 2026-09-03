import type { Env, School, SchoolConfig } from "./types";

function normalizeBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Accept both "https://canvas.yourschool.edu" and ".../api/v1".
  return withScheme.replace(/\/api\/v1$/i, "") + "/api/v1";
}

function keyFor(url: string, label?: string): School {
  if (label && label.trim()) return label.trim();
  try {
    return new URL(normalizeBase(url)).hostname;
  } catch {
    return url;
  }
}

/**
 * Schools configured through the environment. One is required; a second is optional.
 * The key is what tools accept as the `school` argument when two are configured.
 */
export function schools(env: Env): SchoolConfig[] {
  const out: SchoolConfig[] = [];
  if (env.CANVAS_URL && env.CANVAS_TOKEN) {
    out.push({ key: keyFor(env.CANVAS_URL, env.CANVAS_LABEL), base: normalizeBase(env.CANVAS_URL), token: env.CANVAS_TOKEN });
  }
  if (env.CANVAS_URL_2 && env.CANVAS_TOKEN_2) {
    let key = keyFor(env.CANVAS_URL_2, env.CANVAS_LABEL_2);
    if (out.some((s) => s.key === key)) key = `${key}-2`;
    out.push({ key, base: normalizeBase(env.CANVAS_URL_2), token: env.CANVAS_TOKEN_2 });
  }
  return out;
}

export const NOT_CONFIGURED = "No Canvas configured. Set the CANVAS_URL and CANVAS_TOKEN secrets on the Worker (Cloudflare dashboard → your Worker → Settings → Variables and Secrets).";

function creds(env: Env, school: School): SchoolConfig {
  const cfg = schools(env);
  if (cfg.length === 0) throw new Error(NOT_CONFIGURED);
  const hit = cfg.find((s) => s.key === school) ?? (cfg.length === 1 ? cfg[0] : undefined);
  if (!hit) throw new Error(`Unknown school "${school}". Configured: ${cfg.map((s) => s.key).join(", ")}.`);
  return hit;
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/**
 * GET against the Canvas REST API (https://developerdocs.instructure.com/services/canvas).
 * Read-only by construction: this client offers no way to issue anything but GET, so
 * no tool in this server can modify Canvas.
 */
export async function canvasGet<T = unknown>(
  env: Env,
  school: School,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  opts: { maxPages?: number } = {}
): Promise<T> {
  const { base, token, key } = creds(env, school);
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

  const maxPages = opts.maxPages ?? 1;
  let target: string | null = url.toString();
  const collected: unknown[] = [];
  let first: unknown = null;

  for (let page = 0; page < maxPages && target; page++) {
    const res: Response = await fetch(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // Canvas rejects requests without a User-Agent (403 "Not Authorized").
        // Workers' fetch sends none by default. The value is deliberately generic:
        // the token already identifies the user fully in Canvas logs, and there is
        // no reason to advertise the tool name there too.
        "User-Agent": "User 1",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Canvas (${key}) responded ${res.status} on ${path}: ${body.slice(0, 200)}`);
    }
    const data: unknown = await res.json();
    if (page === 0) first = data;
    if (Array.isArray(data)) collected.push(...data);
    else return data as T;
    target = nextLink(res.headers.get("Link"));
  }
  return (Array.isArray(first) ? collected : first) as T;
}

export interface Course {
  id: number;
  name?: string;
  course_code?: string;
  term?: { name?: string };
  enrollments?: { type?: string; enrollment_state?: string }[];
}

/** GET /courses — the user's enrolments (active by default). */
export async function activeCourses(env: Env, school: School, includeConcluded = false): Promise<Course[]> {
  const courses = await canvasGet<Course[]>(
    env,
    school,
    "/courses",
    {
      enrollment_state: includeConcluded ? undefined : "active",
      state: includeConcluded ? "available,completed" : undefined,
      include: "term",
      per_page: 100,
    },
    { maxPages: 3 }
  );
  return Array.isArray(courses) ? courses : [];
}
