import { beforeEach, describe, expect, it, vi } from "vitest";
import { logout } from "../src/app/[locale]/(auth)/actions";

const mock = vi.hoisted(() => ({ client: {} as Record<string, unknown>, calls: [] as string[], failure: "" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { mock.calls.push(url); throw new Error("REDIRECT"); } }));

beforeEach(() => {
  mock.calls = [];
  mock.failure = "";
  mock.client = {
    rpc(this: unknown, name: string) {
      expect(this).toBe(mock.client);
      mock.calls.push(name);
      if (mock.failure === "sync") throw new Error("RPC unavailable");
      // Supabase RPC returns a thenable, not a native Promise with .catch().
      return { then(resolve: (value: unknown) => void, reject: (error: Error) => void) {
        if (mock.failure === "async") reject(new Error("RPC unavailable"));
        else resolve({ error: null });
      } };
    },
    auth: { signOut: async () => { mock.calls.push("signOut"); return { error: null }; } },
  };
});

describe("Web Push revocation during logout", () => {
  it.each(["", "sync", "async"])("continues logout with RPC failure mode %s", async (failure) => {
    mock.failure = failure;
    const form = new FormData();
    form.set("locale", "zh");
    await expect(logout(form)).rejects.toThrow("REDIRECT");
    expect(mock.calls).toEqual(["revoke_all_my_web_push_subscriptions", "signOut", "/zh"]);
  });
});
