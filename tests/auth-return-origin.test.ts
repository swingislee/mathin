import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authReturnOrigin, requestPublicOrigin } from "@/lib/auth-return-origin";
afterEach(() => vi.unstubAllEnvs());
describe("Auth callback origins behind the reverse proxy", () => {
  it("uses the registered public origin instead of the internal listener", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
    const request = new Request("http://0.0.0.0:3131/zh/auth/callback", { headers: { host: "app.example.com", "x-forwarded-proto": "https" } });
    expect(requestPublicOrigin(request)).toBe("https://app.example.com");
    expect(authReturnOrigin(request)).toBe("https://app.example.com");
  });
  it("rejects an injected host rather than redirecting authentication there", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
    for (const host of ["evil.example", "app.example.com@evil.example", "app.example.com,evil.example"]) {
      const request = new Request("http://0.0.0.0:3131/zh/auth/callback", { headers: { host, "x-forwarded-proto": "https" } });
      expect(authReturnOrigin(request)).toBe("https://app.example.com");
    }
  });
  it("keeps approved LAN development redirects usable", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3130");
    expect(authReturnOrigin(new Request("http://0.0.0.0:3130/zh/auth/callback", { headers: { host: "192.168.5.213:3130" } })))
      .toBe("http://192.168.5.213:3130");
  });
});
