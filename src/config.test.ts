import { describe, expect, it } from "vitest";
import {
  migrateConfig,
  selectSyncs,
  upsertSyncTarget,
  type SyncConfig,
} from "./config.js";

describe("migrateConfig", () => {
  it("migrates v1 single-target config", () => {
    const cfg = migrateConfig({
      version: 1,
      apiUrl: "https://example.com/",
      collectionId: "col-1",
      folder: "docs",
    });
    expect(cfg.version).toBe(2);
    expect(cfg.apiUrl).toBe("https://example.com");
    expect(cfg.syncs).toEqual([{ folder: "docs", collectionId: "col-1" }]);
  });

  it("defaults v1 folder to .", () => {
    const cfg = migrateConfig({
      version: 1,
      apiUrl: "https://example.com",
      collectionId: "col-1",
    });
    expect(cfg.syncs[0].folder).toBe(".");
  });

  it("parses v2 syncs list", () => {
    const cfg = migrateConfig({
      version: 2,
      apiUrl: "https://example.com",
      syncs: [
        { folder: "a", collectionId: "1", name: "Alpha" },
        { folder: "b/c", collectionId: "2" },
      ],
    });
    expect(cfg.syncs).toHaveLength(2);
    expect(cfg.syncs[0].name).toBe("Alpha");
  });
});

describe("selectSyncs / upsertSyncTarget", () => {
  const config: SyncConfig = {
    version: 2,
    apiUrl: "https://example.com",
    syncs: [
      { folder: "docs/product", collectionId: "c1", name: "product" },
      { folder: "docs/eng", collectionId: "c2", name: "eng" },
    ],
  };

  it("returns all syncs by default", () => {
    expect(selectSyncs(config, {})).toHaveLength(2);
  });

  it("filters by folder", () => {
    const selected = selectSyncs(config, { folder: "docs/eng" });
    expect(selected).toHaveLength(1);
    expect(selected[0].collectionId).toBe("c2");
  });

  it("filters by name", () => {
    const selected = selectSyncs(config, { name: "product" });
    expect(selected[0].folder).toBe("docs/product");
  });

  it("upserts by folder", () => {
    const next = upsertSyncTarget(config, {
      folder: "docs/product",
      collectionId: "c1-new",
      name: "product",
    });
    expect(next.syncs).toHaveLength(2);
    expect(next.syncs[0].collectionId).toBe("c1-new");

    const added = upsertSyncTarget(config, {
      folder: "docs/legal",
      collectionId: "c3",
    });
    expect(added.syncs).toHaveLength(3);
  });
});
