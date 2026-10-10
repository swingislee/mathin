import { newId } from "@/lib/uuid";
import { calendarDayKey, addCalendarDays } from "./schedule";

export type AssessmentRuleTopic = string;
export interface AssessmentTopicDefinition {
  id: string;
  name: string;
  nameEn: string;
  enabled: boolean;
  updatedAt: string;
}
export type AssessmentRuleKind = "open" | "exclude";
export interface AssessmentRuleScope {
  kind: "all" | "groups" | "teachers";
  ids: string[];
}

export interface AssessmentRuleDefinition {
  kind: AssessmentRuleKind;
  label: string;
  campusId: string | null;
  topics: AssessmentRuleTopic[];
  grades: number[];
  /** ISO weekdays: Monday = 1, Sunday = 7. Empty means every day for exclusions. */
  weekdays: number[];
  from: string;
  until: string;
  startMinute: number;
  endMinute: number;
  durationMinutes: number | null;
  timeZone: string;
  enabled: boolean;
}

export interface AssessmentRule extends AssessmentRuleDefinition {
  id: string;
  teacherId: string | null;
  scope: AssessmentRuleScope | null;
  updatedAt: string;
  availableCount: number;
  bookedCount: number;
}

export interface AssessmentRulesWorkspace {
  currentUserId: string;
  canManageAll: boolean;
  canManageStaff: boolean;
  teachers: { id: string; displayName: string; canReceive: boolean; standaloneCount: number; groupIds: string[] }[];
  groups: { id: string; name: string }[];
  campuses: { id: string; name: string; active: boolean }[];
  topics: AssessmentTopicDefinition[];
  rules: AssessmentRule[];
}

export interface SaveAssessmentRuleInput {
  id: string;
  teacherId: string | null;
  scope?: AssessmentRuleScope | null;
  definition: AssessmentRuleDefinition;
  expectedUpdatedAt: string | null;
}

export function newAssessmentRule(teacherId: string | null, kind: AssessmentRuleKind, timeZone: string, now: number, campusId: string | null, topics: string[]): SaveAssessmentRuleInput {
  const today = calendarDayKey(new Date(now), timeZone);
  return {
    id: newId(), teacherId, scope: teacherId ? null : { kind: "all", ids: [] }, expectedUpdatedAt: null,
    definition: {
      kind, label: "", campusId: kind === "open" ? campusId : null,
      topics: kind === "open" ? topics : [], grades: [],
      weekdays: kind === "open" ? [6, 7] : [], from: today,
      until: kind === "open" ? calendarDayKey(addCalendarDays(new Date(now), 90, timeZone), timeZone) : today,
      startMinute: kind === "open" ? 9 * 60 : 0,
      endMinute: kind === "open" ? 12 * 60 : 24 * 60,
      durationMinutes: kind === "open" ? 40 : null, timeZone, enabled: true,
    },
  };
}

export function editAssessmentRule(rule: AssessmentRule): SaveAssessmentRuleInput {
  return { id: rule.id, teacherId: rule.teacherId, scope: rule.scope, expectedUpdatedAt: rule.updatedAt, definition: {
    kind: rule.kind, label: rule.label, campusId: rule.campusId,
    topics: [...rule.topics], grades: [...rule.grades], weekdays: [...rule.weekdays],
    from: rule.from, until: rule.until, startMinute: rule.startMinute, endMinute: rule.endMinute,
    durationMinutes: rule.durationMinutes, timeZone: rule.timeZone, enabled: rule.enabled,
  } };
}

export function assessmentRuleApplies(rule: AssessmentRule, teacher: AssessmentRulesWorkspace["teachers"][number]): boolean {
  return rule.teacherId === teacher.id || (rule.teacherId === null && Boolean(rule.scope && (
    rule.scope.kind === "all" || (rule.scope.kind === "teachers" && rule.scope.ids.includes(teacher.id)) ||
    (rule.scope.kind === "groups" && rule.scope.ids.some(id => teacher.groupIds.includes(id))))));
}

export interface AssessmentCalendarSlot {
  id: string;
  campusId: string;
  subjects: string[];
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  activeBooked: boolean;
  blocked: boolean;
}

export function ruleMinuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function ruleTimeMinute(value: string): number | null {
  if (value === "24:00") return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
