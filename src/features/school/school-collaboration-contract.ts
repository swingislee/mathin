import { z } from "zod";
import type { DashboardFieldQuery } from "./dashboard-page/dashboard-table-field-contract";

export const SCHOOL_BUSINESS_ROLES = ["school_support", "assessment_teacher", "teacher"] as const;
export type SchoolBusinessRole = typeof SCHOOL_BUSINESS_ROLES[number];
export const SCHOOL_STAFF_RESERVE_REASONS = ["test", "assessment", "placeholder", "other"] as const;
export type SchoolStaffReserveReason = typeof SCHOOL_STAFF_RESERVE_REASONS[number];
export const SCHOOL_ORGANIZATION_KINDS = ["org", "campus", "dept", "group"] as const;
export type SchoolOrganizationKind = typeof SCHOOL_ORGANIZATION_KINDS[number];
export const schoolCollaborationSchema = z.object({
  canManage: z.boolean(),
  groups: z.array(z.object({
    id: z.string().uuid(), name: z.string(), memberIds: z.array(z.string().uuid()),
    parentId: z.string().uuid().nullable().default(null), kind: z.enum(SCHOOL_ORGANIZATION_KINDS).default("group"),
    sortOrder: z.number().int().default(0), leadIds: z.array(z.string().uuid()).default([]), studentCount: z.number().int().default(0),
  })),
  staff: z.array(z.object({
    id: z.string().uuid(), name: z.string(), role: z.enum(SCHOOL_BUSINESS_ROLES).nullable(),
    roles: z.array(z.enum(SCHOOL_BUSINESS_ROLES)).default([]), jobs: z.array(z.string()).default([]),
    canFollowUp: z.boolean().default(false), canReview: z.boolean().default(false),
    studentCount: z.number().int().default(0), classCount: z.number().int().default(0), upcomingAssessmentCount: z.number().int().default(0),
    reserve: z.enum(SCHOOL_STAFF_RESERVE_REASONS).nullable().default(null), fixedTest: z.boolean().default(false),
  })),
  rules: z.array(z.object({ id: z.string().uuid(), kind: z.string(), label: z.string(), groupIds: z.array(z.string().uuid()) })).default([]),
});
export type SchoolCollaborationSettings = z.infer<typeof schoolCollaborationSchema>;
export const schoolParticipantSchema = z.object({ userId: z.string().uuid(), name: z.string(), role: z.enum([...SCHOOL_BUSINESS_ROLES, "participant"]) });
export const schoolGroupSchema = z.object({ id: z.string().uuid(), name: z.string() });

export function schoolSupportGroupFilter(query: DashboardFieldQuery, groupId: string): DashboardFieldQuery {
  const filters = { ...query.filters };
  delete filters.group;
  if (groupId !== "all") filters.group = { kind: "enum", values: [groupId] };
  return { ...query, filters };
}

export function schoolSupportGroups(ownerId: string | null, groups: SchoolCollaborationSettings["groups"]) {
  return groups.filter(group => ownerId && group.memberIds.includes(ownerId)).map(({ id, name }) => ({ id, name }));
}

export function schoolCollaborationMessages(locale: string) {
  const en = locale.startsWith("en");
  return {
    title: en ? "Staff groups & responsibilities" : "员工分组与分工", groupsTitle: en ? "Staff groups" : "员工分组",
    supportOwner: en ? "Learning support owner" : "学服负责人", noRole: en ? "Not set" : "未设置",
    supportHint: en ? "Learning support staff appear in owner assignments; class and assessment teachers appear in assessment schedules. Existing assignments remain recorded."
      : "学服进入负责人名单，授课和诊断老师进入诊断排班；已有负责人关系继续保留。",
    needsFollowup: en ? "Follow-up permission is required for learning support assignments." : "担任学服负责人需具备跟进登记权限。",
    needsReview: en ? "Assessment permission is required to receive new bookings." : "接收新诊断预约还需具备测评登记权限。",
    assessmentSettings: en ? "Assessment booking settings" : "诊断预约设置",
    supportGroup: en ? "Support group" : "学服分组", allSupportGroups: en ? "All support groups" : "全部学服组",
    description: en ? "Maintain responsibilities and group memberships in the same staff table. Job roles continue to control operation permissions." : "在同一张员工表中维护业务分工与组别，操作权限仍由岗位维护。",
    sourceHint: en ? "Source groups remain on student records." : "原表组别继续保留在学生记录中。",
    name: en ? "Group name" : "组名", add: en ? "Create group" : "新建组", rename: en ? "Rename" : "改名",
    save: en ? "Save" : "保存", saving: en ? "Saving…" : "正在保存…", cancel: en ? "Cancel" : "取消",
    staff: en ? "Staff" : "员工", role: en ? "Business responsibility" : "业务分工", choose: en ? "Choose" : "请选择",
    roles: { school_support: en ? "Learning support" : "学服", assessment_teacher: en ? "Assessment teacher" : "诊断／测评老师", teacher: en ? "Class teacher" : "授课老师", participant: en ? "Participant" : "参与人" },
    members: en ? "Members" : "成员", memberHint: en ? "Groups control shared assessment rules and access to group student records. Removing membership revokes group access." : "分组用于统一诊断规则和组内学生资料查看；取消勾选后撤回该组查看权限。",
    error: en ? "Could not save. Refresh and check your access." : "保存未完成，请刷新后核对权限。", saved: en ? "Saved" : "已保存",
    mine: en ? "I participated" : "我参与的", group: en ? "My groups" : "本组", all: en ? "All accessible" : "全部可见", scope: en ? "View scope" : "查看范围",
    collaborate: en ? "Collaborators / group" : "参与人／组别", collaborator: en ? "Add participant" : "添加参与人",
    collaborateHint: en ? "Add staff with an actual role in this student's work. Existing participation remains recorded." : "按实际分工添加参与人；原有参与经历继续保留。",
    empty: en ? "No group membership yet." : "尚未加入业务组。", back: en ? "Staff" : "返回员工",
  };
}
