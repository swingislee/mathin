import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountCenterSnapshot } from "@/features/account/account-security";
import { listStaffMembers, listStaffRoles } from "@/features/school/staff";

const client = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

beforeEach(() => vi.resetAllMocks());

describe("学服岗位读取", () => {
  it("员工列表统一旧岗位名并保留身份、岗位及权限事实", async () => {
    client.rpc.mockResolvedValue({ error: null, data: [{
      user_id: "staff", display_name: "示例员工", email: "staff@example.com", identity: "staff",
      role_ids: ["sales-id", "custom-id"], role_names: ["学辅", "课程顾问"],
      can_follow_up: true, is_active: true, password_change_required: false,
    }] });
    expect(await listStaffMembers()).toEqual([{
      userId: "staff", displayName: "示例员工", email: "staff@example.com", identity: "staff",
      roleIds: ["sales-id", "custom-id"], roleNames: ["学服", "课程顾问"],
      canFollowUp: true, isActive: true, passwordChangeRequired: false,
    }]);
  });

  it("岗位列表使用学服名称并保留原有 key、成员数和权限", async () => {
    const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), returns: vi.fn() };
    client.from.mockReturnValue(query);
    query.returns.mockResolvedValue({ error: null, data: [{
      id: "sales-id", key: "sales", name: "学辅", is_system: true,
      role_permissions: [{ perm_key: "student.view.assigned" }], staff_role_members: [{ user_id: "staff" }],
    }] });
    expect(await listStaffRoles()).toEqual([{
      id: "sales-id", key: "sales", name: "学服", isSystem: true,
      permKeys: ["student.view.assigned"], memberCount: 1,
    }]);
  });

  it("账号中心兼容对象及数组形式的岗位关系", async () => {
    client.rpc.mockResolvedValue({ error: null, data: {
      accountStatus: "active", hasCurrentRequiredConsents: true, policies: [], requests: [], exports: [],
    } });
    client.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      returns: async () => ({ error: null, data: table === "staff_role_members" ? [
        { staff_roles: { key: "sales", name: "学辅" } },
        { staff_roles: [{ key: "custom", name: "课程顾问" }] },
        { staff_roles: null },
      ] : [] }),
    }));
    const snapshot = await getAccountCenterSnapshot({
      id: "staff", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-09-07T00:00:00Z",
    }, {
      id: "staff", role: "staff", displayName: "示例员工", avatarUrl: null,
      preferredLocale: "zh", lastActiveEnvironment: "staff", passwordChangeRequired: false,
    });
    expect(snapshot.profile.staffRoles).toEqual([
      { key: "sales", name: "学服" }, { key: "custom", name: "课程顾问" },
    ]);
  });
});
