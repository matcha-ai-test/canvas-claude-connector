import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { activeCourses, canvasGet, NOT_CONFIGURED, schools, type Course } from "./canvas";
import type { Env, School, SchoolConfig } from "./types";
import { extractFileText } from "./files";
import { encodePageUrl, extractLinks, fence, htmlToText, linksBlock } from "./util";

/**
 * Read-only Canvas MCP server. Every tool goes through canvasGet(), which can only
 * issue GET requests — there is no write path in this server at all.
 *
 * Endpoints are documented at https://developerdocs.instructure.com/services/canvas.
 */
export class CanvasMCP extends McpAgent<Env, Record<string, never>, Record<string, never>> {
  server = new McpServer({ name: "canvas-claude-connector", version: "1.0.0" });

  private cfg: SchoolConfig[] = [];
  private get multi(): boolean {
    return this.cfg.length > 1;
  }

  private text(body: string) {
    return { content: [{ type: "text" as const, text: body }] };
  }

  private err(e: unknown) {
    return this.text(`Error: ${(e as Error).message}`);
  }

  /** Resolve the `school` argument: required when two schools are configured, implicit otherwise. */
  private pick(school?: string): School {
    if (this.cfg.length === 0) throw new Error(NOT_CONFIGURED);
    if (!this.multi) return this.cfg[0].key;
    if (!school) throw new Error(`Specify 'school': ${this.cfg.map((c) => c.key).join(" or ")}.`);
    return school;
  }

  private targets(school?: string): School[] {
    if (this.cfg.length === 0) throw new Error(NOT_CONFIGURED);
    return school ? [this.pick(school)] : this.cfg.map((c) => c.key);
  }

  private tag(school: School): string {
    return this.multi ? `[${school}] ` : "";
  }

  private courseLine(c: Course, school: School): string {
    const term = c.term?.name ? ` | ${c.term.name}` : "";
    return `${this.tag(school)}${c.name ?? "(untitled)"} — id ${c.id}${term}`;
  }

