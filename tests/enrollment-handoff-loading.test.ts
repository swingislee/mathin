// @vitest-environment jsdom
import { act, createElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PostActivityHandoff } from "@/features/school/EnrollmentHandoffButton";
import { FollowupInlineDetails } from "@/features/school/dashboard-page/FollowupInlineDetails";

const chunk = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release };
});

// Next 的 App Router 使用这个实现；保留真实的懒加载与 Suspense 行为。
vi.mock("next/dynamic", async () => {
  const { default: dynamic } = await import("next/dist/shared/lib/app-dynamic");
  return { default: dynamic };
});
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/features/school/PostActivityHandoff", async () => {
  await chunk.ready;
  return { PostActivityHandoff: () => createElement("button", null, "Enroll") };
});

describe("enrollment handoff cold loading", () => {
  it("keeps the table and assessment fields visible while the enrollment chunk loads", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const pageFallback = vi.fn(() => createElement("div", { "data-page-skeleton": true }, "Page loading"));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (open: boolean) => act(async () => {
      root.render(createElement(Suspense, { fallback: createElement(pageFallback) },
        createElement("main", null,
          createElement("h1", null, "Assessments"),
          createElement("table", null, createElement("tbody", null,
            createElement("tr", { "data-summary": true }, createElement("td", null, "Student")),
            createElement(FollowupInlineDetails, { open, keepMounted: open, onOpenChange: () => {}, title: "Assessment", colSpan: 1 },
              createElement("textarea", { "aria-label": "Parent response", defaultValue: "Saved response" }),
              createElement(PostActivityHandoff, { source: { registrationId: "assessment-record", invitationId: null }, enrollmentOnly: true }),
            ),
            createElement("tr", { "data-next-summary": true }, createElement("td", null, "Next student")),
          )),
        ),
      ));
    });
    try {
      await render(false);
      const summary = container.querySelector("[data-summary]");
      const nextSummary = container.querySelector("[data-next-summary]");
      await render(true);
      expect(pageFallback).not.toHaveBeenCalled();
      expect(container.querySelector("[data-page-skeleton]")).toBeNull();
      expect(container.querySelector("main")?.style.display).not.toBe("none");
      expect(container.querySelector("[data-summary]")).toBe(summary);
      expect(container.querySelector("[data-next-summary]")).toBe(nextSummary);
      expect(container.querySelector('[role="status"]')?.textContent).toContain("loading");
      const response = container.querySelector("textarea")!;
      response.value = "Unsaved response during loading";
      await act(async () => { chunk.release(); await chunk.ready; });
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(container.textContent).toContain("Enroll");
      expect(container.querySelector("textarea")).toBe(response);
      expect(response.value).toBe("Unsaved response during loading");
      expect(pageFallback).not.toHaveBeenCalled();
    } finally {
      await act(async () => { chunk.release(); root.unmount(); });
      container.remove();
    }
  });
});
