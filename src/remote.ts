import type { DarinClient, NavigationNode } from "./client.js";
import { contentHash } from "./hash.js";
import { pathSegments, titleFromPath } from "./local.js";

export interface RemoteDoc {
  id: string;
  title: string;
  /** Relative path reconstructed from tree titles, e.g. guides/setup.md */
  relPath: string;
  parentDocumentId?: string | null;
  updatedAt: string;
  revision?: number;
  text?: string;
  hash?: string;
}

export function flattenTreeToPaths(nodes: NavigationNode[]): RemoteDoc[] {
  const docs: RemoteDoc[] = [];

  function visit(list: NavigationNode[], parentSegments: string[]): void {
    for (const node of list) {
      const segments = [...parentSegments, node.title];
      docs.push({
        id: node.id,
        title: node.title,
        relPath: `${segments.join("/")}.md`,
        parentDocumentId: null,
        updatedAt: "",
      });
      if (node.children?.length) {
        visit(node.children, segments);
      }
    }
  }

  visit(nodes, []);
  return docs;
}

export function treePathIndex(nodes: NavigationNode[]): Map<string, RemoteDoc> {
  const map = new Map<string, RemoteDoc>();
  for (const doc of flattenTreeToPaths(nodes)) {
    map.set(doc.relPath, doc);
  }
  return map;
}

function findNode(nodes: NavigationNode[], id: string): NavigationNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = findNode(n.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

export async function loadRemoteCollection(
  client: DarinClient,
  collectionId: string,
  opts?: { rootDocumentId?: string },
): Promise<{
  byPath: Map<string, RemoteDoc>;
  byId: Map<string, RemoteDoc>;
  tree: NavigationNode[];
}> {
  let tree = await client.collectionDocuments(collectionId);

  if (opts?.rootDocumentId) {
    const root = findNode(tree, opts.rootDocumentId);
    tree = root ? (root.children ?? []) : [];
  }

  const stubs = flattenTreeToPaths(tree);
  const byPath = new Map<string, RemoteDoc>();
  const byId = new Map<string, RemoteDoc>();

  const listed = await client.documentsList(collectionId);
  const listById = new Map(listed.map((d) => [d.id, d]));

  for (const stub of stubs) {
    const meta = listById.get(stub.id);
    const doc: RemoteDoc = {
      ...stub,
      updatedAt: meta?.updatedAt ?? "",
      revision: meta?.revision,
      parentDocumentId: meta?.parentDocumentId,
      text: meta?.text,
      hash: meta?.text !== undefined ? contentHash(meta.text) : undefined,
    };
    byPath.set(doc.relPath, doc);
    byId.set(doc.id, doc);
  }

  for (const d of listed) {
    if (byId.has(d.id)) continue;
    const relPath = `${d.title}.md`;
    const doc: RemoteDoc = {
      id: d.id,
      title: d.title,
      relPath,
      parentDocumentId: d.parentDocumentId,
      updatedAt: d.updatedAt,
      revision: d.revision,
      text: d.text,
      hash: d.text !== undefined ? contentHash(d.text) : undefined,
    };
    if (!byPath.has(relPath)) byPath.set(relPath, doc);
    byId.set(d.id, doc);
  }

  return { byPath, byId, tree };
}

export async function ensureRemoteBody(
  client: DarinClient,
  doc: RemoteDoc,
): Promise<RemoteDoc> {
  if (doc.text !== undefined && doc.hash !== undefined) return doc;
  const info = await client.documentInfo(doc.id);
  return {
    ...doc,
    text: info.text ?? "",
    updatedAt: info.updatedAt,
    revision: info.revision,
    parentDocumentId: info.parentDocumentId,
    hash: contentHash(info.text ?? ""),
  };
}

/**
 * Ensure parent documents exist for intermediate path segments.
 * Returns parentDocumentId for the leaf (undefined = collection root).
 */
export async function ensureParentChain(
  client: DarinClient,
  collectionId: string,
  relPath: string,
  byPath: Map<string, RemoteDoc>,
  dryRun: boolean,
): Promise<string | undefined> {
  const segments = pathSegments(relPath);
  if (segments.length <= 1) return undefined;

  let parentId: string | undefined;
  const parents = segments.slice(0, -1);
  const built: string[] = [];

  for (const segment of parents) {
    built.push(segment);
    const parentPath = `${built.join("/")}.md`;
    const existing = byPath.get(parentPath);
    if (existing) {
      parentId = existing.id;
      continue;
    }

    if (dryRun) {
      parentId = `dry-run-parent:${parentPath}`;
      byPath.set(parentPath, {
        id: parentId,
        title: segment,
        relPath: parentPath,
        parentDocumentId: parentId,
        updatedAt: new Date().toISOString(),
        text: "",
        hash: contentHash(""),
      });
      continue;
    }

    const created = await client.documentCreate({
      title: segment,
      text: "",
      collectionId,
      parentDocumentId: parentId,
      publish: true,
    });
    parentId = created.id;
    byPath.set(parentPath, {
      id: created.id,
      title: created.title,
      relPath: parentPath,
      parentDocumentId: created.parentDocumentId,
      updatedAt: created.updatedAt,
      revision: created.revision,
      text: created.text ?? "",
      hash: contentHash(created.text ?? ""),
    });
  }

  return parentId;
}

export function expectedTitleForPath(relPath: string): string {
  return titleFromPath(relPath);
}
