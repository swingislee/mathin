import { describe, expect, it } from "vitest";
import {
  hasStaffHomeManagementScope,
  resolveStaffHomeView,
  staffHomeHref,
} from "@/features/school/home/staff-home-contract";

describe("staff home view contract", () => {
  it("uses an explicit view before a remembered preference or role default", () => {
    expect(resolveStaffHomeView({
      requested: "work",
      remembered: "overview",
      hasManagementScope: true,
    })).toBe("work");
  });

  it("remembers a valid choice and falls back to role-aware defaults", () => {
    expect(resolveStaffHomeView({ remembered: "work", hasManagementScope: true })).toBe("work");
    expect(resolveStaffHomeView({ remembered: "invalid", hasManagementScope: true })).toBe("overview");
    expect(resolveStaffHomeView({ hasManagementScope: false })).toBe("work");
  });

  it("recognizes the management permissions used by the work homepage", () => {
    expect(hasStaffHomeManagementScope(new Set(["class.view.all"]))).toBe(true);
    expect(hasStaffHomeManagementScope(new Set(["attendance.mark"]))).toBe(false);
  });

  it("keeps the selected overview period in URL-driven navigation", () => {
    expect(staffHomeHref("work", "month")).toBe("/dashboard?view=work");
    expect(staffHomeHref("overview", "month")).toBe("/dashboard?view=overview&period=month");
  });
});
