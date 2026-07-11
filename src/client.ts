import { matchCollection, parseCollectionRef } from "./collection-ref.js";

export class DarinApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "DarinApiError";
  }
}

export interface DarinClientOptions {
  apiUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface NavigationNode {
  id: string;
  title: string;
  url: string;
  children: NavigationNode[];
}

export interface Document {
  id: string;
  urlId?: string;
  title: string;
  text?: string;
  collectionId?: string | null;
  parentDocumentId?: string | null;
  updatedAt: string;
  revision?: number;
  publishedAt?: string | null;
}

export interface Collection {
  id: string;
  urlId?: string;
  name: string;
  url?: string;
}

export interface Pagination {
  offset?: number;
  limit?: number;
}

export class DarinClient {
  readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private collectionIdCache = new Map<string, string>();

  constructor(opts: DarinClientOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.apiUrl}/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    if (!res.ok) {
      const msg =
        typeof json === "object" &&
        json !== null &&
        "message" in json &&
        typeof (json as { message: unknown }).message === "string"
          ? (json as { message: string }).message
          : `API ${method} failed (${res.status})`;
      throw new DarinApiError(msg, res.status, json);
    }

    return json as T;
  }

  /**
   * Resolve a collection reference to a UUID.
   * Accepts UUID, urlId, URL slug, full collection URL, or display name.
   */
  async resolveCollectionId(ref: string): Promise<string> {
    const parsed = parseCollectionRef(ref);
    if (parsed.isUuid) return parsed.raw;

    const cached = this.collectionIdCache.get(parsed.raw);
    if (cached) return cached;

    const collections = await this.collectionsList();
    let match: Collection | undefined;
    try {
      match = matchCollection(collections, parsed);
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }

    if (!match) {
      const known = collections
        .map((c) => `"${c.name}" (${c.urlId ?? c.id})`)
        .join(", ");
      throw new Error(
        `Collection not found: ${parsed.raw}${known ? `. Known: ${known}` : ""}`,
      );
    }

    this.collectionIdCache.set(parsed.raw, match.id);
    for (const token of parsed.tokens) {
      this.collectionIdCache.set(token, match.id);
    }
    return match.id;
  }

  /** Resolve and return the matched collection (for init/logging). */
  async resolveCollection(ref: string): Promise<Collection> {
    const id = await this.resolveCollectionId(ref);
    const collections = await this.collectionsList();
    const found = collections.find((c) => c.id === id);
    if (!found) {
      return { id, name: ref, urlId: undefined };
    }
    return found;
  }

  async collectionsList(): Promise<Collection[]> {
    const limit = 100;
    let offset = 0;
    const all: Collection[] = [];
    for (;;) {
      const res = await this.call<{ data: Collection[] }>("collections.list", {
        limit,
        offset,
      });
      const batch = res.data ?? [];
      all.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }
    return all;
  }

  async collectionDocuments(collectionId: string): Promise<NavigationNode[]> {
    const id = await this.resolveCollectionId(collectionId);
    const res = await this.call<{ data: NavigationNode[] }>("collections.documents", {
      id,
    });
    return res.data ?? [];
  }

  async documentsList(
    collectionId: string,
    pagination: Pagination = {},
  ): Promise<Document[]> {
    const resolvedId = await this.resolveCollectionId(collectionId);
    const limit = pagination.limit ?? 100;
    let offset = pagination.offset ?? 0;
    const all: Document[] = [];

    for (;;) {
      const res = await this.call<{
        data: Document[];
        pagination?: { offset?: number; limit?: number; nextPath?: string };
      }>("documents.list", {
        collectionId: resolvedId,
        limit,
        offset,
        statusFilter: ["published", "draft"],
      });
      const batch = res.data ?? [];
      all.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return all;
  }

  async documentInfo(id: string): Promise<Document> {
    const res = await this.call<{ data: Document }>("documents.info", { id });
    return res.data;
  }

  async documentCreate(input: {
    title: string;
    text: string;
    collectionId: string;
    parentDocumentId?: string;
    publish?: boolean;
  }): Promise<Document> {
    const collectionId = await this.resolveCollectionId(input.collectionId);
    const res = await this.call<{ data: Document }>("documents.create", {
      title: input.title,
      text: input.text,
      collectionId,
      parentDocumentId: input.parentDocumentId,
      publish: input.publish ?? true,
    });
    return res.data;
  }

  async documentUpdate(input: {
    id: string;
    title?: string;
    text: string;
    editMode?: "replace" | "append" | "prepend" | "patch";
  }): Promise<Document> {
    const res = await this.call<{ data: Document }>("documents.update", {
      id: input.id,
      title: input.title,
      text: input.text,
      editMode: input.editMode ?? "replace",
    });
    return res.data;
  }

  async documentMove(input: {
    id: string;
    collectionId?: string;
    parentDocumentId?: string | null;
  }): Promise<void> {
    await this.call("documents.move", {
      id: input.id,
      collectionId: input.collectionId,
      parentDocumentId: input.parentDocumentId,
    });
  }

  async documentDelete(id: string, permanent = false): Promise<void> {
    await this.call("documents.delete", { id, permanent });
  }
}