  async init() {
    // Never throw here: an unconfigured Worker must still answer the MCP handshake so
    // the user sees a clear error from a tool call instead of a dead connector.
    this.cfg = schools(this.env);
    const keys = (this.cfg.length ? this.cfg.map((c) => c.key) : ["unconfigured"]) as [string, ...string[]];
    const schoolDesc = `Which school: ${keys.map((k) => `'${k}'`).join(" or ")}.`;

    // With one school the argument disappears from every schema; with two it is
    // required on per-course tools and optional on cross-school tools.
    const schoolReq: Record<string, z.ZodTypeAny> = this.multi ? { school: z.enum(keys).describe(schoolDesc) } : {};
    const schoolOpt: Record<string, z.ZodTypeAny> = this.multi
      ? { school: z.enum(keys).optional().describe(`${schoolDesc} Omit to query both.`) }
      : {};
    const bothNote = this.multi ? " Without 'school', both schools are queried." : "";

    // GET /courses
    this.server.registerTool(
      "list_courses",
      {
        description: `List your Canvas courses. Use this first to find the course_id for other tools.${bothNote}`,
        inputSchema: {
          ...schoolOpt,
          include_concluded: z.boolean().optional().describe("Include concluded courses (default: active only)."),
        },
      },
      async ({ school, include_concluded }: { school?: string; include_concluded?: boolean }) => {
        try {
          const out: string[] = [];
          for (const s of this.targets(school)) {
            const courses = await activeCourses(this.env, s, include_concluded ?? false);
            if (this.multi) out.push(`${s} (${courses.length} courses):`);
            out.push(...courses.map((c) => `${this.multi ? "  " : ""}${this.courseLine(c, s)}`));
            out.push("");
          }
          return this.text(out.join("\n").trim() || "No courses found.");
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/modules
    this.server.registerTool(
      "list_modules",
      {
        description: "List the modules of a course (its content structure — weeks, topics, units).",
        inputSchema: { ...schoolReq, course_id: z.number().describe("Course id from list_courses.") },
      },
      async ({ school, course_id }: { school?: string; course_id: number }) => {
        try {
          const mods = await canvasGet<{ id: number; name?: string; items_count?: number }[]>(
            this.env, this.pick(school), `/courses/${course_id}/modules`, { per_page: 100 }, { maxPages: 3 }
          );
          if (!Array.isArray(mods) || mods.length === 0) return this.text("No modules (the course may hide the Modules tab).");
          return this.text(mods.map((m) => `- ${m.name ?? "(untitled)"} — module_id ${m.id}${m.items_count ? ` (${m.items_count} items)` : ""}`).join("\n"));
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/modules/:module_id/items
    this.server.registerTool(
      "list_module_items",
      {
        description:
          "Show the contents of a module: lectures, files, pages, links, assignments and discussions. Files here carry a file_id usable with read_file and get_file_link.",
        inputSchema: { ...schoolReq, course_id: z.number(), module_id: z.number() },
      },
      async ({ school, course_id, module_id }: { school?: string; course_id: number; module_id: number }) => {
        try {
          const items = await canvasGet<{ title?: string; type?: string; content_id?: number; html_url?: string; external_url?: string; page_url?: string }[]>(
            this.env, this.pick(school), `/courses/${course_id}/modules/${module_id}/items`, { per_page: 100 }, { maxPages: 3 }
          );
          if (!Array.isArray(items) || items.length === 0) return this.text("The module is empty.");
          return this.text(
            items
              .map((i) => {
                const ref =
                  i.type === "File" && i.content_id ? ` | file_id ${i.content_id}`
                  : i.type === "Page" && i.page_url ? ` | page_url "${i.page_url}"`
                  : i.type === "ExternalUrl" && i.external_url ? ` | ${i.external_url}`
                  : i.content_id ? ` | id ${i.content_id}` : "";
                return `- [${i.type ?? "?"}] ${i.title ?? "(untitled)"}${ref}`;
              })
              .join("\n")
          );
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/files
    this.server.registerTool(
      "list_files",
      {
        description:
          "List files in a course (lecture slides, PDFs, articles). Some courses hide the Files tab — use list_modules/list_module_items or get_page/get_syllabus instead, which surface linked files.",
        inputSchema: {
          ...schoolReq,
          course_id: z.number(),
          search: z.string().optional().describe("Filter by file name, e.g. 'lecture' or 'slides'."),
        },
      },
      async ({ school, course_id, search }: { school?: string; course_id: number; search?: string }) => {
        try {
          const files = await canvasGet<{ id: number; display_name?: string; "content-type"?: string; size?: number; updated_at?: string }[]>(
            this.env, this.pick(school), `/courses/${course_id}/files`,
            { per_page: 100, search_term: search, sort: "updated_at", order: "desc" }, { maxPages: 3 }
          );
          if (!Array.isArray(files) || files.length === 0) return this.text("No files found (or the course hides its Files tab).");
          return this.text(
            files
              .map((f) => `- ${f.display_name ?? "(untitled)"} | file_id ${f.id} | ${f["content-type"] ?? "?"}${f.size ? ` | ${Math.round(f.size / 1024)} kB` : ""}`)
              .join("\n")
          );
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /files/:id and /files/:id/public_url
    this.server.registerTool(
      "get_file_link",
      {
        description:
          "Get a time-limited download link for a file (e.g. lecture slides). Pass the file_id from list_files, list_module_items, get_page or get_syllabus.",
        inputSchema: { ...schoolReq, file_id: z.number() },
      },
      async ({ school, file_id }: { school?: string; file_id: number }) => {
        try {
          const s = this.pick(school);
          const meta = await canvasGet<{ display_name?: string; "content-type"?: string; size?: number; url?: string }>(
            this.env, s, `/files/${file_id}`
          );
          const pub = await canvasGet<{ public_url?: string }>(this.env, s, `/files/${file_id}/public_url`).catch(() => ({ public_url: undefined }));
          const link = pub.public_url ?? meta.url;
          if (!link) return this.text("No download link available for that file.");
          return this.text(
            `File: ${meta.display_name ?? file_id}\nType: ${meta["content-type"] ?? "?"}${meta.size ? `\nSize: ${Math.round(meta.size / 1024)} kB` : ""}\nLink (time-limited): ${link}`
          );
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /files/:id, then the pre-signed download URL
    this.server.registerTool(
      "read_file",
      {
        description:
          "Read the contents of a file — e.g. lecture slides in PDF. Extracts the text so it can be summarised, searched and quoted. Supports PDF and text files (txt, md, csv, html). For .pptx/.docx use get_file_link and open the file yourself.",
        inputSchema: {
          ...schoolReq,
          file_id: z.number().describe("File id from list_files, list_module_items, get_page or get_syllabus."),
          max_chars: z.number().optional().describe("Maximum characters to return (default 40000)."),
        },
      },
      async ({ school, file_id, max_chars }: { school?: string; file_id: number; max_chars?: number }) => {
        try {
          const r = await extractFileText(this.env, this.pick(school), file_id, max_chars ?? 40000);
          const head = `${r.meta.display_name ?? file_id}${r.pages ? ` — ${r.pages} pages` : ""}${r.truncated ? " (truncated; raise max_chars for more)" : ""}`;
          if (!r.text) return this.text(`${head}\n\n(No text could be extracted — the file may be a scanned image.)`);
          return this.text(`${head}\n\n${fence(`file: ${r.meta.display_name ?? file_id}`, r.text)}`);
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/files?search_term= across active courses
    this.server.registerTool(
      "find_material",
      {
        description: `Search course material by file name across your active courses — e.g. 'lecture 3', 'slides', 'exam'.${bothNote}`,
        inputSchema: {
          query: z.string().describe("Text that should match the file name."),
          ...schoolOpt,
          max_courses: z.number().optional().describe("How many courses to scan per school (default 12)."),
        },
      },
      async ({ query, school, max_courses }: { query: string; school?: string; max_courses?: number }) => {
        try {
          const cap = max_courses ?? 12;
          const hits: string[] = [];
          let scanned = 0;
          let skipped = 0;
          for (const s of this.targets(school)) {
            const courses = await activeCourses(this.env, s, false);
            const slice = courses.slice(0, cap);
            skipped += Math.max(0, courses.length - slice.length);
            for (const c of slice) {
              scanned++;
              try {
                const files = await canvasGet<{ id: number; display_name?: string; "content-type"?: string }[]>(
                  this.env, s, `/courses/${c.id}/files`, { per_page: 25, search_term: query }
                );
                if (Array.isArray(files)) {
                  for (const f of files) hits.push(`- ${this.tag(s)}${c.name ?? c.id}: ${f.display_name} | file_id ${f.id} | ${f["content-type"] ?? "?"}`);
                }
              } catch {
                // Files tab hidden for this course — not worth failing the whole search over.
              }
            }
          }
          const note = skipped > 0 ? `\n\n(Note: ${skipped} courses were not scanned — raise max_courses to include them.)` : "";
          return this.text(hits.length ? `${hits.length} hits in ${scanned} courses:\n${hits.join("\n")}${note}` : `No hits for "${query}" in ${scanned} scanned courses.${note}`);
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/pages
    this.server.registerTool(
      "list_pages",
      {
        description: "List course pages — course descriptions, schedules, instructions, reading lists.",
        inputSchema: { ...schoolReq, course_id: z.number() },
      },
      async ({ school, course_id }: { school?: string; course_id: number }) => {
        try {
          const pages = await canvasGet<{ title?: string; url?: string; updated_at?: string }[]>(
            this.env, this.pick(school), `/courses/${course_id}/pages`, { per_page: 100, sort: "updated_at", order: "desc" }, { maxPages: 2 }
          );
          if (!Array.isArray(pages) || pages.length === 0) return this.text("No pages.");
          return this.text(pages.map((p) => `- ${p.title ?? "(untitled)"} | page_url "${p.url}"`).join("\n"));
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/pages/:url
    this.server.registerTool(
      "get_page",
      {
        description: "Read a course page. Pass page_url from list_pages or list_module_items. Files linked inside the page are listed with their file_id.",
        inputSchema: { ...schoolReq, course_id: z.number(), page_url: z.string() },
      },
      async ({ school, course_id, page_url }: { school?: string; course_id: number; page_url: string }) => {
        try {
          const p = await canvasGet<{ title?: string; body?: string }>(
            this.env, this.pick(school), `/courses/${course_id}/pages/${encodePageUrl(page_url)}`
          );
          const body = htmlToText(p.body) + linksBlock(extractLinks(p.body));
          return this.text(`${p.title ?? page_url}\n\n${fence(`page: ${p.title ?? page_url}`, body)}`);
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/discussion_topics/:id and .../view (or /groups/:id/...)
    this.server.registerTool(
      "get_discussion",
      {
        description:
          "Read a discussion thread: the opening post and the replies. Pass discussion_id from list_module_items. Group discussions live under a group rather than the course — pass group_id instead of course_id for those.",
        inputSchema: {
          ...schoolReq,
          course_id: z.number().optional(),
          group_id: z.number().optional(),
          discussion_id: z.number(),
          max_entries: z.number().optional().describe("Replies to show (default 30, max 100)."),
        },
      },
      async ({ school, course_id, group_id, discussion_id, max_entries }: { school?: string; course_id?: number; group_id?: number; discussion_id: number; max_entries?: number }) => {
        try {
          if (!course_id && !group_id) return this.text("Pass course_id or group_id.");
          const s = this.pick(school);
          const base = group_id ? `/groups/${group_id}` : `/courses/${course_id}`;
          const topic = await canvasGet<{ title?: string; message?: string; posted_at?: string }>(
            this.env, s, `${base}/discussion_topics/${discussion_id}`
          );
          const head = htmlToText(topic.message) + linksBlock(extractLinks(topic.message));
          let body = `${topic.title ?? discussion_id} (${topic.posted_at ?? "?"})\n\n${head}`;

          const view = await canvasGet<{
            view?: { message?: string; user_id?: number; created_at?: string; deleted?: boolean;
                     replies?: { message?: string; created_at?: string }[] }[];
            participants?: { id: number; display_name?: string }[];
          }>(this.env, s, `${base}/discussion_topics/${discussion_id}/view`);

          const names = new Map<number, string>();
          for (const p of view.participants ?? []) names.set(p.id, p.display_name ?? String(p.id));

          const entries = (view.view ?? []).filter((e) => !e.deleted);
          const limit = Math.max(1, Math.min(max_entries ?? 30, 100));
          const shown = entries.slice(0, limit);
          if (shown.length > 0) {
            body += `\n\n--- ${entries.length} posts${entries.length > limit ? ` (showing ${limit})` : ""} ---`;
            for (const e of shown) {
              const who = e.user_id !== undefined ? names.get(e.user_id) ?? String(e.user_id) : "?";
              body += `\n\n### ${who} (${e.created_at ?? "?"})\n${htmlToText(e.message)}`;
              for (const r of e.replies ?? []) {
                body += `\n  ↳ (${r.created_at ?? "?"}) ${htmlToText(r.message)}`;
              }
            }
          } else {
            body += "\n\n(No posts in this thread.)";
          }
          return this.text(fence(`discussion: ${topic.title ?? discussion_id}`, body));
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/assignments/:id
    this.server.registerTool(
      "get_assignment",
      {
        description:
          "Read the full text of an assignment: instructions, question, deadline, scope and submission format. Pass assignment_id from list_assignments. Files linked in the text are listed with their file_id.",
        inputSchema: { ...schoolReq, course_id: z.number(), assignment_id: z.number() },
      },
      async ({ school, course_id, assignment_id }: { school?: string; course_id: number; assignment_id: number }) => {
        try {
          const a = await canvasGet<{
            name?: string;
            description?: string;
            due_at?: string;
            unlock_at?: string;
            lock_at?: string;
            points_possible?: number;
            submission_types?: string[];
            allowed_extensions?: string[];
            html_url?: string;
          }>(this.env, this.pick(school), `/courses/${course_id}/assignments/${assignment_id}`);
          const meta = [
            `Deadline in Canvas: ${a.due_at ?? "none set"}`,
            a.unlock_at ? `Opens: ${a.unlock_at}` : "",
            a.lock_at ? `Locks: ${a.lock_at}` : "",
            `Points: ${a.points_possible ?? "?"}`,
            `Submission type: ${(a.submission_types ?? []).join(", ") || "?"}`,
            a.allowed_extensions?.length ? `Allowed file types: ${a.allowed_extensions.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          const body = htmlToText(a.description) + linksBlock(extractLinks(a.description));
          return this.text(
            `${a.name ?? assignment_id}\n\n${meta}\n\n${fence(
              `assignment: ${a.name ?? assignment_id}`,
              body || "(the assignment has no text in Canvas)"
            )}`
          );
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id?include=syllabus_body
    this.server.registerTool(
      "get_syllabus",
      {
        description: "Get the course syllabus / course description. Files linked in it are listed with their file_id.",
        inputSchema: { ...schoolReq, course_id: z.number() },
      },
      async ({ school, course_id }: { school?: string; course_id: number }) => {
        try {
          const c = await canvasGet<{ name?: string; syllabus_body?: string }>(
            this.env, this.pick(school), `/courses/${course_id}`, { include: "syllabus_body" }
          );
          const body = htmlToText(c.syllabus_body) + linksBlock(extractLinks(c.syllabus_body));
          if (!body) return this.text(`${c.name ?? course_id}: no syllabus published.`);
          return this.text(`${c.name ?? course_id}\n\n${fence("syllabus", body)}`);
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /courses/:id/assignments
    this.server.registerTool(
      "list_assignments",
      {
        description: "List the assignments of a course with deadlines and points.",
        inputSchema: { ...schoolReq, course_id: z.number() },
      },
      async ({ school, course_id }: { school?: string; course_id: number }) => {
        try {
          const a = await canvasGet<{ name?: string; due_at?: string; points_possible?: number; id: number }[]>(
            this.env, this.pick(school), `/courses/${course_id}/assignments`, { per_page: 100, order_by: "due_at" }, { maxPages: 2 }
          );
          if (!Array.isArray(a) || a.length === 0) return this.text("No assignments.");
          return this.text(a.map((x) => `- ${x.name ?? "(untitled)"} | due ${x.due_at ?? "none"} | ${x.points_possible ?? "?"} pts | id ${x.id}`).join("\n"));
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /users/self/upcoming_events
    this.server.registerTool(
      "upcoming_deadlines",
      {
        description: `Upcoming deadlines and events across your courses.${bothNote}`,
        inputSchema: { ...schoolOpt },
      },
      async ({ school }: { school?: string }) => {
        try {
          const lines: string[] = [];
          for (const s of this.targets(school)) {
            const ev = await canvasGet<{ title?: string; assignment?: { due_at?: string }; start_at?: string; html_url?: string }[]>(
              this.env, s, "/users/self/upcoming_events", { per_page: 50 }
            ).catch(() => []);
            const list = Array.isArray(ev) ? ev : [];
            if (this.multi) lines.push(`${s}:${list.length ? "" : " nothing upcoming"}`);
            else if (!list.length) lines.push("Nothing upcoming.");
            for (const e of list) lines.push(`${this.multi ? "  " : ""}- ${e.title ?? "(untitled)"} | ${e.assignment?.due_at ?? e.start_at ?? "?"}`);
          }
          return this.text(lines.join("\n"));
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /announcements?context_codes[]=course_:id
    this.server.registerTool(
      "list_announcements",
      {
        description: "Read course announcements from teachers.",
        inputSchema: { ...schoolReq, course_id: z.number(), limit: z.number().optional() },
      },
      async ({ school, course_id, limit }: { school?: string; course_id: number; limit?: number }) => {
        try {
          const ann = await canvasGet<{ title?: string; posted_at?: string; message?: string }[]>(
            this.env, this.pick(school), "/announcements", { "context_codes[]": `course_${course_id}`, per_page: limit ?? 10 }
          );
          if (!Array.isArray(ann) || ann.length === 0) return this.text("No announcements.");
          return this.text(
            ann.map((a) => `### ${a.title ?? "(untitled)"} (${a.posted_at ?? "?"})\n${fence("announcement", htmlToText(a.message))}`).join("\n\n")
          );
        } catch (e) {
          return this.err(e);
        }
      }
    );

    // GET /users/self/enrollments
    this.server.registerTool(
      "my_grades",
      {
        description: `Your own grades/scores per course.${bothNote}`,
        inputSchema: { ...schoolOpt },
      },
      async ({ school }: { school?: string }) => {
        try {
          const lines: string[] = [];
          for (const s of this.targets(school)) {
            const en = await canvasGet<{ course_id: number; grades?: { current_score?: number; current_grade?: string } }[]>(
              this.env, s, "/users/self/enrollments", { state: "active", per_page: 100 }, { maxPages: 2 }
            ).catch(() => []);
            const courses = await activeCourses(this.env, s, false);
            const byId = new Map(courses.map((c) => [c.id, c.name ?? String(c.id)]));
            if (this.multi) lines.push(`${s}:`);
            for (const e of Array.isArray(en) ? en : []) {
              const g = e.grades;
              if (!g || (g.current_score == null && !g.current_grade)) continue;
              lines.push(`${this.multi ? "  " : ""}- ${byId.get(e.course_id) ?? `course ${e.course_id}`}: ${g.current_score ?? ""}${g.current_grade ? ` (${g.current_grade})` : ""}`);
            }
          }
          return this.text(lines.join("\n") || "No grades posted yet.");
        } catch (e) {
          return this.err(e);
        }
      }
    );
  }
}
