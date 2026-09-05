import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCHOOL_NAV_ITEMS } from "../src/features/school/nav";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("dashboard functional information architecture", () => {
  it("groups the staff sidebar by job function and keeps overview as the only top-level item", () => {
    expect(SCHOOL_NAV_ITEMS.map(({ labelKey, group }) => [labelKey, group ?? null])).toEqual([
      ["home", null],
      ["followups", "subjectOperations"],
      ["students", "subjectOperations"],
      ["activities", "subjectOperations"],
      ["coordination", "subjectOperations"],
      ["finance", "subjectOperations"],
      ["managementAnalytics", "subjectOperations"],
      ["classes", "teaching"],
      ["academicYears", "teaching"],
      ["schedule", "teaching"],
      ["courses", "research"],
      ["workbench", "research"],
      ["coursewareReview", "research"],
      ["sharedAssets", "research"],
      ["organizationProfile", "organization"],
      ["campuses", "organization"],
      ["staff", "organization"],
      ["roles", "organization"],
      ["registrationInvites", "system"],
      ["accountSupport", "system"],
      ["operations", "system"],
      ["testdata", "system"],
      ["accountSecurity", "system"],
    ]);
  });

  it("uses one canonical academic-year route and retires the legacy settings URLs", () => {
    const routes = read("src/features/school/dashboard-routes.ts");
    const academicYearsPage = read("src/app/[locale]/dashboard/academic-years/page.tsx");

    expect(routes).toContain('href: "/dashboard/academic-years"');
    expect(routes).not.toContain('href: "/dashboard/schedule/calendar"');
    expect(routes).not.toContain('href: "/dashboard/schedule/defaults"');
    expect(routes).not.toContain('href: "/dashboard/organization-settings"');
    expect(fs.existsSync(path.join(root, "src/app/[locale]/dashboard/schedule/calendar/page.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src/app/[locale]/dashboard/schedule/defaults/page.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src/app/[locale]/dashboard/organization-settings/page.tsx"))).toBe(false);
    expect(academicYearsPage).toContain("<ScheduleDefaultsForm defaults={defaults} />");
  });

  it("assigns a distinct icon to every staff navigation entry", () => {
    const shell = read("src/features/school/DashboardShell.tsx");
    const iconNames = SCHOOL_NAV_ITEMS.map(({ labelKey }) => {
      const match = shell.match(new RegExp(`\\n  ${labelKey}: (\\w+),`));
      expect(match, `missing icon for ${labelKey}`).not.toBeNull();
      return match![1];
    });
    expect(new Set(iconNames).size).toBe(iconNames.length);
  });

  it("uses linear setting sections and a campus table instead of card grids", () => {
    const profile = read("src/features/school/OrganizationProfileForm.tsx");
    const defaults = read("src/features/school/ScheduleDefaultsForm.tsx");
    const calendar = read("src/features/school/TeachingCalendarManager.tsx");
    const campuses = read("src/features/school/CampusList.tsx");

    expect(profile).toContain('className="max-w-5xl"');
    expect(profile).not.toContain('className="max-w-5xl border-y border-line"');
    expect(defaults).toContain('id="schedule-defaults"');
    expect(calendar).toContain('className="border-t border-line/60 pt-6"');
    expect(campuses).toContain("<Table");
    expect(campuses).not.toContain("md:grid-cols-2");
  });

  it("keeps the new navigation labels synchronized in Chinese and English", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    expect(zh.school.nav).toMatchObject({
      group_subjectOperations: "学科运营",
      group_teaching: "教学",
      group_research: "教研",
      group_organization: "组织管理",
      group_system: "系统管理",
      academicYears: "学年",
    });
    expect(en.school.nav).toMatchObject({
      group_subjectOperations: "Subject operations",
      group_teaching: "Teaching",
      group_research: "Teaching research",
      group_organization: "Organization management",
      group_system: "System management",
      academicYears: "Academic years",
    });
  });
});
