import { assessmentAppointmentClosed, assessmentWorkbenchHasConfirmedEnrollment, assessmentWorkbenchHasFinalResult, assessmentWorkbenchStage, type AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { currentAssessmentReportWasSent } from "./assessment-workflow-contract";

export const ASSESSMENT_DETAIL_STATUSES = ["pending", "continue_entry", "prepare_report", "give_feedback", "contacting", "awaiting_reply", "considering", "ready_to_enroll",
  "awaiting_class", "trial", "enrolled", "not_enrolling", "rescheduled", "no_show", "cancelled", "handled"] as const;
export type AssessmentDetailStatus = typeof ASSESSMENT_DETAIL_STATUSES[number];

/** 本次预约、专业结果、家长意向与实际报名分别取证；未保存的页面草稿不参与。 */
export function assessmentDetailStatuses(row: AssessmentWorkbenchRow): AssessmentDetailStatus[] {
  if (assessmentAppointmentClosed(row)) return [row.participationStatus === "cancelled" ? "cancelled" : "no_show"];
  const workflow = row.workflow;
  const enrolled = assessmentWorkbenchHasConfirmedEnrollment(row);
  const completed = assessmentWorkbenchHasFinalResult(row) || Boolean(row.sourceEnrollmentFacts?.confirmed);
  const stage = assessmentWorkbenchStage(row);
  const decision = workflow?.classification;
  const communicating = Boolean(workflow?.contactedAt || decision || currentAssessmentReportWasSent(workflow));
  const primary: AssessmentDetailStatus = enrolled && completed ? "enrolled" : stage === "pending" ? "pending" : stage === "in_progress" ? "continue_entry"
    : decision && decision !== "awaiting_reply" ? decision : workflow?.trialIntent ? "trial"
      : communicating ? "contacting" : stage === "handled" ? "handled" : workflow?.report ? "give_feedback" : "prepare_report";
  const labels: AssessmentDetailStatus[] = [primary];
  if (enrolled) labels.push("enrolled");
  else {
    if (decision) labels.push(decision);
    if (workflow?.trialIntent) labels.push("trial");
  }
  if (stage === "pending" && row.rescheduledAt) labels.push("rescheduled");
  return [...new Set(labels)];
}

export function assessmentStatusMessages(locale: string) {
  const en = locale.startsWith("en");
  const labels: Record<AssessmentDetailStatus, string> = en ? {
    pending: "Awaiting assessment", continue_entry: "Continue assessment entry", prepare_report: "Prepare report", give_feedback: "Give report feedback", contacting: "In conversation", awaiting_reply: "Awaiting reply",
    considering: "Considering", ready_to_enroll: "Interested in enrolling", awaiting_class: "Awaiting a class", trial: "Trial class", enrolled: "Enrolled",
    not_enrolling: "Not enrolling for now", rescheduled: "Rescheduled", no_show: "No show", cancelled: "Cancelled", handled: "Next-step follow-up",
  } : {
    pending: "待测评", continue_entry: "继续测评登记", prepare_report: "生成测评报告", give_feedback: "反馈测评报告", contacting: "沟通中", awaiting_reply: "待回复",
    considering: "考虑中", ready_to_enroll: "有意报名", awaiting_class: "等待开班", trial: "体验课", enrolled: "已报名",
    not_enrolling: "暂不报名", rescheduled: "已改期", no_show: "未到", cancelled: "已取消", handled: "去向跟进",
  };
  return { labels, substatus: en ? "Detailed status" : "细分状态" };
}
