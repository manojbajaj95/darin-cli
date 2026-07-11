import type { DarinClient, Document } from "./client.js";
import {
  type ClassifiedChange,
  type CommandMode,
  classifyAll,
  summarize,
} from "./classify.js";
import type { GlobalFlags, SyncTarget } from "./config.js";
import { contentHash } from "./hash.js";
import {
  deleteLocalFile,
  walkLocalMarkdown,
  writeConflictFile,
  writeLocalMarkdown,
} from "./local.js";
import { pairDocs } from "./pair.js";
import {
  ensureParentChain,
  ensureRemoteBody,
  loadRemoteCollection,
  type RemoteDoc,
} from "./remote.js";

export interface SyncContext {
  /** Absolute path to the local markdown folder for this target. */
  dir: string;
  client: DarinClient;
  target: SyncTarget;
  flags: GlobalFlags;
  mode: CommandMode;
}

export interface SyncResult {
  changes: ClassifiedChange[];
  summary: ReturnType<typeof summarize>;
  conflictCount: number;
}

export async function planSync(ctx: SyncContext): Promise<{
  changes: ClassifiedChange[];
  pairs: ReturnType<typeof pairDocs>;
  byPath: Map<string, RemoteDoc>;
  byId: Map<string, RemoteDoc>;
}> {
  const localDocs = await walkLocalMarkdown(ctx.dir);
  const { byPath, byId } = await loadRemoteCollection(
    ctx.client,
    ctx.target.collectionId,
    { rootDocumentId: ctx.target.rootDocumentId },
  );

  const pairsDraft = pairDocs(localDocs, byPath, byId);
  for (const pair of pairsDraft) {
    if (pair.remote && pair.remote.hash === undefined) {
      const enriched = await ensureRemoteBody(ctx.client, pair.remote);
      byPath.set(enriched.relPath, enriched);
      byId.set(enriched.id, enriched);
      pair.remote = enriched;
    }
  }

  const pairs = pairDocs(localDocs, byPath, byId);
  for (const pair of pairs) {
    if (pair.remote) {
      pair.remote = byId.get(pair.remote.id) ?? byPath.get(pair.remote.relPath) ?? pair.remote;
    }
  }

  const changes = classifyAll(pairs, {
    mode: ctx.mode,
    prune: ctx.flags.prune,
    forceLocal: ctx.flags.forceLocal,
    forceRemote: ctx.flags.forceRemote,
  });

  return { changes, pairs, byPath, byId };
}

/**
 * After a remote create/update, fetch server markdown and rewrite the local file
 * so hashes match (Darin normalizes lists/escapes on import). Preserves local
 * preamble + frontmatter.
 */
async function reconcileLocalAfterRemoteWrite(
  ctx: SyncContext,
  opts: {
    relPath: string;
    existingRaw: string;
    doc: Document;
    byPath: Map<string, RemoteDoc>;
  },
): Promise<void> {
  const info = await ctx.client.documentInfo(opts.doc.id);
  const text = info.text ?? "";
  const hash = contentHash(text);

  opts.byPath.set(opts.relPath, {
    id: info.id,
    title: info.title,
    relPath: opts.relPath,
    parentDocumentId: info.parentDocumentId,
    updatedAt: info.updatedAt,
    revision: info.revision,
    text,
    hash,
  });

  await writeLocalMarkdown(ctx.dir, opts.relPath, text, {
    id: info.id,
    existingRaw: opts.existingRaw,
  });
}

export async function applySync(ctx: SyncContext): Promise<SyncResult> {
  const dryRun = Boolean(ctx.flags.dryRun) || ctx.mode === "status";
  const { changes, pairs, byPath } = await planSync(ctx);
  const pairByPath = new Map(pairs.map((p) => [p.relPath, p]));

  let conflictCount = 0;

  for (const change of changes) {
    const pair = pairByPath.get(change.relPath);
    if (!pair) continue;

    switch (change.action) {
      case "skip":
      case "ignore":
        break;

      case "create_remote": {
        if (!pair.local) break;
        if (dryRun) break;
        const parentId = await ensureParentChain(
          ctx.client,
          ctx.target.collectionId,
          change.relPath,
          byPath,
          false,
        );
        const created = await ctx.client.documentCreate({
          title: pair.local.title,
          text: pair.local.body,
          collectionId: ctx.target.collectionId,
          parentDocumentId: parentId,
          publish: true,
        });
        await reconcileLocalAfterRemoteWrite(ctx, {
          relPath: change.relPath,
          existingRaw: pair.local.raw,
          doc: created,
          byPath,
        });
        break;
      }

      case "update_remote": {
        if (!pair.local || !pair.remote) break;
        if (dryRun) break;
        const updated = await ctx.client.documentUpdate({
          id: pair.remote.id,
          title: pair.local.title,
          text: pair.local.body,
          editMode: "replace",
        });
        await reconcileLocalAfterRemoteWrite(ctx, {
          relPath: change.relPath,
          existingRaw: pair.local.raw,
          doc: updated,
          byPath,
        });
        break;
      }

      case "create_local":
      case "update_local": {
        if (!pair.remote) break;
        const remote = await ensureRemoteBody(ctx.client, pair.remote);
        if (dryRun) break;
        await writeLocalMarkdown(ctx.dir, change.relPath, remote.text ?? "", {
          id: remote.id,
          existingRaw: pair.local?.raw,
        });
        break;
      }

      case "delete_local": {
        if (dryRun) break;
        await deleteLocalFile(ctx.dir, change.relPath);
        break;
      }

      case "delete_remote": {
        if (!pair.remote) break;
        if (dryRun) break;
        await ctx.client.documentDelete(pair.remote.id);
        byPath.delete(change.relPath);
        break;
      }

      case "conflict": {
        conflictCount += 1;
        if (dryRun || ctx.mode === "status") break;
        if (pair.remote) {
          const remote = await ensureRemoteBody(ctx.client, pair.remote);
          await writeConflictFile(ctx.dir, change.relPath, remote.text ?? "");
        }
        break;
      }
    }
  }

  return {
    changes,
    summary: summarize(changes),
    conflictCount,
  };
}

export function printSummary(result: SyncResult, dryRun: boolean): void {
  const { summary } = result;
  const prefix = dryRun ? "dry-run" : "done";
  const parts = Object.entries(summary)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`);
  console.log(`${prefix}: ${parts.join(" ") || "nothing to do"}`);

  for (const c of result.changes) {
    if (c.action === "skip") continue;
    const reason = c.reason ? ` (${c.reason})` : "";
    console.log(`  ${c.action.padEnd(14)} ${c.relPath}${reason}`);
  }
}
