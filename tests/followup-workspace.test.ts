import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DASHBOARD_ROUTES, resolveDashboardShellMode } from "../src/features/school/dashboard-routes";
import { filterSchoolNav, resolveActiveNavHref } from "../src/features/school/nav";
import type { PermissionKey } from "../src/features/school/permissions";

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("follow-up workspace navigation", () => {
  it("exposes each work entry with its existing permissions", () => {
    expect([DASHBOARD_ROUTES.leads, DASHBOARD_ROUTES.invitations, DASHBOARD_ROUTES.assessments, DASHBOARD_ROUTES.classes, DASHBOARD_ROUTES.renewals].map(route => route.href))
      .toEqual(["leads", "communication", "assessments", "classes", "renewals"].map(route => `/dashboard/${route}`));
    const nav = filterSchoolNav(new Set<PermissionKey>(["followup.view"]));
    expect(nav.filter(item => ["leads", "communication", "assessments", "renewals"].some(key => item.href === `/dashboard/${key}`))).toHaveLength(4);
    expect(resolveActiveNavHref("/dashboard/assessments/record", nav)).toBe("/dashboard/assessments");
    expect(filterSchoolNav(new Set<PermissionKey>(["review.write"])).some(item => item.href === "/dashboard/leads")).toBe(false);
    expect(filterSchoolNav(new Set<PermissionKey>(["enrollment.manage"])).some(item => item.href === "/dashboard/classes")).toBe(true);
    expect(resolveDashboardShellMode("/dashboard/assessments/record")).toBe("panel");
  });

  it("uses real top-level pages and retires old workbench URLs without redirects", () => {
    for (const entry of ["leads", "communication", "assessments", "classes", "renewals"]) {
      expect(source(`src/app/[locale]/dashboard/${entry}/page.tsx`)).not.toContain("LegacyFollowupRoute");
    }
    for (const old of ["followups", "followups/leads", "followups/enrollments", "teaching", "enrollments"]) {
      expect(existsSync(new URL(`../src/app/[locale]/dashboard/${old}/page.tsx`, import.meta.url))).toBe(false);
    }
    for (const retired of ["coordination", "management-analytics"]) {
      expect(source(`src/app/[locale]/dashboard/${retired}/page.tsx`)).toContain("notFound()");
    }
  });

  it("preserves GET search fields when the search editor lives in a portal", () => {
    const search = source("src/features/school/DashboardSearch.tsx");
    expect(search).toContain('type="hidden" name={name} value={current}');
    expect(search).toContain("hidden.current?.form?.requestSubmit()");
    expect(search).toContain("PopoverTrigger asChild");
    expect(search).toContain("aria-label={label}");
  });
});
