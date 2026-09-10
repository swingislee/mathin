import { z } from "zod";
import { baseBusinessFieldsSchema } from "./base-business-fields-schema.mjs";

const id = z.uuid().or(z.guid());
export const schoolRecordSubjectSchema = z.object({ studentId: id.nullable(), leadId: id.nullable() })
  .refine(subject => subject.studentId !== null || subject.leadId !== null);
export type SchoolRecordSubject = z.infer<typeof schoolRecordSubjectSchema>;
export const schoolRecordHintsSchema = z.array(z.object({ key: z.string(), possibleDuplicateCount: z.number().int().nonnegative() }));
export const schoolRecordContextSchema = z.object({
  candidates: z.array(z.object({ studentId: id.nullable(), leadId: id.nullable(), name: z.string(), phone: z.string(), grade: z.number().nullable(), school: z.string() })),
  sources: z.array(z.object({ id: z.string(), table: z.string(), source: z.string(), date: z.string().nullable(), association: z.enum(["linked", "inferred"]),
    businessFields: baseBusinessFieldsSchema.optional(),
    cells: z.array(z.object({ id: z.string(), name: z.string(), text: z.string(), type: z.string() })) })),
  sourceCount: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive(),
});
export type SchoolRecordContext = z.infer<typeof schoolRecordContextSchema>;
export const schoolRecordKey = (subject: SchoolRecordSubject) => subject.studentId ? `student:${subject.studentId}` : `lead:${subject.leadId}`;

export function schoolRecordReviewMessages(locale: string) {
  const en = locale.startsWith("en");
  return {
    possibleDuplicate: en ? "Possible duplicate" : "可能重复",
    duplicateHint: en ? "Another accessible record has the same name and phone. Check it when working with this student." : "有姓名与电话相同的记录，办理到该学生时可查看核对。",
    candidates: en ? "Records to compare" : "可核对的记录",
    decisionHint: en ? "These records stay separate. Continue your work, and decide whether to link or merge them after checking." : "各条记录继续保留，可照常办理，核对后再决定是否关联或合并。",
    sourceTitle: en ? "Original source fields" : "原表资料",
    sourceHint: en ? "Read the original fields for each source record, including details not yet shown in the business fields." : "按来源记录查看完整字段，包括尚未进入业务字段的资料。",
    open: en ? "View original fields and related records" : "查看原表资料与相关记录",
    student: en ? "Student" : "学生", lead: en ? "Lead" : "线索", view: en ? "View record" : "查看记录",
    unknown: en ? "Not recorded" : "未记录", inferred: en ? "Association to check" : "资料关联待核对",
    empty: en ? "No linked source records yet." : "当前尚无关联的原表资料。",
    loading: en ? "Loading source records…" : "正在读取原表资料…", retry: en ? "Retry" : "重试",
    failed: en ? "Could not load these records. Try again." : "资料读取未完成，请重试。",
    previous: en ? "Previous" : "上一页", next: en ? "Next" : "下一页", close: en ? "Close" : "关闭",
  };
}
