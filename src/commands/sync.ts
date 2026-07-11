import { DarinClient } from "../client.js";
import type { GlobalFlags } from "../config.js";
import type { CommandMode } from "../classify.js";
import { applySync, printSummary, type SyncResult } from "../engine.js";
import { loadRuntime, resolveSyncFolder, targetLabel } from "./init.js";

async function runAll(
  dirArg: string | undefined,
  flags: GlobalFlags,
  mode: CommandMode,
): Promise<number> {
  const { configDir, config, targets, apiKey } = await loadRuntime(dirArg, flags);
  const client = new DarinClient({ apiUrl: config.apiUrl, apiKey });
  const dryRun = Boolean(flags.dryRun) || mode === "status";

  let exitCode = 0;

  for (const target of targets) {
    const dir = resolveSyncFolder(configDir, target);
    console.log(`\n[${targetLabel(target)}] ${dir}`);
    const result: SyncResult = await applySync({
      dir,
      client,
      target,
      flags: mode === "status" ? { ...flags, dryRun: true } : flags,
      mode,
    });
    printSummary(result, dryRun);
    if (result.conflictCount > 0) exitCode = 1;
  }

  return exitCode;
}

export async function runStatus(dirArg: string | undefined, flags: GlobalFlags): Promise<number> {
  return runAll(dirArg, flags, "status");
}

export async function runPush(dirArg: string | undefined, flags: GlobalFlags): Promise<number> {
  return runAll(dirArg, flags, "push");
}

export async function runPull(dirArg: string | undefined, flags: GlobalFlags): Promise<number> {
  return runAll(dirArg, flags, "pull");
}

export async function runSync(dirArg: string | undefined, flags: GlobalFlags): Promise<number> {
  return runAll(dirArg, flags, "sync");
}
