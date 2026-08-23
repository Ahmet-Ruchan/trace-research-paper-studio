import { describe, expect, it } from "vitest";
import { absoluteLink, claimHash, elementId, parseDeepLink, sectionHash } from "./deep-link";

describe("deep links", () => {
  it("round-trips a claim id", () => {
    expect(parseDeepLink(claimHash("claim-method-01"))).toEqual({ kind: "claim", id: "claim-method-01" });
  });

  it("round-trips a section id", () => {
    expect(parseDeepLink(sectionHash("story-architecture"))).toEqual({
      kind: "section",
      id: "story-architecture",
    });
  });

  it("round-trips an id carrying characters that would break a hash", () => {
    // Kimlikler şemada serbest metin; kodlanmasa "#" hash'i ikiye bölerdi.
    const id = "claim #3 / 100% recall";
    expect(claimHash(id)).not.toContain(" ");
    expect(parseDeepLink(claimHash(id))).toEqual({ kind: "claim", id });
  });

  it("accepts a hash with or without the leading marker", () => {
    expect(parseDeepLink("claim-c1")).toEqual({ kind: "claim", id: "c1" });
    expect(parseDeepLink("#claim-c1")).toEqual({ kind: "claim", id: "c1" });
  });

  it("ignores an empty or unrelated hash", () => {
    expect(parseDeepLink("")).toBeUndefined();
    expect(parseDeepLink("#")).toBeUndefined();
    expect(parseDeepLink("#page=4")).toBeUndefined();
    expect(parseDeepLink("#claim-")).toBeUndefined();
  });

  it("keeps a half-encoded hash usable instead of throwing", () => {
    // Elle yazılmış bir bağlantı bozuk olabilir; decodeURIComponent orada
    // URIError fırlatır ve tüm açılışı düşürürdü.
    expect(parseDeepLink("#claim-%zz")).toEqual({ kind: "claim", id: "%zz" });
  });

  it("builds the DOM id the anchor points at", () => {
    expect(elementId({ kind: "claim", id: "c1" })).toBe("claim-c1");
    expect(elementId({ kind: "section", id: "s1" })).toBe("section-s1");
  });

  it("replaces an existing hash and keeps the query string", () => {
    expect(absoluteLink("http://localhost:3000/?sample=1#claim-old", claimHash("c2"))).toBe(
      "http://localhost:3000/?sample=1#claim-c2",
    );
    expect(absoluteLink("http://localhost:3000/", sectionHash("s1"))).toBe(
      "http://localhost:3000/#section-s1",
    );
  });
});
