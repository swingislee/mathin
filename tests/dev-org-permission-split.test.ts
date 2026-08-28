import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const permissions = fs.readFileSync(path.join(process.cwd(), "src/features/school/permissions.ts"), "utf8");
const roles = fs.readFileSync(path.join(process.cwd(), "src/features/school/RolesMatrixPanel.tsx"), "utf8");
const zh = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages/zh.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"));

describe("DEV-ORG-1 split settings permissions", () => {
  it("keeps the legacy key for rollback but removes it from role configuration", () => {
    expect(permissions).toContain('"organization.settings.manage"');
    expect(permissions).toContain('key !== "organization.settings.manage"');
    expect(roles).toContain("ROLE_CONFIGURABLE_PERMISSION_KEYS");
    expect(roles).not.toContain("for (const key of PERMISSION_KEYS)");
  });

  it.each([zh, en])("labels every newly configurable permission", (messages) => {
    const labels = messages.school.roles;
    for (const key of [
      "organization_profile_manage",
      "location_manage",
      "system_operations_manage",
      "courseware_microcourse_author",
      "work_item_manage",
      "approval_manage",
    ]) expect(labels[`perm_${key}`]).toBeTruthy();
  });
});
