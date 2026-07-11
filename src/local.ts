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
  /** Body synced to remote (frontmatter stripped). */
  body: string;
  /** Full file contents including frontmatter. */
  raw: string;
  /** Optional document id from frontmatter. */
  id?: string;
  mtimeMs: number;
  hash: string;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function parseFrontmatter(raw: string): {
  body: string;
  id?: string;
  frontmatter?: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { body: raw };

  const fm = match[1];
  const body = raw.slice(match[0].length);
  const idMatch = /^id:\s*["']?([^\s"']+)["']?\s*$/m.exec(fm);
  return {
    body,
    id: idMatch?.[1],
    frontmatter: fm,
  };
}

export function titleFromPath(relPath: string): string {
  const base = path.posix.basename(relPath, path.posix.extname(relPath));
  return base;
}

export function titleFromBody(body: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading) return heading[1].trim();
  return fallback;
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
    const title = titleFromBody(body, titleFromPath(relPath));
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
    if (parsed.frontmatter !== undefined) {
      const fm = /^id:/m.test(parsed.frontmatter)
        ? parsed.frontmatter.replace(/^id:\s*.*$/m, `id: ${opts.id}`)
        : `id: ${opts.id}\n${parsed.frontmatter}`;
      content = `---\n${fm}\n---\n${body}`;
    } else {
      content = `---\nid: ${opts.id}\n---\n${body}`;
    }
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
  if (parsed.frontmatter !== undefined) {
    const fm = /^id:/m.test(parsed.frontmatter)
      ? parsed.frontmatter.replace(/^id:\s*.*$/m, `id: ${id}`)
      : `id: ${id}\n${parsed.frontmatter}`;
    return `---\n${fm}\n---\n${parsed.body}`;
  }
  return `---\nid: ${id}\n---\n${raw}`;
}
