#!/usr/bin/env node
import { Command } from "commander";
import type { GlobalFlags } from "./config.js";
import { runInit } from "./commands/init.js";
import { runPull, runPush, runStatus, runSync } from "./commands/sync.js";

const program = new Command();

program
  .name("darin")
  .description("Bidirectional markdown folder sync for Darin collections")
  .version("0.1.7");

function collectFlags(cmd: Command): GlobalFlags {
  const opts = cmd.optsWithGlobals() as {
    dryRun?: boolean;
    prune?: boolean;
    forceLocal?: boolean;
    forceRemote?: boolean;
    collection?: string;
    folder?: string;
    name?: string;
    apiUrl?: string;
    apiKey?: string;
  };
  return {
    dryRun: opts.dryRun,
    prune: opts.prune,
    forceLocal: opts.forceLocal,
    forceRemote: opts.forceRemote,
    collection: opts.collection,
    folder: opts.folder,
    name: opts.name,
    apiUrl: opts.apiUrl,
    apiKey: opts.apiKey,
  };
}

function addGlobalOptions(cmd: Command): Command {
  return cmd
    .option("--dry-run", "Print planned changes without writing")
    .option("--prune", "Delete extras on the destination side")
    .option("--force-local", "On sync conflicts, prefer local")
    .option("--force-remote", "On sync conflicts, prefer remote")
    .option("--folder <path>", "Sync target folder (filter or init)")
    .option("--name <name>", "Sync target name (filter or init)")
    .option("--collection <name|url|id>", "Collection name, URL, slug, or UUID")
    .option("--api-url <url>", "API base URL (overrides config / env)")
    .option("--api-key <key>", "API key (overrides DARIN_API_KEY)");
}

async function main(): Promise<void> {
  addGlobalOptions(program);

  program
    .command("init")
    .description("Add or update a folder↔collection sync in .darin-sync.json")
    .argument("[dir]", "Directory that holds .darin-sync.json", ".")
    .action(async (dir: string, _opts, cmd: Command) => {
      await runInit(dir, collectFlags(cmd));
    });

  addGlobalOptions(
    program
      .command("status")
      .description("Show pending create/update/delete/skip without writing")
      .argument("[dir]", "Directory that holds .darin-sync.json", "."),
  ).action(async (dir: string, _opts, cmd: Command) => {
    process.exitCode = await runStatus(dir, collectFlags(cmd));
  });

  addGlobalOptions(
    program
      .command("push")
      .description("Push local markdown differences to collection(s)")
      .argument("[dir]", "Directory that holds .darin-sync.json", "."),
  ).action(async (dir: string, _opts, cmd: Command) => {
    process.exitCode = await runPush(dir, collectFlags(cmd));
  });

  addGlobalOptions(
    program
      .command("pull")
      .description("Pull collection differences into local folder(s)")
      .argument("[dir]", "Directory that holds .darin-sync.json", "."),
  ).action(async (dir: string, _opts, cmd: Command) => {
    process.exitCode = await runPull(dir, collectFlags(cmd));
  });

  addGlobalOptions(
    program
      .command("sync")
      .description("Bidirectional diff-only sync for configured folder(s)")
      .argument("[dir]", "Directory that holds .darin-sync.json", "."),
  ).action(async (dir: string, _opts, cmd: Command) => {
    process.exitCode = await runSync(dir, collectFlags(cmd));
  });

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
