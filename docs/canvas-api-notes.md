# Canvas API notes for installers and maintainers

Short, practical reference for the parts of the Canvas LMS REST API this connector
touches. The authoritative documentation is Instructure's:

- **API reference (all endpoints):** https://developerdocs.instructure.com/services/canvas
- **Access tokens / OAuth2:** https://developerdocs.instructure.com/services/canvas/oauth2
- **Throttling and quotas:** https://developerdocs.instructure.com/services/canvas/basics/file.throttling
- **Pagination:** https://developerdocs.instructure.com/services/canvas/basics/file.pagination

Everything below is a summary in our own words — check the links above when it matters.

## Access tokens

- Created by the user in Canvas: **Account → Settings → Approved Integrations → "+ New
  Access Token"**. Direct link pattern: `https://<canvas-host>/profile/settings`.
- A token has the **same permissions as the user** and cannot be scoped down. Treat it as
  a password.
- Schools can disable self-service tokens (the button is missing or errors out). Then the
  token has to come from the school's IT, or the connector can't be used there.
- Tokens can have an expiry date set at creation. Canvas shows "last used" on the token
  page, and the user can revoke it there at any time.
- Format: `<number>~<long random string>`. The connector sends it as
  `Authorization: Bearer <token>`.

## Base URL

The API lives at `https://<canvas-host>/api/v1`. The connector accepts the plain host
(`https://canvas.yourschool.edu`) and adds `/api/v1` itself. Both `<school>.instructure.com`
(Instructure-hosted) and self-hosted domains work the same way.

## Status codes you will see

| Code | Meaning here | What to do |
|---|---|---|
| **200** | OK | — |
| **401** | Token invalid, expired or revoked | Create a new token, update the `CANVAS_TOKEN` secret |
| **403** with `"Not Authorized"` and *no* `User-Agent` sent | Canvas rejects requests without a User-Agent header | Already handled — the connector always sends one |
| **403** on `/courses/:id/files` | The course hides its Files tab | Use modules, pages, syllabus — linked files are still readable |
| **404** on `/pages/<url>` | Page URL double-encoded or page unpublished | Handled (`encodePageUrl`); otherwise the page really isn't visible to the student |
| **406** "Not Acceptable" with an Apache-style HTML page | Not from Canvas itself — an IP-reputation block in front of it, on the shared Cloudflare egress IP | Wait; it clears on its own, typically within hours. Not a configuration error |
| **429** | Real Canvas throttling | Back off. Sequential requests almost never hit this |
| **530 / error 1016** (from Cloudflare) | The Worker couldn't resolve the Canvas hostname | `CANVAS_URL` is wrong |

## Throttling

- Quota is **per access token** (a leaky bucket that refills faster than real time).
- Every response carries `X-Request-Cost`; `X-Rate-Limit-Remaining` appears as the quota
  runs low. Exceeding it gives **429**, not 403 or 406.
- Parallel requests pay an extra pre-flight penalty. Instructure's own guidance: a client
  making one request at a time is unlikely to be throttled. The connector's tools work
  sequentially.

## Pagination

List endpoints return at most `per_page` items (max 100) and a `Link` header with
`rel="next"`. `canvasGet()` follows it up to `maxPages`.

## Endpoints used, per tool

| Tool | Endpoint |
|---|---|
| `list_courses` | `GET /courses?enrollment_state=active&include=term` |
| `list_modules` | `GET /courses/:id/modules` |
| `list_module_items` | `GET /courses/:id/modules/:module_id/items` |
| `list_files`, `find_material` | `GET /courses/:id/files[?search_term=]` |
| `get_file_link` | `GET /files/:id`, `GET /files/:id/public_url` |
| `read_file` | `GET /files/:id` → download the pre-signed `url` |
| `list_pages` | `GET /courses/:id/pages` |
| `get_page` | `GET /courses/:id/pages/:url` |
| `get_syllabus` | `GET /courses/:id?include=syllabus_body` |
| `list_assignments` | `GET /courses/:id/assignments` |
| `get_assignment` | `GET /courses/:id/assignments/:id` |
| `get_discussion` | `GET /courses/:id/discussion_topics/:id` and `…/view` (or `/groups/:id/…`) |
| `upcoming_deadlines` | `GET /users/self/upcoming_events` |
| `list_announcements` | `GET /announcements?context_codes[]=course_:id` |
| `my_grades` | `GET /users/self/enrollments` |

All are GET. There is no write path in the connector.

## Things Canvas does that surprise people

- **Files linked inside pages** are `<a href=".../courses/X/files/NNN">` in the HTML
  body. The connector extracts those ids so they're reachable even when the Files tab is
  hidden.
- **Group discussions** (seminar groups, study forums) live under `/groups/:id`, not the
  course. `get_discussion` takes `group_id` for that.
- **Pre-signed file URLs** expire and, on some installations, are single-use. Fetch the
  link right before downloading.
- **Page URLs** returned by the API are already percent-encoded; encoding them again gives
  404.
