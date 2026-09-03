import { canvasGet } from "./canvas";
import type { Env, School } from "./types";
import { htmlToText } from "./util";

const MAX_BYTES = 25 * 1024 * 1024;

export interface FileMeta {
  id: number;
  display_name?: string;
  "content-type"?: string;
  size?: number;
  url?: string;
}

/** GET /files/:id */
export async function fileMeta(env: Env, school: School, fileId: number): Promise<FileMeta> {
  return await canvasGet<FileMeta>(env, school, `/files/${fileId}`);
}

/** Canvas file URLs are pre-signed, so no Authorization header is needed (or wanted) here. */
async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { headers: { "User-Agent": "User 1" } });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const len = Number(res.headers.get("Content-Length") ?? "0");
  if (len > MAX_BYTES) throw new Error(`File is too large (${Math.round(len / 1024 / 1024)} MB, max 25 MB).`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error("File is too large (max 25 MB).");
  return buf;
}

export interface ExtractResult {
  text: string;
  pages?: number;
  truncated: boolean;
}

/**
 * Extract readable text from a Canvas file. PDFs go through unpdf (a Workers-compatible
 * pdf.js build); text-ish formats are decoded directly. Binary Office formats are not
 * supported and say so rather than returning garbage.
 */
export async function extractFileText(env: Env, school: School, fileId: number, maxChars: number): Promise<ExtractResult & { meta: FileMeta }> {
  const meta = await fileMeta(env, school, fileId);
  const type = (meta["content-type"] ?? "").toLowerCase();
  const name = (meta.display_name ?? "").toLowerCase();
  if (!meta.url) throw new Error("No download URL available for this file.");

  const isPdf = type.includes("pdf") || name.endsWith(".pdf");
  const isTextish =
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    /\.(txt|md|csv|json|html?|rtf)$/.test(name);

  if (!isPdf && !isTextish) {
    throw new Error(
      `Cannot read "${meta.display_name}" (${meta["content-type"] ?? "unknown type"}). ` +
        `Text extraction supports PDF and text files. Use get_file_link to open the file yourself.`
    );
  }

  const buf = await download(meta.url);
  let text: string;
  let pages: number | undefined;

  if (isPdf) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const out = await extractText(doc, { mergePages: true });
    pages = out.totalPages;
    text = Array.isArray(out.text) ? out.text.join("\n\n") : out.text;
  } else {
    const raw = new TextDecoder("utf-8").decode(buf);
    text = /<\/?[a-z][\s\S]*>/i.test(raw) && (type.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) ? htmlToText(raw) : raw;
  }

  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = text.length > maxChars;
  return { meta, pages, truncated, text: truncated ? text.slice(0, maxChars) : text };
}
