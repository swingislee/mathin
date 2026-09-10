import { z } from "zod";

export const SCHOOL_BUSINESS_ROLES = ["school_support", "assessment_teacher", "teacher"] as const;
export type SchoolBusinessRole = typeof SCHOOL_BUSINESS_ROLES[number];
export const schoolCollaborationSchema = z.object({
  canManage: z.boolean(),
  groups: z.array(z.object({ id: z.string().uuid(), name: z.string(), memberIds: z.array(z.string().uuid()) })),
  staff: z.array(z.object({ id: z.string().uuid(), name: z.string(), role: z.enum(SCHOOL_BUSINESS_ROLES).nullable() })),
});
export type SchoolCollaborationSettings = z.infer<typeof schoolCollaborationSchema>;
export const schoolParticipantSchema = z.object({ userId: z.string().uuid(), name: z.string(), role: z.enum([...SCHOOL_BUSINESS_ROLES, "participant"]) });
export const schoolGroupSchema = z.object({ id: z.string().uuid(), name: z.string() });

export function schoolCollaborationMessages(locale: string) {
  const en = locale.startsWith("en");
  return {
    title: en ? "Business groups" : "业务分组",
    description: en ? "Group members can view the group's student records. Staff who participated keep access to edit within their job permissions." : "组员可查看组内学生资料；参与过业务的员工保留相应岗位的编辑权限。",
    sourceHint: en ? "Source groups are retained on records. Set current staff memberships here." : "原表组别保留在学生记录中，当前员工的组别在此维护。",
    name: en ? "Group name" : "组名", add: en ? "Create group" : "新建组", rename: en ? "Rename" : "改名",
    save: en ? "Save" : "保存", saving: en ? "Saving…" : "正在保存…", cancel: en ? "Cancel" : "取消",
    staff: en ? "Staff" : "员工", role: en ? "Business role" : "业务角色", choose: en ? "Choose" : "请选择",
    roles: { school_support: en ? "Learning support" : "学服", assessment_teacher: en ? "Substitute / assessment teacher" : "代课／测评老师", teacher: en ? "Class teacher" : "授课老师", participant: en ? "Participant" : "参与人" },
    members: en ? "Members" : "成员", memberHint: en ? "Select each group a staff member can view." : "勾选员工可查看的组；取消勾选后撤回该组查看权限。",
    error: en ? "Could not save. Refresh and check your access." : "保存未完成，请刷新后核对权限。", saved: en ? "Saved" : "已保存",
    mine: en ? "I participated" : "我参与的", group: en ? "My groups" : "本组", all: en ? "All accessible" : "全部可见", scope: en ? "View scope" : "查看范围",
    collaborate: en ? "Collaborators / group" : "参与人／组别", collaborator: en ? "Add participant" : "添加参与人",
    collaborateHint: en ? "Add staff with an actual role in this student's work. Existing participation remains recorded." : "按实际分工添加参与人；原有参与经历继续保留。",
    empty: en ? "No group membership yet." : "尚未加入业务组。", back: en ? "Students" : "返回学生",
  };
}
