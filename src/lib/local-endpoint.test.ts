import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_ENDPOINT, localUrl, resolveLocalEndpoint } from "./local-endpoint";

describe("resolveLocalEndpoint", () => {
  it("falls back to Ollama's default when nothing is given", () => {
    expect(resolveLocalEndpoint(undefined)).toBe(DEFAULT_LOCAL_ENDPOINT);
    expect(resolveLocalEndpoint("   ")).toBe(DEFAULT_LOCAL_ENDPOINT);
  });

  it("keeps the path, because LM Studio serves under /v1", () => {
    expect(resolveLocalEndpoint("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1");
  });

  it("trims a trailing slash", () => {
    expect(resolveLocalEndpoint("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1");
  });

  it("assumes http when the user omits the scheme", () => {
    expect(resolveLocalEndpoint("localhost:1234/v1")).toBe("http://localhost:1234/v1");
  });

  it("accepts every loopback spelling", () => {
    expect(resolveLocalEndpoint("http://localhost:11434")).toBe("http://localhost:11434");
    expect(resolveLocalEndpoint("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
    expect(resolveLocalEndpoint("http://127.1.2.3:11434")).toBe("http://127.1.2.3:11434");
    expect(resolveLocalEndpoint("http://[::1]:11434")).toBe("http://[::1]:11434");
  });

  it("refuses any address that is not on this machine", () => {
    // İstek sunucudan çıkıyor: doğrulanmazsa klasik bir SSRF olurdu.
    for (const address of [
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.10:11434",
      "http://10.0.0.5:11434",
      "https://api.example.com/v1",
      "http://127.0.0.1.evil.com:11434",
    ]) {
      expect(() => resolveLocalEndpoint(address)).toThrow(/address on this machine/i);
    }
  });

  it("refuses an address carrying credentials", () => {
    expect(() => resolveLocalEndpoint("http://user:pass@127.0.0.1:11434")).toThrow(/credentials/i);
  });

  it("refuses text that is not an address at all", () => {
    expect(() => resolveLocalEndpoint("http://")).toThrow(/not a valid address/i);
  });

  it("joins a path with or without a leading slash", () => {
    expect(localUrl("http://127.0.0.1:11434/v1", "/chat/completions")).toBe(
      "http://127.0.0.1:11434/v1/chat/completions",
    );
    expect(localUrl("http://127.0.0.1:11434/v1", "models")).toBe("http://127.0.0.1:11434/v1/models");
  });
});
