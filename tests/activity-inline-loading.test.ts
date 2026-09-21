// @vitest-environment jsdom
import { act, createElement as h, Suspense, type ComponentProps, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import { ActivitiesManager } from "@/features/school/ActivitiesManager";
import type { ActivityRow } from "@/features/school/activities";
import type { PublicClassRegistrationData } from "@/features/school/public-class-registration-contract";

const deps = vi.hoisted(() => ({ chunk: Promise.withResolvers<void>(), read: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/school/activity-actions", () => ({ createActivityAction: vi.fn(), deleteActivityAction: vi.fn(), updateActivityAction: vi.fn(), setActivityTargetGradesAction: vi.fn() }));
vi.mock("@/features/school/public-class-actions", () => ({ savePublicClassSegmentAction: vi.fn() }));
vi.mock("@/features/school/public-class-registration-actions", () => ({ getPublicClassRegistrationAction: deps.read, savePublicClassRegistrationBundleAction: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => h("a", props, children),
  useRouter: () => ({ refresh: deps.refresh }), usePathname: () => "/dashboard/activities" }));
vi.mock("next/dynamic", async () => {
  const dynamic = (await import("next/dist/shared/lib/app-dynamic")).default;
  return { default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => dynamic(async () => { await deps.chunk.promise; return loader(); }) };
});

it("keeps an activity table mounted through its first inline module and registration read", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const activity: ActivityRow = { id: "activity", kind: "public_class", title: "Sample activity", scheduledAt: "2026-09-21T02:00:00Z", recordState: "current",
    durationMin: 60, location: "", capacity: null, remark: "", registrations: [] };
  const data: PublicClassRegistrationData = { activity: { ...activity, printBackgroundPath: "" }, segments: [], participants: [], roomOptions: [], staffOptions: [], canRecord: true, canManage: false, canFollowUp: false };
  const result = Promise.withResolvers<{ ok: true; data: PublicClassRegistrationData }>(); deps.read.mockReturnValue(result.promise);
  try {
    await act(async () => root.render(h(NextIntlClientProvider, { locale: "zh", messages: zh, timeZone: "Asia/Shanghai",
      children: h(Suspense, { fallback: h("p", { "data-page-loading": true }, "Loading table") },
        h(ActivitiesManager, { title: "Activities", activities: [activity], canManage: false, teachingActivityIds: [] })) })));
    const table = container.querySelector("table"), summary = container.querySelector<HTMLElement>("[data-activity-row]")!;
    await act(async () => summary.click());
    expect(container.querySelector("[data-page-loading]")).toBeNull();
    expect(summary.nextElementSibling?.querySelector('[role="status"]')?.textContent).toBe("正在读取…");
    expect(deps.read).not.toHaveBeenCalled();
    await act(async () => deps.chunk.resolve());
    await vi.waitFor(() => expect(deps.read).toHaveBeenCalledWith("activity"));
    expect(container.querySelector("[data-page-loading]")).toBeNull();
    expect(container.querySelector("table")).toBe(table);
    await act(async () => result.resolve({ ok: true, data }));
    expect(summary.nextElementSibling?.querySelector('[role="tablist"]')).not.toBeNull();
    const panel = summary.nextElementSibling!.querySelector<HTMLElement>("[data-dashboard-inline-entry]")!;
    await act(async () => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("table")).toBe(table);
    expect(deps.refresh).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
