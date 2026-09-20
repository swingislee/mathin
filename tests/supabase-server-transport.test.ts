import { createServerClient } from "@supabase/ssr";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseServerFetch } from "@/lib/supabase/server-transport";

vi.mock("server-only", () => ({}));
const canonical = "https://project.example.test";
const gateway = "http://127.0.0.1:8000";

describe("server Supabase transport", () => {
  it("keeps the SDK default when no server gateway is configured", () => {
    expect(createSupabaseServerFetch(canonical, "")).toBeUndefined();
  });

  it.each([
    "https://remote.example.test", "http://192.168.5.183:8000", "http://localhost:8000",
    "http://127.0.0.1", "http://127.0.0.1:8000/other", "http://127.0.0.1:8000/?key=x",
    "http://127.0.0.1:8000/#x", "http://user:secret@127.0.0.1:8000",
  ])("rejects an unqualified gateway: %s", url => {
    expect(() => createSupabaseServerFetch(canonical, url)).toThrow();
  });

  it("preserves an authenticated RPC's method, body, headers, cache and cancellation", async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    const send = createSupabaseServerFetch(canonical, gateway, transport)!;
    const init: RequestInit = { method: "POST", body: '{"p_scope":"mine"}', headers: { authorization: "Bearer fixture-user", apikey: "fixture-publishable" }, signal: controller.signal, cache: "no-store" };
    await send(`${canonical}/rest/v1/rpc/read_page?select=id`, init);
    expect(String(transport.mock.calls[0][0])).toBe(`${gateway}/rest/v1/rpc/read_page?select=id`);
    expect(transport.mock.calls[0][1]).toBe(init);
  });

  it("preserves Request bodies and the caller's options", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const send = createSupabaseServerFetch(canonical, gateway, transport)!;
    const request = new Request(`${canonical}/auth/v1/token?grant_type=password`, { method: "POST", body: "fixture-body", headers: { apikey: "fixture-publishable" } });
    await send(request, { redirect: "manual" });
    const forwarded = transport.mock.calls[0][0] as Request;
    expect(forwarded.url).toBe(`${gateway}/auth/v1/token?grant_type=password`);
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe("fixture-body");
    expect(forwarded.headers.get("apikey")).toBe("fixture-publishable");
    expect(transport.mock.calls[0][1]).toEqual({ redirect: "manual" });
  });

  it("keeps resource URLs and other origins on their existing transport", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const send = createSupabaseServerFetch(canonical, gateway, transport)!;
    for (const input of [`${canonical}/storage/v1/object/public/a/b`, `${canonical}/rest/v10/rpc/test`, "https://another.example.test/auth/v1/user"]) {
      await send(input);
      expect(transport.mock.lastCall?.[0]).toBe(input);
    }
  });

  it("preserves a signing Request's credentials, payload and cancellation", async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    const send = createSupabaseServerFetch(canonical, gateway, transport)!;
    const request = new Request(`${canonical}/storage/v1/object/sign/avatars`, {
      method: "POST", body: JSON.stringify({ paths: ["a.png"], expiresIn: 60 }),
      headers: { authorization: "Bearer fixture-user", apikey: "fixture-publishable" },
      signal: controller.signal, cache: "no-store",
    });
    await send(request);
    const forwarded = transport.mock.calls[0][0] as Request;
    expect(forwarded.url).toBe(`${gateway}/storage/v1/object/sign/avatars`);
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.json()).toEqual({ paths: ["a.png"], expiresIn: 60 });
    expect(forwarded.headers.get("authorization")).toBe("Bearer fixture-user");
    expect(forwarded.headers.get("apikey")).toBe("fixture-publishable");
    expect(forwarded.cache).toBe("no-store");
    controller.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it("uses the caller's method override when routing signing requests", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    const send = createSupabaseServerFetch(canonical, gateway, transport)!;
    const request = new Request(`${canonical}/storage/v1/object/sign/avatars`);
    const init = { method: "post", body: '{"paths":["a.png"],"expiresIn":60}' };
    await send(request, init);
    expect((transport.mock.calls[0][0] as Request).url).toBe(`${gateway}/storage/v1/object/sign/avatars`);
    expect(transport.mock.calls[0][1]).toBe(init);
    const postRequest = new Request(request, { method: "POST" });
    await send(postRequest, { method: "GET" });
    expect(transport.mock.lastCall?.[0]).toBe(postRequest);
  });

  it.each([
    ["GET", `${canonical}/storage/v1/object/sign/avatars/a.png?token=fixture`],
    ["HEAD", `${canonical}/storage/v1/object/sign/avatars/a.png?token=fixture`],
    ["DELETE", `${canonical}/storage/v1/object/sign/avatars/a.png`],
    ["POST", `${canonical}/storage/v1/object/upload/sign/avatars/a.png`],
    ["POST", `${canonical}/storage/v1/object/avatars/a.png`],
    ["POST", `${canonical}/storage/v1/object/signature/avatars/a.png`],
    ["POST", "https://another.example.test/storage/v1/object/sign/avatars"],
  ])("keeps non-signing traffic on its current transport: %s %s", async (method, input) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const send = createSupabaseServerFetch(canonical, gateway, transport)!;
    const init = { method };
    await send(input, init);
    expect(transport.mock.calls[0]).toEqual([input, init]);
  });

  it("returns signing failures without retrying or changing credentials", async () => {
    const denied = Response.json({ message: "permission denied" }, { status: 403 });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(denied);
    const send = createSupabaseServerFetch(canonical, gateway, transport)!;
    const init = { method: "POST", headers: { authorization: "Bearer fixture-user" } };
    const url = `${canonical}/storage/v1/object/sign/avatars`;
    expect(await send(url, init)).toBe(denied);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]).toBe(init);
    transport.mockRejectedValueOnce(new Error("connection refused"));
    await expect(send(url, init)).rejects.toThrow("connection refused");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("returns authentication and database failures without retrying through another origin", async () => {
    const denied = Response.json({ message: "permission denied" }, { status: 403 });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(denied);
    const send = createSupabaseServerFetch(canonical, gateway, transport)!;
    expect(await send(`${canonical}/rest/v1/private_rows`)).toBe(denied);
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockRejectedValueOnce(new Error("connection refused"));
    await expect(send(`${canonical}/auth/v1/user`)).rejects.toThrow("connection refused");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("keeps separate SSR cookies, public resource URLs and user credentials with the real SDK", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    for (const identity of ["one", "two"]) {
      const cookieWrites: Array<{ name: string; value: string }> = [];
      const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: identity, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture-signature`;
      const transport: typeof fetch = async (input, init) => {
        const url = String(input);
        requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
        if (url.includes("/storage/v1/object/sign/")) {
          expect(init?.method).toBe("POST");
          const body = JSON.parse(String(init?.body));
          expect(body.expiresIn).toBe(60);
          return Response.json(Array.isArray(body.paths)
            ? body.paths.map((path: string) => ({ path, error: null, signedURL: `/object/sign/avatars/${path}?token=fixture-${identity}` }))
            : { signedURL: `/object/sign/avatars/a.png?token=fixture-${identity}` });
        }
        return Response.json(url.includes("/token?")
          ? { access_token: token, token_type: "bearer", expires_in: 3600, refresh_token: `fixture-refresh-${identity}`, user: { id: identity, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" } }
          : [{ visible_to: identity }]);
      };
      const client = createServerClient(canonical, "fixture-publishable", {
        global: { fetch: createSupabaseServerFetch(canonical, gateway, transport) },
        cookies: { getAll: () => cookieWrites, setAll: items => { for (const item of items) { const index=cookieWrites.findIndex(c=>c.name===item.name); if(index>=0)cookieWrites.splice(index,1); cookieWrites.push(item); } } },
      });
      expect((await client.auth.signInWithPassword({ email: `${identity}@example.test`, password: "fixture" })).error).toBeNull();
      expect((await client.from("protected_rows").select("visible_to")).data).toEqual([{ visible_to: identity }]);
      expect(requests.at(-1)?.authorization).toBe(`Bearer ${token}`);
      expect(cookieWrites.some(cookie => cookie.name.startsWith("sb-project-auth-token"))).toBe(true);
      expect(client.storage.from("avatars").getPublicUrl("a.png").data.publicUrl).toBe(`${canonical}/storage/v1/object/public/avatars/a.png`);
      const single = await client.storage.from("avatars").createSignedUrl("a.png", 60);
      expect(single.error).toBeNull();
      expect(single.data?.signedUrl).toBe(`${canonical}/storage/v1/object/sign/avatars/a.png?token=fixture-${identity}`);
      expect(requests.at(-1)?.authorization).toBe(`Bearer ${token}`);
      const batch = await client.storage.from("avatars").createSignedUrls(["a.png", "b.png"], 60);
      expect(batch.error).toBeNull();
      expect(batch.data?.map(item => item.signedUrl)).toEqual(["a.png", "b.png"].map(path => `${canonical}/storage/v1/object/sign/avatars/${path}?token=fixture-${identity}`));
      expect(requests.at(-1)?.authorization).toBe(`Bearer ${token}`);
    }
    expect(requests.every(request => request.url.startsWith(gateway))).toBe(true);
  });
});
