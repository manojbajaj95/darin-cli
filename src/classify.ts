import type { PairedDoc } from "./pair.js";

export type ChangeKind =
  | "local_only"
  | "remote_only"
  | "same"
  | "different";

export type SyncAction =
  | "skip"
  | "create_remote"
  | "update_remote"
  | "create_local"
  | "update_local"
  | "delete_local"
  | "delete_remote"
  | "conflict"
  | "ignore";

export type CommandMode = "push" | "pull" | "sync" | "status";

export interface ClassifiedChange {
  relPath: string;
  kind: ChangeKind;
  action: SyncAction;
  localHash?: string;
  remoteHash?: string;
  reason?: string;
}

export interface ClassifyOptions {
  mode: CommandMode;
  prune?: boolean;
  forceLocal?: boolean;
  forceRemote?: boolean;
  /** Milliseconds; timestamps within this window are ambiguous. */
  skewMs?: number;
}

const DEFAULT_SKEW_MS = 2000;

export function classifyPair(
  pair: PairedDoc,
  opts: ClassifyOptions,
): ClassifiedChange {
  const skewMs = opts.skewMs ?? DEFAULT_SKEW_MS;
  const { local, remote } = pair;

  if (local && !remote) {
    return actionForLocalOnly(pair.relPath, local.hash, opts);
  }

  if (remote && !local) {
    return actionForRemoteOnly(pair.relPath, remote.hash, opts);
  }

  if (!local || !remote) {
    return { relPath: pair.relPath, kind: "same", action: "skip" };
  }

  const localHash = local.hash;
  const remoteHash = remote.hash ?? "";

  if (localHash === remoteHash) {
    return {
      relPath: pair.relPath,
      kind: "same",
      action: "skip",
      localHash,
      remoteHash,
    };
  }

  return actionForDifferent(pair.relPath, local, remote, localHash, remoteHash, opts, skewMs);
}

function actionForLocalOnly(
  relPath: string,
  localHash: string,
  opts: ClassifyOptions,
): ClassifiedChange {
  const base: ClassifiedChange = {
    relPath,
    kind: "local_only",
    action: "ignore",
    localHash,
  };

  switch (opts.mode) {
    case "push":
    case "sync":
      return { ...base, action: "create_remote" };
    case "pull":
      return opts.prune
        ? { ...base, action: "delete_local" }
        : { ...base, action: "ignore", reason: "local only (use --prune to delete)" };
    case "status":
      return { ...base, action: "create_remote", reason: "would create remote on push/sync" };
  }
}

function actionForRemoteOnly(
  relPath: string,
  remoteHash: string | undefined,
  opts: ClassifyOptions,
): ClassifiedChange {
  const base: ClassifiedChange = {
    relPath,
    kind: "remote_only",
    action: "ignore",
    remoteHash,
  };

  switch (opts.mode) {
    case "pull":
    case "sync":
      return { ...base, action: "create_local" };
    case "push":
      return opts.prune
        ? { ...base, action: "delete_remote" }
        : { ...base, action: "ignore", reason: "remote only (use --prune to delete)" };
    case "status":
      return { ...base, action: "create_local", reason: "would create local on pull/sync" };
  }
}

function actionForDifferent(
  relPath: string,
  local: { mtimeMs: number },
  remote: { updatedAt: string },
  localHash: string,
  remoteHash: string,
  opts: ClassifyOptions,
  skewMs: number,
): ClassifiedChange {
  const base: ClassifiedChange = {
    relPath,
    kind: "different",
    action: "skip",
    localHash,
    remoteHash,
  };

  if (opts.mode === "push") {
    return { ...base, action: "update_remote" };
  }
  if (opts.mode === "pull") {
    return { ...base, action: "update_local" };
  }

  // sync + status: last-write-wins with skew conflict
  if (opts.forceLocal) return { ...base, action: "update_remote" };
  if (opts.forceRemote) return { ...base, action: "update_local" };

  const remoteMs = Date.parse(remote.updatedAt);
  if (!Number.isFinite(remoteMs) || !remote.updatedAt) {
    return {
      ...base,
      action: "conflict",
      reason: "content differs; remote updatedAt missing",
    };
  }

  const delta = local.mtimeMs - remoteMs;
  if (Math.abs(delta) <= skewMs) {
    return {
      ...base,
      action: "conflict",
      reason: `content differs; timestamps within ${skewMs}ms skew`,
    };
  }

  if (delta > 0) {
    return { ...base, action: "update_remote", reason: "local newer" };
  }
  return { ...base, action: "update_local", reason: "remote newer" };
}

export function classifyAll(
  pairs: PairedDoc[],
  opts: ClassifyOptions,
): ClassifiedChange[] {
  return pairs.map((p) => classifyPair(p, opts));
}

export function summarize(changes: ClassifiedChange[]): Record<SyncAction, number> {
  const counts: Record<SyncAction, number> = {
    skip: 0,
    create_remote: 0,
    update_remote: 0,
    create_local: 0,
    update_local: 0,
    delete_local: 0,
    delete_remote: 0,
    conflict: 0,
    ignore: 0,
  };
  for (const c of changes) counts[c.action] += 1;
  return counts;
}
