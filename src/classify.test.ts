import { describe, expect, it } from "vitest";
import { contentHash, normalizeBody } from "./hash.js";
import { classifyAll, classifyPair } from "./classify.js";
import { pairDocs } from "./pair.js";
import { flattenTreeToPaths, treePathIndex } from "./remote.js";
import {
  parseFrontmatter,
  pathSegments,
  titleFromPath,
} from "./local.js";
import type { NavigationNode } from "./client.js";
import type { LocalDoc } from "./local.js";
import type { RemoteDoc } from "./remote.js";

describe("hash", () => {
  it("normalizes line endings for stable hashes", () => {
    expect(contentHash("a\r\nb\r\n")).toBe(contentHash("a\nb\n"));
  });

  it("treats trailing whitespace as insignificant via normalize", () => {
    expect(normalizeBody("hi  \n")).toBe("hi\n");
  });
});

describe("local path helpers", () => {
  it("parses frontmatter id", () => {
    const raw = "---\nid: abc-123\n---\n# Hello\n";
    const parsed = parseFrontmatter(raw);
    expect(parsed.id).toBe("abc-123");
    expect(parsed.body).toBe("# Hello\n");
  });

  it("derives path segments and titles from filenames", () => {
    expect(pathSegments("guides/setup.md")).toEqual(["guides", "setup"]);
    expect(titleFromPath("guides/setup.md")).toBe("setup");
    expect(titleFromPath("Setup Guide.md")).toBe("Setup Guide");
  });
});

describe("remote tree paths", () => {
  const tree: NavigationNode[] = [
    {
      id: "1",
      title: "guides",
      url: "/doc/guides",
      children: [
        { id: "2", title: "setup", url: "/doc/setup", children: [] },
      ],
    },
  ];

  it("flattens tree to relative markdown paths", () => {
    const docs = flattenTreeToPaths(tree);
    expect(docs.map((d) => d.relPath)).toEqual(["guides.md", "guides/setup.md"]);
  });

  it("indexes by path", () => {
    const idx = treePathIndex(tree);
    expect(idx.get("guides/setup.md")?.id).toBe("2");
  });
});

describe("pairDocs", () => {
  it("pairs by path and frontmatter id", () => {
    const local: LocalDoc[] = [
      {
        relPath: "a.md",
        absPath: "/tmp/a.md",
        title: "a",
        body: "one",
        raw: "one",
        mtimeMs: 1,
        hash: contentHash("one"),
      },
      {
        relPath: "renamed.md",
        absPath: "/tmp/renamed.md",
        title: "renamed",
        body: "two",
        raw: "---\nid: remote-2\n---\ntwo",
        id: "remote-2",
        mtimeMs: 1,
        hash: contentHash("two"),
      },
    ];

    const remoteByPath = new Map<string, RemoteDoc>([
      [
        "a.md",
        {
          id: "remote-1",
          title: "a",
          relPath: "a.md",
          updatedAt: "2026-01-01T00:00:00.000Z",
          hash: contentHash("one"),
          text: "one",
        },
      ],
      [
        "old-name.md",
        {
          id: "remote-2",
          title: "old-name",
          relPath: "old-name.md",
          updatedAt: "2026-01-01T00:00:00.000Z",
          hash: contentHash("two"),
          text: "two",
        },
      ],
    ]);
    const remoteById = new Map(
      [...remoteByPath.values()].map((d) => [d.id, d]),
    );

    const pairs = pairDocs(local, remoteByPath, remoteById);
    const byRel = Object.fromEntries(pairs.map((p) => [p.relPath, p]));

    expect(byRel["a.md"]?.remote?.id).toBe("remote-1");
    expect(byRel["renamed.md"]?.remote?.id).toBe("remote-2");
    // old-name should not appear as remote_only since id was consumed
    expect(pairs.find((p) => p.relPath === "old-name.md")).toBeUndefined();
  });
});

describe("classify", () => {
  const local = (hash: string, mtimeMs: number): LocalDoc => ({
    relPath: "doc.md",
    absPath: "/tmp/doc.md",
    title: "doc",
    body: "x",
    raw: "x",
    mtimeMs,
    hash,
  });

  const remote = (hash: string, updatedAt: string): RemoteDoc => ({
    id: "r1",
    title: "doc",
    relPath: "doc.md",
    updatedAt,
    hash,
    text: "x",
  });

  it("skips equal content", () => {
    const h = contentHash("same");
    const change = classifyPair(
      { relPath: "doc.md", local: local(h, 1000), remote: remote(h, "2026-01-01T00:00:00.000Z") },
      { mode: "sync" },
    );
    expect(change.action).toBe("skip");
    expect(change.kind).toBe("same");
  });

  it("creates remote for local_only on push", () => {
    const change = classifyPair(
      { relPath: "new.md", local: local("abc", 1) },
      { mode: "push" },
    );
    expect(change.action).toBe("create_remote");
  });

  it("creates local for remote_only on pull", () => {
    const change = classifyPair(
      { relPath: "new.md", remote: remote("abc", "2026-01-01T00:00:00.000Z") },
      { mode: "pull" },
    );
    expect(change.action).toBe("create_local");
  });

  it("uses last-write-wins on sync when timestamps differ", () => {
    const localNewer = classifyPair(
      {
        relPath: "doc.md",
        local: local("aaa", Date.parse("2026-06-02T00:00:00.000Z")),
        remote: remote("bbb", "2026-06-01T00:00:00.000Z"),
      },
      { mode: "sync" },
    );
    expect(localNewer.action).toBe("update_remote");

    const remoteNewer = classifyPair(
      {
        relPath: "doc.md",
        local: local("aaa", Date.parse("2026-06-01T00:00:00.000Z")),
        remote: remote("bbb", "2026-06-02T00:00:00.000Z"),
      },
      { mode: "sync" },
    );
    expect(remoteNewer.action).toBe("update_local");
  });

  it("conflicts when timestamps are within skew", () => {
    const t = Date.parse("2026-06-01T00:00:00.000Z");
    const change = classifyPair(
      {
        relPath: "doc.md",
        local: local("aaa", t + 500),
        remote: remote("bbb", new Date(t).toISOString()),
      },
      { mode: "sync", skewMs: 2000 },
    );
    expect(change.action).toBe("conflict");
  });

  it("force flags override conflicts", () => {
    const t = Date.parse("2026-06-01T00:00:00.000Z");
    const forced = classifyPair(
      {
        relPath: "doc.md",
        local: local("aaa", t),
        remote: remote("bbb", new Date(t).toISOString()),
      },
      { mode: "sync", forceLocal: true },
    );
    expect(forced.action).toBe("update_remote");
  });

  it("summarizes a mixed set", () => {
    const h = contentHash("same");
    const changes = classifyAll(
      [
        { relPath: "a.md", local: local(h, 1), remote: remote(h, "2026-01-01T00:00:00.000Z") },
        { relPath: "b.md", local: local("x", 1) },
      ],
      { mode: "push" },
    );
    expect(changes.map((c) => c.action)).toEqual(["skip", "create_remote"]);
  });
});
