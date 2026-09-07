import type { StudentStage } from "./student-stage-contract";

export function studentStageMessages(locale: string) {
  const en = locale.startsWith("en");
  const stages: Record<StudentStage, string> = en ? {
    awaiting_first_contact: "First contact", awaiting_assessment: "Awaiting assessment", awaiting_enrollment: "Awaiting enrollment",
    awaiting_renewal: "Ongoing & renewal", former_student: "Former students",
  } : { awaiting_first_contact: "待首联", awaiting_assessment: "待测评", awaiting_enrollment: "待报名", awaiting_renewal: "待续班", former_student: "历史学员" };
  const details: Record<string, string> = en ? {
    not_contacted: "Not contacted", unreachable: "Not reached", unassigned: "Unassigned", invalid_number: "Invalid number",
    not_booked: "Not booked", coordinating: "Arranging assessment", booked: "Assessment booked", no_show: "Missed · rebook", cancelled: "Cancelled · follow up",
    in_progress: "Assessment unfinished", assessed: "Assessed · not enrolled", awaiting_reply: "Awaiting reply", considering: "Considering",
    ready_to_enroll: "Interested in enrolling", awaiting_class: "Awaiting a class", not_enrolling: "Not enrolling for now",
    attending: "Attending", withdrawn: "Withdrawn", ended: "Course ended", payment_pending: "Payment to verify", nurturing: "Keep in touch",
    renewal_considering: "Considering renewal", renewal_committed: "Intends to renew", renewal_confirmed: "Renewed", not_renewing: "Not renewing this time",
  } : { not_contacted: "尚未联系", unreachable: "未接通", unassigned: "待分配", invalid_number: "号码无效",
    not_booked: "尚未预约", coordinating: "测评协调中", booked: "已约待测", no_show: "未到待重约", cancelled: "取消后待沟通",
    in_progress: "测评待完成", assessed: "测后未报", awaiting_reply: "待回复", considering: "考虑中", ready_to_enroll: "有意报名",
    awaiting_class: "等班", not_enrolling: "暂不报名", attending: "在读", withdrawn: "已退课", ended: "课程已结束", payment_pending: "缴费待核实", nurturing: "长期关注",
    renewal_considering: "续班考虑中", renewal_committed: "有意续班", renewal_confirmed: "本轮已续", not_renewing: "本轮不续" };
  return {
    stages, details, title: en ? "Students" : "学生", name: en ? "Student / parent" : "学生／家长", state: en ? "Current situation" : "当前情况",
    background: en ? "Assessment / learning" : "测评／学习", owner: en ? "Owner" : "负责人", recent: en ? "Latest note" : "最近记录",
    nextContact: en ? "Next contact" : "下次联系", actions: en ? "Actions" : "操作", search: en ? "Find by name or phone across stages" : "跨阶段搜索姓名、手机号",
    searchHint: en ? "Search includes every stage within this scope." : "搜索覆盖当前负责范围内的全部阶段。",
    mine: en ? "My students" : "我的学生", all: en ? "All accessible" : "全部可见", unassigned: en ? "Unassigned" : "未分配",
    allDetails: en ? "All situations" : "全部情况", empty: en ? "No students in this view." : "当前范围没有学生。",
    note: en ? "Add a note" : "记情况", contact: en ? "Record contact" : "登记首联", invitation: en ? "Assessment / activity" : "测评／活动邀约",
    book: en ? "Book assessment" : "预约测评", rebook: en ? "Rebook assessment" : "重新预约", enrollment: en ? "Record enrollment" : "报名登记",
    renewal: en ? "Record renewal" : "续班登记", reactivate: en ? "Enroll again" : "重新报名", save: en ? "Save" : "保存", saved: en ? "Saved" : "已保存",
    saveNext: en ? "Save and next" : "保存并下一位", saving: en ? "Saving…" : "正在保存…", refresh: en ? "Refresh list" : "刷新名单",
    retained: en ? "Saved · retained in this list" : "本轮已处理", history: en ? "View history" : "查看经历", more: en ? "More" : "更多",
    loadFailed: en ? "Could not load. Try again." : "加载失败，请重试。", saveFailed: en ? "Could not save. Your draft is kept." : "保存失败，输入已保留。",
    conflict: en ? "This arrangement changed. Reload its latest details before saving." : "这项安排已被更新，请读取最新情况后再保存。",
    retry: en ? "Retry" : "重试", loading: en ? "Loading…" : "正在读取…", noNext: en ? "No contact scheduled" : "未约下次联系", noNote: en ? "No note yet" : "暂无记录",
    noAssessment: en ? "No completed assessment" : "尚无已完成测评", noCourse: en ? "Course not confirmed" : "课程尚未确认",
    contactOutcome: en ? "Contact result" : "联系结果", connected: en ? "Spoke with parent" : "已沟通", declined: en ? "Contact later" : "暂缓／下次联系",
    noteHint: en ? "A note can be saved on its own; it does not create an appointment or enrollment." : "可以单独记情况；有明确安排时再登记测评或报名。",
    firstContactHint: en ? "Choose the actual contact result to save this first contact." : "按本次实际联系结果保存首联。",
    renewalHint: en ? "Current learning and the next enrollment period are tracked separately." : "本期学习继续保留；续班登记明确选择下一期课程。",
    formerHint: en ? "Prior enrollment has ended and no current course remains. Prior records are retained." : "曾经报名的课程已结束，当前没有有效课程关系；原有经历继续保留。",
    needOwner: en ? "Assign an owner in the lead list before contacting." : "先在线索名单分配负责人，再登记首联。",
    needIdentity: en ? "Confirm the student identity before enrolling." : "确认学生身份后即可登记报名。",
    phoneRequired: en ? "Add a valid phone number to this student's profile first." : "请先在学生资料中补充有效联系电话。",
    invitationIncomplete: en ? "Complete the selected arrangement, or return to the note tab to save just the note." : "补齐本次邀约；也可以切回记情况，先单独保存备注。",
    activeInvitation: en ? "An existing arrangement is loaded. Save changes to this arrangement." : "已载入现有邀约，本次保存会更新这条安排。",
    activeKind: en ? "Finish or cancel the existing arrangement before creating a different type." : "已有其他类型的邀约，请先处理原安排，再创建不同类型的邀约。",
    course: en ? "Course" : "课程", term: en ? "Period" : "期次", choose: en ? "Choose" : "请选择", enrollmentResult: en ? "Enrollment result" : "本次报名结果",
    considering: en ? "Considering" : "考虑中", committed: en ? "Intends to enroll" : "有意报名", paymentPending: en ? "Payment to verify" : "缴费待核实",
    notEnrolled: en ? "Not enrolling this time" : "本轮不报名", nurturing: en ? "Keep in touch" : "长期关注",
    confirmEnrollment: en ? "Payment verified · confirm enrollment" : "已核实缴费，确认报名", paymentEvidence: en ? "Payment verification reference" : "缴费确认依据",
    evidenceHint: en ? "Receipt reference or the basis of your payment verification" : "填写收款凭据编号或本次人工核验依据",
    enrollmentHint: en ? "An intention stays pending. Confirmed enrollment enters ongoing service; class placement follows separately." : "意向保留在待报名；确认报名后进入待续班，班级安排在分班中继续办理。",
    discard: en ? "Discard this draft" : "放弃本行草稿", dirty: en ? "Draft kept" : "草稿已保留",
  };
}
