// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FollowupQueryMemory } from "@/features/school/FollowupQueryMemory";

const state = vi.hoisted(() => ({ saved: {} as Record<string, string>, replace: vi.fn(), save: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/dashboard/followups/communication", useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/features/school/dashboard-page/DashboardPreferenceScope", () => ({
  useDashboardPreference: (key: string) => ({ ready: true, raw: state.saved[key] ?? null, save: state.save }),
}));
let root: Root, container: HTMLDivElement;
describe("follow-up query memory", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    state.saved = {}; vi.clearAllMocks();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("starts the new contact workflow without restoring old daily filters or an implicit owner scope", async () => {
    state.saved["query:/dashboard/followups/communication"] = JSON.stringify("scope=mine&fields=old-date-filter");
    await act(async () => root.render(createElement(FollowupQueryMemory, { preferenceKey: "communication-entry-v2", keys: ["scope", "pageSize"] })));
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.save).toHaveBeenCalledWith("");
  });
  it("restores the current workflow's chosen owner and page size without restoring a date or column restriction", async () => {
    state.saved["query:communication-entry-v2"] = JSON.stringify("scope=mine&pageSize=100&date=2026-09-01&fields=old-date-filter");
    await act(async () => root.render(createElement(FollowupQueryMemory, { preferenceKey: "communication-entry-v2", keys: ["scope", "pageSize"] })));
    expect(state.replace).toHaveBeenCalledWith("/dashboard/followups/communication?scope=mine&pageSize=100");
  });
  it("retains the existing preference key and filter behavior for callers that use defaults", async () => {
    state.saved["query:/dashboard/followups/communication"] = JSON.stringify("scope=mine&fields=column-filter");
    await act(async () => root.render(createElement(FollowupQueryMemory)));
    expect(state.replace).toHaveBeenCalledWith("/dashboard/followups/communication?scope=mine&fields=column-filter");
  });
});
