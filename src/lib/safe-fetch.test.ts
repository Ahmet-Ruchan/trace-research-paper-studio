import { describe, expect, it } from "vitest";
import { fetchPublicSource } from "./safe-fetch";

describe("safe source fetcher", () => {
  it.each(["http://127.0.0.1/private", "http://10.0.0.4", "http://192.168.1.2"])(
    "blocks private address %s",
    async (url) => {
      await expect(fetchPublicSource(url, "private")).rejects.toThrow();
    },
  );

  it("blocks non-http protocols", async () => {
    await expect(fetchPublicSource("file:///etc/passwd", "file")).rejects.toThrow();
  });
});

