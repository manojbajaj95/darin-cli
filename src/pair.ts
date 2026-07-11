import type { LocalDoc } from "./local.js";
import type { RemoteDoc } from "./remote.js";

export interface PairedDoc {
  relPath: string;
  local?: LocalDoc;
  remote?: RemoteDoc;
}

/**
 * Pair local files with remote docs by:
 * 1. frontmatter id → remote id
 * 2. relative path (tree title segments)
 */
export function pairDocs(
  localDocs: LocalDoc[],
  remoteByPath: Map<string, RemoteDoc>,
  remoteById: Map<string, RemoteDoc>,
): PairedDoc[] {
  const usedRemoteIds = new Set<string>();
  const pairs: PairedDoc[] = [];
  const localByPath = new Map(localDocs.map((d) => [d.relPath, d]));

  for (const local of localDocs) {
    let remote: RemoteDoc | undefined;

    if (local.id && remoteById.has(local.id)) {
      remote = remoteById.get(local.id);
    } else {
      remote = remoteByPath.get(local.relPath);
    }

    if (remote) usedRemoteIds.add(remote.id);
    pairs.push({ relPath: local.relPath, local, remote });
  }

  for (const [relPath, remote] of remoteByPath) {
    if (usedRemoteIds.has(remote.id)) continue;
    if (localByPath.has(relPath)) continue;
    pairs.push({ relPath, remote });
    usedRemoteIds.add(remote.id);
  }

  // Remotes matched only by id may have a different path — already paired above.
  // Orphan remotes not in byPath (shouldn't happen) skipped.

  return pairs.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
