import { describe, expect, it } from "vitest";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../next.config";

describe("authorization response headers", () => {
  it.each(["zh", "en"])("keeps %s authorization URLs out of Referer", async (locale) => {
    for (const path of ["callback", "wechat/callback", "wechat/authorize", "wechat/token", "wechat/userinfo", "wechat/guest"]) {
      const response = await unstable_getResponseFromNextConfig({
        url: `https://app.example.com/${locale}/auth/${path}?code=opaque-proof&state=opaque-state`,
        nextConfig,
      });
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("retains the existing referrer policy on normal pages", async () => {
    const response = await unstable_getResponseFromNextConfig({ url: "https://app.example.com/zh/login", nextConfig });
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
