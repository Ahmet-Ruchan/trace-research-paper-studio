import { describe, expect, it } from "vitest";
import { accessAllowed, isPublicPath } from "./access-gate";

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

describe("access gate", () => {
  it("parola tanımlı değilse hiçbir şeyi kapatmaz", () => {
    expect(accessAllowed("/", null, undefined)).toBe(true);
    expect(accessAllowed("/api/library", null, "")).toBe(true);
  });

  it("parola tanımlıysa stüdyoyu ve API'yi kapatır", () => {
    expect(accessAllowed("/", null, "s3cret")).toBe(false);
    expect(accessAllowed("/api/library", basic("trace", "wrong"), "s3cret")).toBe(false);
    expect(accessAllowed("/api/library", "Bearer s3cret", "s3cret")).toBe(false);
    expect(accessAllowed("/api/library", "Basic not-base64-with-colon", "s3cret")).toBe(false);
    expect(accessAllowed("/api/library", basic("anyone", "s3cret"), "s3cret")).toBe(true);
    // Parolanın içinde ":" olabilir; yalnızca ilk ":" ayırıcıdır.
    expect(accessAllowed("/", basic("trace", "a:b:c"), "a:b:c")).toBe(true);
  });

  it("yayımlanmış hikâyeleri ve sağlık ucunu açık bırakır, benzerlerini bırakmaz", () => {
    expect(isPublicPath("/p/AbC123")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/p/AbC123/../../api/library")).toBe(false);
    expect(isPublicPath("/p")).toBe(false);
    expect(isPublicPath("/api/health/extra")).toBe(false);
    expect(isPublicPath("/api/publications")).toBe(false);
    expect(accessAllowed("/p/AbC123", null, "s3cret")).toBe(true);
  });
});
