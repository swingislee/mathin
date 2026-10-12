import { z } from "zod";
export type { AssessmentReferenceValidity } from "../../../../contracts/parent-api/assessment-result-validity";

export const referenceValiditySchema = z.object({
  status: z.enum(["valid", "expired", "unknown"]),
  assessedOn: z.iso.date().nullable(), validUntil: z.iso.date().nullable(),
  validityMonths: z.number().int().min(1).max(36),
});
export const referencePolicySchema = z.object({
  validityMonths: z.number().int().min(1).max(36), updatedAt: z.iso.datetime({ offset: true }), canManage: z.boolean(),
});
export type AssessmentReferencePolicy = z.infer<typeof referencePolicySchema>;

export function referenceValidityMessages(locale: string) {
  return locale.startsWith("en") ? {
    title: "Result validity", valid: "Valid", expired: "Expired", unknown: "Date needs review",
    assessedOn: "Assessed on", validUntil: "Valid through", months: "Reference validity (months)",
    policyHint: "Applies to completed assessments across all topics, starting on the actual assessment date. Changing this rule recalculates current validity, including historical results.",
    historyHint: "Historical results and reports remain available. Use a new assessment when a current recommendation is needed.",
    unknownHint: "Check the assessment date before using this result as a current reference.",
    save: "Save", saving: "Saving…", loading: "Loading…", saved: "Rule saved", retry: "Reload",
    conflict: "This rule has changed. Reload the current rule before saving again.",
    failed: "Unable to load or save the rule. Your input has been kept.",
    forbidden: "You can view this rule. A coordinator can change it.", validation: "Enter a whole number from 1 to 36.",
  } : {
    title: "结果有效期", valid: "有效", expired: "已失效", unknown: "日期待核对",
    assessedOn: "测评日期", validUntil: "有效至", months: "参考有效期（月）",
    policyHint: "统一用于各主题的已完成测评，从实际测评日期起算。修改后，含历史结果在内的当前有效性会按新规则重新计算。",
    historyHint: "历次结果与报告持续保留。需要判断当前情况时，可安排重新测评。",
    unknownHint: "核对测评日期后，再判断这份结果能否作为当前参考。",
    save: "保存", saving: "保存中…", loading: "加载中…", saved: "规则已保存", retry: "重新读取",
    conflict: "规则已被其他人修改，请重新读取后再保存。", failed: "规则读取或保存失败，已保留当前输入。",
    forbidden: "可查看当前规则，由学服或排课负责人调整。", validation: "请输入 1–36 的整数月数。",
  };
}
