import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (...segments: string[]) => fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
const migration = read("supabase", "migrations", "20260829000200_admin_self_staff_roles.sql");
const panel = read("src", "features", "school", "StaffMembersPanel.tsx");

describe("administrator self staff-role hotfix", () => {
  it("allows only a top-level admin through the RPC self-target guard", () => {
    expect(migration.match(/if target = uid and not public\.is_admin\(uid\) then/g)).toHaveLength(2);
    expect(migration).toContain("raise exception 'CANNOT_GRANT_SELF'");
    expect(migration).toContain("raise exception 'CANNOT_REVOKE_SELF'");
    expect(migration).toContain("not public.has_perm(uid, 'staff.manage')");
  });

  it("shows self role management to an admin without exposing self-deactivation", () => {
    expect(panel).toContain("member.userId !== selfId || isAdmin");
    expect(panel).toContain("canManageRoles(member)");
    expect(panel).toContain("member.userId !== selfId && member.isActive");
    expect(panel).toContain("foundMember && canManageRoles(foundMember)");
  });
});
