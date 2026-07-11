import { describe, expect, it } from "vitest";
import { matchCollection, parseCollectionRef } from "./collection-ref.js";

const collections = [
  {
    id: "71951192-61bf-4669-8914-257d7eff77e3",
    urlId: "nzkrdOW9vo",
    name: "Darin Product Wiki",
    url: "/collection/darin-product-wiki-nzkrdOW9vo",
  },
  {
    id: "8eda2145-8fc0-496c-b18e-2d34c9fc0f07",
    urlId: "omfHtT3zGO",
    name: "Welcome",
    url: "/collection/welcome-omfHtT3zGO",
  },
];

describe("parseCollectionRef", () => {
  it("parses full collection URLs", () => {
    const parsed = parseCollectionRef(
      "https://agentr.getdarin.com/collection/darin-product-wiki-nzkrdOW9vo/recent",
    );
    expect(parsed.isUuid).toBe(false);
    expect(parsed.apiUrl).toBe("https://agentr.getdarin.com");
    expect(parsed.tokens).toContain("darin-product-wiki-nzkrdow9vo");
    expect(parsed.tokens).toContain("nzkrdow9vo");
  });

  it("parses relative collection paths", () => {
    const parsed = parseCollectionRef("/collection/darin-product-wiki-nzkrdOW9vo");
    expect(parsed.tokens).toContain("darin-product-wiki-nzkrdow9vo");
  });

  it("keeps display names", () => {
    const parsed = parseCollectionRef("Darin Product Wiki");
    expect(parsed.tokens).toEqual(["darin product wiki"]);
  });

  it("detects UUIDs", () => {
    const id = "71951192-61bf-4669-8914-257d7eff77e3";
    const parsed = parseCollectionRef(id);
    expect(parsed.isUuid).toBe(true);
  });
});

describe("matchCollection", () => {
  it("matches by full URL", () => {
    const ref = parseCollectionRef(
      "https://agentr.getdarin.com/collection/darin-product-wiki-nzkrdOW9vo/recent",
    );
    expect(matchCollection(collections, ref)?.name).toBe("Darin Product Wiki");
  });

  it("matches by collection name", () => {
    const ref = parseCollectionRef("Darin Product Wiki");
    expect(matchCollection(collections, ref)?.urlId).toBe("nzkrdOW9vo");
  });

  it("matches by partial unique name", () => {
    const ref = parseCollectionRef("product wiki");
    expect(matchCollection(collections, ref)?.name).toBe("Darin Product Wiki");
  });

  it("matches by urlId", () => {
    const ref = parseCollectionRef("nzkrdOW9vo");
    expect(matchCollection(collections, ref)?.id).toBe(
      "71951192-61bf-4669-8914-257d7eff77e3",
    );
  });

  it("matches by slug", () => {
    const ref = parseCollectionRef("darin-product-wiki-nzkrdOW9vo");
    expect(matchCollection(collections, ref)?.name).toBe("Darin Product Wiki");
  });
});
