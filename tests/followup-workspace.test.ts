import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DASHBOARD_ROUTES, resolveDashboardShellMode } from "../src/features/school/dashboard-routes";
import { filterSchoolNav, resolveActiveNavHref } from "../src/features/school/nav";
import type { PermissionKey } from "../src/features/school/permissions";

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("follow-up workspace navigation", () => {
  it("keeps all five stages under one sidebar entry and preserves their permissions", () => {
    const routes = [DASHBOARD_ROUTES.leads, DASHBOARD_ROUTES.invitations, DASHBOARD_ROUTES.assessments, DASHBOARD_ROUTES.enrollments, DASHBOARD_ROUTES.renewals];
    expect(routes.map((route) => route.href)).toEqual(["leads", "communication", "assessments", "enrollments", "renewals"].map((stage) => `/dashboard/followups/${stage}`));
    expect(routes.every((route) => route.parent === "followups")).toBe(true);
    for (const permission of ["followup.view", "review.write", "enrollment.manage"] satisfies PermissionKey[]) {
      const nav = filterSchoolNav(new Set([permission]));
      expect(nav.filter((item) => item.href.startsWith("/dashboard/followups"))).toHaveLength(1);
      expect(resolveActiveNavHref("/dashboard/followups/assessments/record", nav)).toBe("/dashboard/followups");
    }
    expect(filterSchoolNav(new Set()).some((item) => item.href === "/dashboard/followups")).toBe(false);
    expect(resolveDashboardShellMode("/dashboard/followups/assessments/record")).toBe("panel");
  });

  it("retains old bookmarks as redirects and removes the previous follow-up board", () => {
    for (const old of ["leads", "invitations", "assessments", "enrollments", "renewals"]) {
      const page = source(`src/app/[locale]/dashboard/${old}/page.tsx`);
      expect(page).toContain("redirect({ locale: values.locale");
      expect(page).toContain("new URLSearchParams");
      expect(page).not.toContain("<DashboardPage");
    }
    expect(source("src/app/[locale]/dashboard/followups/page.tsx")).not.toContain("FollowUpBoardList");
  });

  it("preserves GET search fields when the search editor lives in a portal", () => {
    const search = source("src/features/school/DashboardSearch.tsx");
    expect(search).toContain('type="hidden" name={name} value={current}');
    expect(search).toContain("hidden.current?.form?.requestSubmit()");
    expect(search).toContain("PopoverTrigger asChild");
    expect(search).toContain("aria-label={label}");
  });
});
