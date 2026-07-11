import { createHash } from "node:crypto";

/** Stable content hash for markdown body comparison. */
export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeBody(text)).digest("hex");
}

/** Normalize line endings and trailing whitespace for stable diffs. */
export function normalizeBody(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+$/u, "") + (text.length ? "\n" : "");
}
