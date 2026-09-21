// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DashboardIntentLink } from "@/features/school/dashboard-page/DashboardIntentLink";

vi.mock("@/i18n/navigation", () => ({ Link: ({ prefetch, ...props }: ComponentProps<"a"> & { prefetch: boolean | null }) =>
  createElement("a", { ...props, "data-prefetch": prefetch === false ? "off" : "auto" }) }));

it("prefetches only the intended destination and preserves navigation handlers", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), click = vi.fn(event => event.preventDefault()), focus = vi.fn();
  try {
    await act(async () => root.render(createElement("nav", null,
      createElement(DashboardIntentLink, { href: "/dashboard/students", onClick: click }, "Students"),
      createElement(DashboardIntentLink, { href: "/dashboard/assessments", onFocus: focus }, "Assessments"))));
    const [students, assessments] = [...container.querySelectorAll("a")];
    expect([students.dataset.prefetch, assessments.dataset.prefetch]).toEqual(["off", "off"]);
    await act(async () => students.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect([students.dataset.prefetch, assessments.dataset.prefetch]).toEqual(["auto", "off"]);
    await act(async () => assessments.focus());
    expect(assessments.dataset.prefetch).toBe("auto"); expect(focus).toHaveBeenCalledTimes(1);
    await act(async () => students.click());
    expect(click).toHaveBeenCalledTimes(1); expect(students.getAttribute("href")).toBe("/dashboard/students");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
