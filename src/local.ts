import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { contentHash } from "./hash.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface LocalDoc {
  /** Relative path using forward slashes, e.g. guides/setup.md */
  relPath: string;
  absPath: string;
  title: string;
  /** Body synced to remote (preamble + frontmatter stripped). */
  body: string;
  /** Full file contents including preamble/frontmatter. */
  raw: string;
  /** Optional document id from frontmatter. */
  id?: string;
  mtimeMs: number;
  hash: string;
}

export interface ParsedMarkdown {
  /** Leading blank lines / HTML comments before frontmatter (local-only). */
  preamble?: string;
  /** YAML frontmatter contents without the --- fences. */
  frontmatter?: string;
  /** Markdown body synced to remote. */
  body: string;
  /** Document id from frontmatter, if present. */
  id?: string;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Split optional leading blank lines and HTML comments from the rest of the file.
 * Only used when a frontmatter block follows; otherwise the whole file is body.
 */
export function splitPreamble(raw: string): { preamble: string; rest: string } {
  let i = 0;
  const len = raw.length;

  while (i < len) {
    const blank = /^[ \t]*\r?\n/.exec(raw.slice(i));
    if (blank) {
      i += blank[0].length;
      continue;
    }

    if (raw.startsWith("<!--", i)) {
      const end = raw.indexOf("-->", i + 4);
      if (end === -1) break;
      i = end + 3;
      const trail = /^[ \t]*\r?\n?/.exec(raw.slice(i));
      if (trail) i += trail[0].length;
      continue;
    }

    break;
  }

  return { preamble: raw.slice(0, i), rest: raw.slice(i) };
}

export function parseFrontmatter(raw: string): ParsedMarkdown {
  const { preamble, rest } = splitPreamble(raw);
  const match = FRONTMATTER_RE.exec(rest);
  if (!match) return { body: raw };

  const fm = match[1];
  const body = rest.slice(match[0].length);
  const idMatch = /^id:\s*["']?([^\s"']+)["']?\s*$/m.exec(fm);
  return {
    preamble: preamble.length > 0 ? preamble : undefined,
    frontmatter: fm,
    body,
    id: idMatch?.[1],
  };
}

function withIdInFrontmatter(frontmatter: string | undefined, id: string): string {
  if (frontmatter !== undefined) {
    return /^id:/m.test(frontmatter)
      ? frontmatter.replace(/^id:\s*.*$/m, `id: ${id}`)
      : `id: ${id}\n${frontmatter}`;
  }
  return `id: ${id}`;
}

/** Rebuild a local markdown file from parts (preamble + frontmatter stay local-only). */
export function composeLocalMarkdown(opts: {
  preamble?: string;
  frontmatter?: string;
  body: string;
  id?: string;
}): string {
  const parts: string[] = [];

  if (opts.preamble) {
    parts.push(opts.preamble.endsWith("\n") ? opts.preamble : `${opts.preamble}\n`);
  }

  let fm = opts.frontmatter;
  if (opts.id) {
    fm = withIdInFrontmatter(fm, opts.id);
  }

  if (fm !== undefined) {
    parts.push(`---\n${fm}\n---\n`);
  }

  parts.push(opts.body);
  const content = parts.join("");
  return content.endsWith("\n") ? content : `${content}\n`;
}

export function titleFromPath(relPath: string): string {
  const base = path.posix.basename(relPath, path.posix.extname(relPath));
  return base;
}

/** Path segments for hierarchy, excluding the .md filename stem as last segment via path helpers. */
export function pathSegments(relPath: string): string[] {
  const posix = toPosix(relPath);
  const withoutExt = posix.replace(/\.md$/i, "");
  return withoutExt.split("/").filter(Boolean);
}

export async function walkLocalMarkdown(dir: string): Promise<LocalDoc[]> {
  const entries = await fg("**/*.md", {
    cwd: dir,
    onlyFiles: true,
    dot: false,
    ignore: ["**/*.conflict.md", "**/node_modules/**"],
  });

  const docs: LocalDoc[] = [];
  for (const rel of entries.sort()) {
    const relPath = toPosix(rel);
    if (relPath.endsWith(".conflict.md")) continue;

    const absPath = path.join(dir, rel);
    const raw = await readFile(absPath, "utf8");
    const st = await stat(absPath);
    const { body, id } = parseFrontmatter(raw);
    const title = titleFromPath(relPath);
    docs.push({
      relPath,
      absPath,
      title,
      body,
      raw,
      id,
      mtimeMs: st.mtimeMs,
      hash: contentHash(body),
    });
  }
  return docs;
}

export async function writeLocalMarkdown(
  dir: string,
  relPath: string,
  body: string,
  opts?: { id?: string; existingRaw?: string },
): Promise<void> {
  const absPath = path.join(dir, ...relPath.split("/"));
  await mkdir(path.dirname(absPath), { recursive: true });

  let content = body;
  if (opts?.id) {
    const parsed = parseFrontmatter(opts.existingRaw ?? "");
    content = composeLocalMarkdown({
      preamble: parsed.preamble,
      frontmatter: parsed.frontmatter,
      body,
      id: opts.id,
    });
  } else if (!content.endsWith("\n") && content.length > 0) {
    content = `${content}\n`;
  }

  await writeFile(absPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

export async function writeConflictFile(
  dir: string,
  relPath: string,
  remoteBody: string,
): Promise<string> {
  const conflictRel = relPath.replace(/\.md$/i, ".conflict.md");
  const absPath = path.join(dir, ...conflictRel.split("/"));
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(
    absPath,
    remoteBody.endsWith("\n") ? remoteBody : `${remoteBody}\n`,
    "utf8",
  );
  return conflictRel;
}

export async function deleteLocalFile(dir: string, relPath: string): Promise<void> {
  const absPath = path.join(dir, ...relPath.split("/"));
  await unlink(absPath);
}

export function withFrontmatterId(raw: string, id: string): string {
  const parsed = parseFrontmatter(raw);
  if (parsed.frontmatter !== undefined || parsed.preamble) {
    return composeLocalMarkdown({
      preamble: parsed.preamble,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      id,
    });
  }
  return composeLocalMarkdown({ body: raw, id });
}
