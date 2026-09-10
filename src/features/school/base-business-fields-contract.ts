import { z } from "zod";
import { BASE_BUSINESS_SECTIONS, baseBusinessFieldSchema, baseLeadAcquisitionSchema } from "./base-business-fields-schema.mjs";
export { BASE_BUSINESS_SECTIONS, baseBusinessFieldSchema, baseBusinessFieldsSchema, baseLeadAcquisitionSchema } from "./base-business-fields-schema.mjs";
export type BaseBusinessField = z.infer<typeof baseBusinessFieldSchema>;
export type BaseLeadAcquisition = z.infer<typeof baseLeadAcquisitionSchema>[number];
type ReviewReason = NonNullable<BaseBusinessField["review"]>[number];

export function baseBusinessMessages(locale: string) {
  const en = locale.startsWith("en");
  const sections: Record<typeof BASE_BUSINESS_SECTIONS[number], string> = en ? {
    identity: "Student and family", acquisition: "Acquisition", followup: "Communication", confirmation: "Confirmation",
    visit: "Visits and activities", assessment: "Assessment and background", enrollment: "Enrollment", support: "Staff and groups",
    renewal: "Renewal", finance: "Original payment information", teaching: "Learning and teaching", competition: "Competition preparation",
    content: "Content and promotion", resources: "Resources", operations: "Operations and targets", notes: "Notes", reference: "Additional source fields", unmapped: "Additional source fields",
  } : {
    identity: "学生与家庭", acquisition: "获客资料", followup: "沟通跟进", confirmation: "确认资料", visit: "到访与活动",
    assessment: "测评与学习背景", enrollment: "报名资料", support: "服务人员与组别", renewal: "续报资料", finance: "原缴费资料",
    teaching: "学习与教学", competition: "竞赛与备考", content: "内容与推广", resources: "资源资料", operations: "运营记录与目标",
    notes: "补充备注", reference: "补充字段", unmapped: "补充字段",
  };
  return {
    review: (en ? { unrecognized: "Confirm the source meaning", missing: "Source value is unspecified", transition: "Grade transition; confirm the applicable school year",
      multiple_grades: "Several grades; confirm the corresponding children", ambiguous: "Confirm the original wording", conflicting_options: "Source options conflict",
      time_period: "Confirm AM or PM", scale: "Keep this rating scale separate", reference: "Source reference needs a readable label", class_label: "Confirm the historical class label", field_mismatch: "Check whether this value belongs in this field" }
      : { unrecognized: "请核对来源含义", missing: "原值尚未明确", transition: "升年级表达，请核对适用学年", multiple_grades: "多个年级，请核对对应孩子",
        ambiguous: "请核对原文含义", conflicting_options: "原选项存在冲突", time_period: "请核对上下午", scale: "保留原评价尺度，对应关系待确认", reference: "来源引用待补显示名称", class_label: "请核对历史班型名称", field_mismatch: "请核对原值是否填入了对应字段" }) satisfies Record<ReviewReason, string>,
    sections, title: en ? "Organized source information" : "整理后的业务资料",
    hint: en ? "Information is grouped for each source record. Original dates, wording and staff labels remain available." : "按每条来源记录整理，保留原日期、原文和人员署名。",
    original: en ? "Original" : "原文", rawOnly: en ? "The source contains a value without display text. View the original field." : "原字段有值但没有显示文本，可查看原字段。",
    sourceFields: en ? "View original fields" : "查看原字段", content: en ? "Outreach content" : "触达内容",
    group: en ? "Acquisition group" : "获客组别", dateLabel: en ? "Original acquisition date" : "原获取日期",
    financeHint: en ? "Historical source amounts and payment descriptions are kept here." : "此处保留历史来源中的金额和缴费方式。",
  };
}
