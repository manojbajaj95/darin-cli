import type { GlobalFlags } from "../config.js";
import {
  loadConfig,
  resolveApiKey,
  resolveApiUrl,
  resolveDir,
  resolveSyncFolder,
  saveConfig,
  selectSyncs,
  targetLabel,
  upsertSyncTarget,
  type SyncConfig,
  type SyncTarget,
} from "../config.js";
import { DarinClient } from "../client.js";
import { parseCollectionRef } from "../collection-ref.js";

export async function runInit(
  dirArg: string | undefined,
  flags: GlobalFlags,
): Promise<void> {
  const configDir = resolveDir(dirArg);
  const existing = await loadConfig(configDir);

  const collectionRef = flags.collection;
  const folder = flags.folder;

  if (!collectionRef) {
    throw new Error(
      'Provide --collection <url> (e.g. https://agentr.getdarin.com/collection/darin-product-wiki-nzkrdOW9vo/recent)',
    );
  }
  if (!folder) {
    throw new Error("Provide --folder <path> (local markdown folder to sync)");
  }

  const parsed = parseCollectionRef(collectionRef);
  const apiUrl =
    flags.apiUrl ??
    process.env.DARIN_API_URL ??
    parsed.apiUrl ??
    existing?.apiUrl;

  if (!apiUrl) {
    throw new Error(
      "Could not determine API URL. Pass a full collection URL " +
        "(https://host/collection/...) or set --api-url / DARIN_API_URL.",
    );
  }

  const normalizedApiUrl = apiUrl.replace(/\/+$/, "");

  // Prefer storing UUID when API key is available; otherwise keep the human ref.
  let collectionId = collectionRef;
  let resolvedLabel = collectionRef;
  const apiKey = flags.apiKey ?? process.env.DARIN_API_KEY;
  if (apiKey) {
    const client = new DarinClient({ apiUrl: normalizedApiUrl, apiKey });
    const collection = await client.resolveCollection(collectionRef);
    collectionId = collection.id;
    resolvedLabel = `${collection.name} (${collection.urlId ?? collection.id})`;
  } else if (parsed.apiUrl) {
    // Keep a stable slug from the URL when we cannot resolve yet
    collectionId = parsed.tokens[0] ?? collectionRef;
  }

  const target: SyncTarget = {
    folder,
    collectionId,
    ...(flags.name ? { name: flags.name } : {}),
  };

  const base: SyncConfig = existing ?? {
    version: 2,
    apiUrl: normalizedApiUrl,
    syncs: [],
  };

  const config = upsertSyncTarget({ ...base, apiUrl: normalizedApiUrl }, target);

  await saveConfig(configDir, config);
  console.log(`Wrote ${configDir}/.darin-sync.json`);
  console.log(`  apiUrl: ${config.apiUrl}`);
  if (apiKey) {
    console.log(`  resolved: ${resolvedLabel}`);
  }
  for (const s of config.syncs) {
    const mark = foldersMatch(s.folder, folder) ? "*" : " ";
    console.log(
      `  ${mark} ${s.folder}  collection=${s.collectionId}${s.name ? `  (${s.name})` : ""}`,
    );
  }
}

function foldersMatch(a: string, b: string): boolean {
  return (
    a.replace(/\\/g, "/").replace(/\/+$/, "") ===
    b.replace(/\\/g, "/").replace(/\/+$/, "")
  );
}

export interface Runtime {
  configDir: string;
  config: SyncConfig;
  targets: SyncTarget[];
  apiKey: string;
  flags: GlobalFlags;
}

export async function loadRuntime(
  dirArg: string | undefined,
  flags: GlobalFlags,
): Promise<Runtime> {
  const configDir = resolveDir(dirArg);
  const fileConfig = await loadConfig(configDir);
  if (!fileConfig) {
    throw new Error(
      `No ${configDir}/.darin-sync.json — run \`darin init --folder <path> --collection <url>\``,
    );
  }

  // Allow overriding host via a collection URL on the command line
  let apiUrl = resolveApiUrl(fileConfig, flags);
  if (flags.collection) {
    const parsed = parseCollectionRef(flags.collection);
    if (parsed.apiUrl) apiUrl = parsed.apiUrl;
  }

  const apiKey = resolveApiKey(flags);
  const config: SyncConfig = { ...fileConfig, apiUrl };
  const targets = selectSyncs(config, flags);

  return { configDir, config, targets, apiKey, flags };
}

export { resolveSyncFolder, targetLabel };
