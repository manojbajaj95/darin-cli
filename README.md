# @getdarin/cli

Bidirectional, **diff-only** markdown sync between a local folder and a [Darin](https://getdarin.com) collection.

Point the CLI at one or more folders, each mapped to a collection. Unchanged documents are skipped — only creates, updates, and optional deletes are applied.

> Darin’s editor uses a CRDT (Yjs) for live collaboration. This CLI syncs markdown **snapshots** over the REST API, not CRDT peers.

## Install

```bash
npm install -g @getdarin/cli
# or
npx @getdarin/cli --help
```

Requires Node 20+.

## Quick start

1. Create an API key in Darin (**Settings → API Keys**).
2. Copy a collection URL from the browser.
3. Init and pull:

```bash
export DARIN_API_KEY=ol_api_...

darin init --folder ./docs \
  --collection https://agentr.getdarin.com/collection/darin-product-wiki-nzkrdOW9vo/recent

darin pull
darin status   # should report skips once in sync
```

A full collection URL is enough — the CLI derives the API host and resolves the collection (no UUID required). You can also pass a collection **name**, **slug**, **urlId**, or **UUID** (with `--api-url` / `DARIN_API_URL` if the host is not in the URL).

Repeat `darin init --folder … --collection …` to add more folder ↔ collection pairs.

## Config

`darin init` writes `.darin-sync.json` next to your project (folder-level config only — no per-file ledger):

```json
{
  "version": 2,
  "apiUrl": "https://agentr.getdarin.com",
  "syncs": [
    { "folder": "docs", "collectionId": "<uuid>", "name": "product" },
    { "folder": "notes", "collectionId": "<uuid>" }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `apiUrl` | Darin API origin |
| `syncs[].folder` | Local markdown folder (relative to the config file, or absolute) |
| `syncs[].collectionId` | Resolved collection UUID (or a name/URL still resolved at runtime) |
| `syncs[].name` | Optional label for logs / `--name` filter |
| `syncs[].rootDocumentId` | Optional: sync under a subtree of the collection |

## Commands

`[dir]` is the directory that contains `.darin-sync.json` (default: `.`).

| Command | Behavior |
|---------|----------|
| `darin status [dir]` | Classify create / update / delete / skip (no writes) |
| `darin push [dir]` | Local → remote (diff only) |
| `darin pull [dir]` | Remote → local (diff only) |
| `darin sync [dir]` | Bidirectional; last-write-wins on conflicts |
| `darin init [dir]` | Add or update a sync target |

Filter to one target:

```bash
darin sync --folder docs
darin push --name product
darin pull --collection <uuid-or-name>
```

### Flags

| Flag | Meaning |
|------|---------|
| `--folder <path>` | Init: folder to sync. Commands: filter |
| `--name <name>` | Optional label; also a filter |
| `--collection <name\|url\|id>` | Collection name, URL, slug, or UUID |
| `--dry-run` | Plan only |
| `--prune` | Delete extras on the destination |
| `--force-local` / `--force-remote` | Resolve sync conflicts in one direction |
| `--api-url` / `--api-key` | Override env/config |

## How diffing works

Each run rebuilds state from scratch (no last-sync database):

1. **Local** — walk `folder/**/*.md` (skip `*.conflict.md`). Hash = SHA-256 of the body after stripping frontmatter (normalized newlines).
2. **Remote** — load the collection document tree. Paths are rebuilt from titles (`PRODUCT` → `PRODUCT.md`, `guides/setup` → `guides/setup.md`).
3. **Pair** — match by frontmatter `id:` (document UUID) first, else by relative path.
4. **Classify**

| Situation | `push` | `pull` | `sync` |
|-----------|--------|--------|--------|
| Local only | create remote | ignore (`--prune` deletes local) | create remote |
| Remote only | ignore (`--prune` deletes remote) | write file | write file |
| Same content hash | **skip** | **skip** | **skip** |
| Different hash | update remote | update local | last-write-wins\* |

\*On `sync`, compare local mtime vs remote `updatedAt`. Newer wins. If timestamps are within 2s → write `*.conflict.md` (remote body), keep local, exit non-zero — unless `--force-local` / `--force-remote`.

## Mapping

- Nested folders become nested documents via `parentDocumentId`
- Intermediate folder segments create parent documents as needed
- On create, the CLI writes `id: <uuid>` into YAML frontmatter so renames still rematch

## Environment

| Variable | Meaning |
|----------|---------|
| `DARIN_API_KEY` | API key (required for sync commands) |
| `DARIN_API_URL` | Optional host override when not using a collection URL |

## Development

```bash
npm install
npm test
npm run build
node dist/index.js --help
```

## Release

Releases are automated with [Release Please](https://github.com/googleapis/release-please) (config under `.github/`).

- Conventional Commits on `main` open/update a release PR
- Merging that PR tags a GitHub Release and publishes `@getdarin/cli` to npm via OIDC trusted publishing
- One-time npm setup: package **Trusted publishing** → repo `manojbajaj95/darin-cli`, workflow `release-please.yml` (Node 24). The first publish must be manual before OIDC works.

## License

Apache-2.0
