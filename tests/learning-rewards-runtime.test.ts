import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/features/parent-portal/server", () => ({ requireResult: (r: { data: unknown; error?: unknown }) => { if (r.error) throw r.error; return r.data; } }));
vi.mock("@/features/participant-portal/runtime/sources", () => ({ item: (value: unknown) => value, dateTimeLabel: (value: string) => value }));
import { addRewardScreens } from "../src/features/participant-portal/rewards/screens";
import { pointsDisplay, pointsSource } from "../src/features/participant-portal/rewards/points";
import { runtimeSpecSchema } from "../src/features/participant-portal/runtime/spec";
import { runtimeCompatibleBlocks, type RuntimeSpec } from "../contracts/participant-api/runtime";
import type { SourceInput } from "../src/features/participant-portal/runtime/sources";

describe("points in the existing runtime", () => {
  it("adds editable pages without replacing published content or duplicating the account entry", () => {
    const spec: RuntimeSpec = { version: 1, tabs: [{ slot: 1, screen: "home", label: { zh: "首页", en: "Home" }, icon: "discover" },
      { slot: 3, screen: "me", label: { zh: "我的", en: "Account" }, icon: "account" }], screens: [
      { id: "home", title: { zh: "首页", en: "Home" }, navigation: "title", blocks: [] },
      { id: "me", title: { zh: "我的", en: "Account" }, navigation: "title", blocks: [{ id: "account", type: "account" }] },
    ] };
    const added = addRewardScreens(spec);
    expect(runtimeSpecSchema.safeParse(added).success).toBe(true);
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
});
