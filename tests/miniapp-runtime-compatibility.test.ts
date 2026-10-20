import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  runtimeCompatibleAction, runtimeCompatibleBlocks, runtimeCompatibleEffects, runtimeParams,
  type RuntimeAction, type RuntimeBlockView, type RuntimeEffect,
} from "../contracts/participant-api/runtime";
import { runtimeActionSchema, runtimeParamsSchema } from "../src/features/participant-portal/runtime/spec";

const guard = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/features/parent-portal/server", () => ({
  authorize: async () => ({ user: { id: "10000000-0000-4000-8000-000000000001" } }),
  PortalError: class extends Error { constructor(public code: string) { super(code); } },
  readJson: (request: Request) => request.json(), requireResult: (result: { data: unknown }) => result.data,
  response: (value: unknown) => Response.json(value), readBytes: vi.fn(),
}));
vi.mock("../src/features/participant-portal/runtime/server", () => ({
  readForm: vi.fn(),
  loadIdentity: async () => ({ db: { from: guard.from, rpc: guard.rpc }, participants: [{ id: "10000000-0000-4000-8000-000000000002" }],
    participant: "10000000-0000-4000-8000-000000000002" }),
}));
vi.mock("../src/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("../src/features/wechat/miniapp-config", () => ({ getMiniappWechatConfig: vi.fn() }));
vi.mock("../src/features/wechat/miniapp-provider", () => ({ exchangeMiniappWechatCode: vi.fn() }));
vi.mock("../src/features/wechat/store", () => ({ findWechatUser: vi.fn(), issueTicket: vi.fn() }));
vi.mock("../src/features/participant-portal/experience-requests-server", () => ({ experienceAnswersSchema: z.unknown() }));

describe("old runtime capability boundary", () => {
  it("keeps ordinary legacy actions but explains parameterized screens to version 1", () => {
    const action: RuntimeAction = { type: "screen", screen: "detail", params: { id: "a" }, sheet: true };
    expect(runtimeCompatibleAction(action, 1).type).toBe("toast");
    expect(runtimeCompatibleAction(action, 2)).toEqual(action);
    expect(runtimeCompatibleAction({ type: "screen", screen: "detail" }, 1).type).toBe("screen");
    expect(runtimeActionSchema.parse(action)).toEqual(action);
  });
  it("turns unknown actions and effects into a visible fallback, including inherited property names", () => {
    for (const type of ["future", "constructor"]) {
      expect(runtimeCompatibleAction({ type } as RuntimeAction, 2).type).toBe("toast");
      expect(runtimeCompatibleEffects([{ type } as RuntimeEffect], 2, "en")).toEqual([{ type: "toast", text: "Update the Mini Program to view this content" }]);
    }
    expect(runtimeCompatibleEffects([{ type: "action", action: { type: "screen", screen: "detail", params: { id: "a" } } }], 1, "zh")[0])
      .toMatchObject({ type: "action", action: { type: "toast" } });
  });
  it("checks nested navigation and the whole form before exposing unsupported fields", () => {
    const blocks = [{
      id: "section", type: "section", title: "", style: "plain", more: null, blocks: [
        { id: "button", type: "button", label: "Open", appearance: "primary", action: { type: "screen", screen: "detail", params: { id: "a" } } },
        { id: "form", type: "form", groups: [{ fields: [{ kind: "future" }] }] },
      ],
    }] as unknown as RuntimeBlockView[];
    const result = runtimeCompatibleBlocks(blocks, 1, "zh");
    expect(result[0]).toMatchObject({ blocks: [{ action: { type: "toast" } }, { id: "form", type: "unsupported" }] });
  });
  it("bounds object context and rejects reserved parameter names", () => {
    const params = { id: "object", note: "中文 & 100%" };
    expect(runtimeParamsSchema.parse(params)).toEqual(params);
    expect(runtimeParams(params)).toEqual(params);
    expect(runtimeParamsSchema.safeParse({ constructor: "bad" }).success).toBe(false);
    expect(runtimeParams({ constructor: "bad", id: "object" })).toEqual({ id: "object" });
    expect(runtimeParamsSchema.safeParse({ note: "x".repeat(201) }).success).toBe(false);
  });
});

describe("child authority at runtime data and command boundaries", () => {
  it("rejects an explicitly unlinked child before a command can write for the default child", async () => {
    const { runtimeCommandPost } = await import("../src/features/participant-portal/runtime/commands");
    const request = new Request("http://fixture.invalid/command", { method: "POST", body: JSON.stringify({
      id: "10000000-0000-4000-8000-000000000004", command: "checkin", participant: "10000000-0000-4000-8000-000000000003",
    }) });
    await expect(runtimeCommandPost(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(guard.from).not.toHaveBeenCalled(); expect(guard.rpc).not.toHaveBeenCalled();
  });
  it("never substitutes another child's summary when the chosen child's record is absent", async () => {
    const { readDisplay } = await import("../src/features/participant-portal/runtime/display");
    const { defaultMiniappSettings } = await import("../contracts/participant-api/miniapp-settings");
    const db = { rpc: async () => ({ data: [{ student_id: "child-a", star_total: 999 }] }) };
    const result = await readDisplay("account.summary", {
      identity: { db, participant: "child-b", signedIn: true, participants: [], name: "", stage: null },
      locale: "zh", settings: defaultMiniappSettings(), filters: {}, now: 0,
    } as unknown as Parameters<typeof readDisplay>[1]);
    expect(result?.metrics?.[0].value).toBe("0");
  });
});
