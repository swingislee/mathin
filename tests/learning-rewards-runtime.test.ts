import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/features/parent-portal/server", () => ({ PortalError: class extends Error {}, requireResult: (r: { data: unknown; error?: unknown }) => { if (r.error) throw r.error; return r.data; } }));
vi.mock("@/features/participant-portal/runtime/sources", () => ({ item: (value: unknown) => value, dateTimeLabel: (value: string) => value }));
import { addRewardScreens } from "../src/features/participant-portal/rewards/screens";
import { pointsDisplay, pointsSource } from "../src/features/participant-portal/rewards/points";
import { commerceSource, redeemCommand } from "../src/features/participant-portal/rewards/commerce";
import { drawCommand, drawsSource } from "../src/features/participant-portal/rewards/draws";
import { runtimeSpecSchema } from "../src/features/participant-portal/runtime/spec";
import { runtimeCompatibleBlocks, type RuntimeSpec } from "../contracts/participant-api/runtime";
import type { SourceInput } from "../src/features/participant-portal/runtime/sources";

describe("points in the existing runtime", () => {
  it("shows every probability in full before a guaranteed draw and binds its retry to the viewed child state", async () => {
    const poolId = "10000000-0000-4000-8000-000000000003";
    const rpc = vi.fn().mockResolvedValue({ data: { items: [{ id: poolId, version: 4, title: { zh: "奖池", en: "Pool" }, description: { zh: "", en: "" }, points_cost: 10,
      daily_limit: 2, total_limit: 0, pity_after: 3, total_draws: 8, since_pity: 2, today_draws: 0, guaranteed: true, blocked: "",
      entries: [{ title: { zh: "普通", en: "Common" }, tier: { zh: "", en: "" }, weight: 99, is_pity: false }, { title: { zh: "稀有", en: "Rare" }, tier: { zh: "", en: "" }, weight: 1, is_pity: true }] }], next: null } });
    const input = { identity: { db: { rpc }, participant: "selected-child" }, locale: "zh", params: { poolId, participant: "another-child" } } as unknown as SourceInput;
    const page = await drawsSource("rewards.drawDetail", input);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_student: "selected-child", p_pool: poolId });
    expect(page.items[0].summary).toContain("普通: 基础 99.0000% · 本次 0.0000%");
    expect(page.items[0].summary).toContain("稀有（保底奖）: 基础 1.0000% · 本次 100.0000%");
    expect(page.items[0].action).toBeUndefined();
    const action = page.items[1].action;
    if (action?.type !== "command") throw new Error("Draw action missing");
    rpc.mockResolvedValue({ error: { message: "DRAW_LIMIT" } });
    const effects = await drawCommand({ participant: "selected-child", params: action.params!, locale: "zh" }, input.identity);
    expect(effects[0].type).toBe("toast");
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_student: "selected-child", p_version: 4, p_expected_total: 8, p_id: action.params!.intentId });
    await expect(drawCommand({ participant: "other-child", params: action.params!, locale: "zh" }, input.identity)).rejects.toThrow();
  });
  it("adds editable pages without replacing published content or duplicating the account entry", () => {
    const spec: RuntimeSpec = { version: 1, tabs: [{ slot: 1, screen: "home", label: { zh: "首页", en: "Home" }, icon: "discover" },
      { slot: 3, screen: "me", label: { zh: "我的", en: "Account" }, icon: "account" }], screens: [
      { id: "home", title: { zh: "首页", en: "Home" }, navigation: "title", blocks: [] },
      { id: "me", title: { zh: "我的", en: "Account" }, navigation: "title", blocks: [{ id: "account", type: "account" }] },
    ] };
    const added = addRewardScreens(spec);
    expect(runtimeSpecSchema.parse(added)).toEqual(added);
    expect(added.screens[0]).toEqual(spec.screens[0]);
    expect(addRewardScreens(added)).toEqual(added);
  });
  it("uses the validated selected child, never an object parameter, and does not skip short pages", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { balance: 5, available: 5, next: "row-29", entries: Array.from({ length: 30 }, (_, i) => ({ id: `row-${i}`, note: "Classroom star", amount: 1, balance_after: i, created_at: "2026-10-21" })) } });
    const input = { identity: { db: { rpc }, participant: "selected-child" }, locale: "zh", params: { participant: "another-child" }, limit: 5, cursor: "last-visible" } as unknown as SourceInput;
    const result = await pointsSource("rewards.ledger", input);
    expect(rpc).toHaveBeenCalledWith("read_learning_points", { p_student: "selected-child", p_before: "last-visible" });
    expect(result.items).toHaveLength(5);
    expect(result.next).toBe("row-4");
    await pointsSource("rewards.ledger", { ...input, identity: { ...input.identity, participant: null } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("shows debt separately and preserves a usable view for the existing client", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { balance: -4, available: 0 } });
    const data = await pointsDisplay({ identity: { db: { rpc }, participant: "child" }, locale: "zh" } as unknown as SourceInput);
    expect(data?.metrics?.[0]).toMatchObject({ value: "0", hint: expect.stringContaining("4") });
    expect(runtimeCompatibleBlocks([{ id: "points", type: "metrics", title: "积分", columns: 2, items: data!.metrics!, state: "ready", message: "" }], 2, "zh")[0].type).toBe("metrics");
  });
  it("keeps a server-issued redemption intent across transport retries and rejects a changed child", async () => {
    const prizeId = "10000000-0000-4000-8000-000000000001";
    const rpc = vi.fn().mockResolvedValueOnce({ data: { items: [{ id: prizeId, title: { zh: "奖品", en: "Prize" }, description: { zh: "", en: "" }, points_cost: 20, stock: 2, kind: "physical", offer_version: 3, image: "" }], next: null } });
    const input = { identity: { db: { rpc }, participant: "selected-child" }, locale: "zh" } as unknown as SourceInput;
    const page = await commerceSource("rewards.catalog", input);
    const action = page.items[0].action;
    if (action?.type !== "command") throw new Error("Redemption action missing");
    const response = { id: "order", status: "pending", pickup_code: "FIXTURE", snapshot: { title: { zh: "奖品", en: "Prize" }, kind: "physical", image: "", pickupInstructions: { zh: "领取说明", en: "Pickup" } } };
    rpc.mockResolvedValue({ data: response });
    const first = { participant: "selected-child", params: action.params!, locale: "zh" as const, id: "transport-one" };
    await redeemCommand(first, input.identity);
    const second = { ...first, id: "transport-two" };
    await redeemCommand(second, input.identity);
    expect(rpc.mock.calls[1][1]).toEqual(rpc.mock.calls[2][1]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_id: action.params!.intentId, p_prize: prizeId, p_student: "selected-child", p_offer_version: 3 });
    await expect(redeemCommand({ ...first, participant: "other-child" }, input.identity)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
