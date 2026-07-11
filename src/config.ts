import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

export const CONFIG_FILENAME = ".darin-sync.json";

/** One local folder ↔ one remote collection. */
export interface SyncTarget {
  /** Local folder relative to the config file directory (or absolute). */
  folder: string;
  collectionId: string;
  /** Optional: sync under a subtree of the collection. */
  rootDocumentId?: string;
  /** Optional display name for logs. */
  name?: string;
}

export interface SyncConfig {
  version: 2;
  apiUrl: string;
  syncs: SyncTarget[];
}

/** Legacy single-target config (migrated on load). */
interface SyncConfigV1 {
  version: 1;
  apiUrl: string;
  collectionId: string;
  folder?: string;
  rootDocumentId?: string;
}

export interface GlobalFlags {
  dryRun?: boolean;
  prune?: boolean;
  forceLocal?: boolean;
  forceRemote?: boolean;
  collection?: string;
  folder?: string;
  apiUrl?: string;
  apiKey?: string;
  name?: string;
}

export function resolveDir(dir?: string): string {
  return path.resolve(dir ?? process.cwd());
}

export function configPath(dir: string): string {
  return path.join(dir, CONFIG_FILENAME);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeFolder(folder: string): string {
  const normalized = folder.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized === "" ? "." : normalized;
}

function foldersEqual(a: string, b: string): boolean {
  return normalizeFolder(a) === normalizeFolder(b);
}

export function migrateConfig(raw: unknown): SyncConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid ${CONFIG_FILENAME}: expected object`);
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version === 2) {
    const apiUrl = typeof obj.apiUrl === "string" ? obj.apiUrl : "";
    const syncs = Array.isArray(obj.syncs) ? obj.syncs : null;
    if (!apiUrl || !syncs) {
      throw new Error(`Invalid ${CONFIG_FILENAME}: expected apiUrl and syncs[]`);
    }
    const parsed: SyncTarget[] = syncs.map((entry, i) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`Invalid ${CONFIG_FILENAME}: syncs[${i}] must be an object`);
      }
      const s = entry as Record<string, unknown>;
      if (typeof s.folder !== "string" || !s.folder.trim()) {
        throw new Error(`Invalid ${CONFIG_FILENAME}: syncs[${i}].folder is required`);
      }
      if (typeof s.collectionId !== "string" || !s.collectionId.trim()) {
        throw new Error(`Invalid ${CONFIG_FILENAME}: syncs[${i}].collectionId is required`);
      }
      return {
        folder: normalizeFolder(s.folder),
        collectionId: s.collectionId,
        ...(typeof s.rootDocumentId === "string" ? { rootDocumentId: s.rootDocumentId } : {}),
        ...(typeof s.name === "string" ? { name: s.name } : {}),
      };
    });
    if (parsed.length === 0) {
      throw new Error(`Invalid ${CONFIG_FILENAME}: syncs must contain at least one entry`);
    }
    return { version: 2, apiUrl: apiUrl.replace(/\/+$/, ""), syncs: parsed };
  }

  if (obj.version === 1) {
    const v1 = obj as unknown as SyncConfigV1;
    if (!v1.apiUrl || !v1.collectionId) {
      throw new Error(`Invalid ${CONFIG_FILENAME}: v1 expected apiUrl, collectionId`);
    }
    return {
      version: 2,
      apiUrl: v1.apiUrl.replace(/\/+$/, ""),
      syncs: [
        {
          folder: normalizeFolder(v1.folder ?? "."),
          collectionId: v1.collectionId,
          ...(v1.rootDocumentId ? { rootDocumentId: v1.rootDocumentId } : {}),
        },
      ],
    };
  }

  throw new Error(`Invalid ${CONFIG_FILENAME}: unsupported version`);
}

export async function loadConfig(dir: string): Promise<SyncConfig | null> {
  const file = configPath(dir);
  if (!(await fileExists(file))) return null;
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  return migrateConfig(raw);
}

export async function saveConfig(dir: string, config: SyncConfig): Promise<void> {
  await mkdir(dir, { recursive: true });
  const toWrite: SyncConfig = {
    version: 2,
    apiUrl: config.apiUrl.replace(/\/+$/, ""),
    syncs: config.syncs.map((s) => ({
      folder: normalizeFolder(s.folder),
      collectionId: s.collectionId,
      ...(s.rootDocumentId ? { rootDocumentId: s.rootDocumentId } : {}),
      ...(s.name ? { name: s.name } : {}),
    })),
  };
  await writeFile(configPath(dir), `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");
}

/** Absolute path for a sync target's local folder. */
export function resolveSyncFolder(configDir: string, target: SyncTarget): string {
  const folder = normalizeFolder(target.folder);
  return path.isAbsolute(folder) ? folder : path.resolve(configDir, folder);
}

export function resolveApiUrl(config: SyncConfig | null, flags: GlobalFlags): string {
  const url = flags.apiUrl ?? process.env.DARIN_API_URL ?? config?.apiUrl;
  if (!url) {
    throw new Error("Missing API URL. Set DARIN_API_URL or run `darin init`.");
  }
  return url.replace(/\/+$/, "");
}

export function resolveApiKey(flags: GlobalFlags): string {
  const key = flags.apiKey ?? process.env.DARIN_API_KEY;
  if (!key) {
    throw new Error("Missing API key. Set DARIN_API_KEY.");
  }
  return key;
}

/**
 * Select which sync targets to run.
 * - no filter → all
 * - --folder / --name / --collection → matching subset
 */
export function selectSyncs(config: SyncConfig, flags: GlobalFlags): SyncTarget[] {
  let selected = [...config.syncs];

  if (flags.folder) {
    const want = normalizeFolder(flags.folder);
    selected = selected.filter((s) => foldersEqual(s.folder, want));
  }
  if (flags.name) {
    selected = selected.filter((s) => s.name === flags.name);
  }
  if (flags.collection) {
    selected = selected.filter((s) => s.collectionId === flags.collection);
  }

  if (selected.length === 0) {
    const hints: string[] = [];
    if (flags.folder) hints.push(`folder=${flags.folder}`);
    if (flags.name) hints.push(`name=${flags.name}`);
    if (flags.collection) hints.push(`collection=${flags.collection}`);
    throw new Error(
      `No sync targets matched${hints.length ? ` (${hints.join(", ")})` : ""}. Check .darin-sync.json syncs[].`,
    );
  }

  return selected;
}

/** Upsert a sync target into config by folder path. */
export function upsertSyncTarget(config: SyncConfig, target: SyncTarget): SyncConfig {
  const folder = normalizeFolder(target.folder);
  const next = { ...target, folder };
  const idx = config.syncs.findIndex((s) => foldersEqual(s.folder, folder));
  const syncs = [...config.syncs];
  if (idx >= 0) {
    syncs[idx] = { ...syncs[idx], ...next };
  } else {
    syncs.push(next);
  }
  return { ...config, syncs };
}

export function targetLabel(target: SyncTarget): string {
  if (target.name) return target.name;
  return `${target.folder} → ${target.collectionId.slice(0, 8)}…`;
}
