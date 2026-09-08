import type { OverviewDetailQuery } from "./staff-overview-drilldown-contract";

const SOURCES = ["activities", "registrations", "assessments", "courseEnrollments", "memberships", "enrollmentAssignments", "classrooms",
  "acquisitionSources", "leadSubmissions", "leads", "communications", "invitationEvents", "invitationThreads", "assignments",
  "leadActions", "supportTasks", "profiles", "staffRoleMembers", "opportunities", "operationalLeads"] as const;
export type OverviewReadSource = typeof SOURCES[number];

/** 总览读取全部事实；明细沿用同一计算函数，只读取所选指标的事实与归属依赖。 */
export function overviewReadSources(detail?: OverviewDetailQuery): Set<OverviewReadSource> {
  if (!detail) return new Set(SOURCES);
  const sources = new Set<OverviewReadSource>(["profiles"]);
  const add = (...keys: OverviewReadSource[]) => keys.forEach(key => sources.add(key));
  const participation = () => add("activities", "registrations", "assessments", "leads");
  const enrollment = () => add("activities", "registrations", "courseEnrollments", "memberships", "enrollmentAssignments", "classrooms", "opportunities");
  if (detail.kind === "capacity") add("classrooms", "memberships", "assignments");
  else if (detail.kind === "participation") { participation(); enrollment(); }
  else if (detail.kind === "pending") {
    if (["unassignedLeads", "uncontactedLeads", "overdueLeadActions"].includes(detail.metric ?? "")) {
      add("leads", "operationalLeads");
      if (detail.metric === "overdueLeadActions") add("leadActions");
    } else if (detail.metric === "unassessedArrivals") participation();
    else if (detail.metric === "pendingSupportTasks") add("supportTasks");
    else add("invitationEvents", "invitationThreads");
  } else {
    add("leads");
    if (detail.metric === "leads") add("acquisitionSources", "leadSubmissions", "communications", "registrations", "assessments");
    else if (detail.metric === "contacts") add("communications");
    else {
      add("activities", "registrations", "invitationEvents", "invitationThreads");
      if (detail.metric === "assessments") add("assessments");
      if (detail.metric === "enrollments") enrollment();
    }
  }
  return sources;
}
