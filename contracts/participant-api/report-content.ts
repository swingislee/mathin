import { type ContentDocument, type ExperienceLocale } from "./miniapp-experience";
import type { ContentData } from "./miniapp-content-render";
import type { AssessmentReferenceValidity } from "./assessment-result-validity";
export type ReportContent = { contentDocument?: ContentDocument | null; contentImages?: Record<string, string>; reportData?: Record<string, unknown>; referenceValidity?: AssessmentReferenceValidity };
export function reportContentContext(row: ReportContent & { title: string; participantName: string; date: string; summary: string; score?: number | null }, locale: ExperienceLocale): ContentData {
  const source = row.reportData || {}, validity = row.referenceValidity, en = locale === "en";
  const fact = (id: string, zh: string, english: string, body: unknown) => ({ id, title: { zh, en: english }, body: typeof body === "string" ? body : "" });
  return { participant: { name: row.participantName }, report: { ...row, ...source, context: [fact("participant", "参与人", "Participant", row.participantName), fact("activity", "本次服务", "Service", row.title),
    fact("assessedAt", "测评时间", "Assessed on", validity?.assessedOn || source.assessedAt), fact("grade", "学习阶段", "Stage", source.gradeText), fact("teacher", "记录老师", "Recorded by", source.recordedByName)].filter(f => f.body),
    validity, validityText: validity ? (validity.status === "valid" ? `${en ? "Reference valid through " : "参考有效期至 "}${validity.validUntil}` : validity.status === "expired" ? `${en ? "Reference expired on " : "参考有效期已于 "}${validity.validUntil}${en ? ". Consider a new assessment." : " 到期，可结合近况重新测评。"}` : (en ? "Reference period is not established. Confirm the assessment date." : "暂无法确定参考有效期，请核对测评日期。")) : "" } };
}
