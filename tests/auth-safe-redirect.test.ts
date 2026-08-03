import { describe, expect, it } from "vitest";
import { resolveSafeReturnTo } from "@/lib/safe-redirect";

// AUTH-04：登录 `next` 与回调 `next` 不得构成开放重定向。两个消费点
// （`(auth)/actions.ts` 的 signIn、`auth/callback/route.ts`）共用本函数，
// 它是整条链路上唯一的校验，因此在此固化接受/拒绝矩阵。
const FALLBACK = "/zh/dashboard";

describe("resolveSafeReturnTo", () => {
  it.each([
    ["/zh/dashboard/students", "同 locale 站内路径"],
    ["/zh/dashboard/students?status=active", "保留 query"],
    ["/zh/notebook#top", "保留 hash"],
  ])("accepts %s (%s)", (raw) => {
    expect(resolveSafeReturnTo(raw, "zh", FALLBACK)).toBe(raw);
  });

  it.each([
    ["https://example.com/", "绝对外部 URL"],
    ["http://example.com/", "绝对外部 URL（http）"],
    ["//example.com/", "协议相对 URL"],
    ["///example.com/", "多斜杠协议相对 URL"],
    ["javascript:alert(1)", "伪协议"],
    ["/dashboard", "缺 locale 前缀"],
    ["/zh", "缺尾斜杠，避免匹配到 /zhouv 之类前缀"],
    ["/zhang/dashboard", "locale 前缀仅是子串"],
    ["/en/dashboard", "跨 locale 一律回落"],
    ["", "空串"],
    [null, "缺省"],
    [undefined, "缺省"],
  ])("rejects %s (%s)", (raw) => {
    expect(resolveSafeReturnTo(raw, "zh", FALLBACK)).toBe(FALLBACK);
  });

  it("keeps the fallback aligned with the caller's locale", () => {
    expect(resolveSafeReturnTo("/zh/dashboard", "en", "/en/dashboard")).toBe("/en/dashboard");
    expect(resolveSafeReturnTo("/en/dashboard", "en", "/en/dashboard")).toBe("/en/dashboard");
  });

  it("never yields a cross-origin destination once resolved against the request origin", () => {
    const origin = "https://mathin.example";
    const probes = [
      "https://example.com/",
      "//example.com/",
      "/zh//example.com/", // 通过白名单，但仍然解析回本站
      "/zh/dashboard",
      "javascript:alert(1)",
      null,
    ];

    for (const probe of probes) {
      const resolved = new URL(resolveSafeReturnTo(probe, "zh", FALLBACK), origin);
      expect(resolved.origin).toBe(origin);
    }
  });
});
