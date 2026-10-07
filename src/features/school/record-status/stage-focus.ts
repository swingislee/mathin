import type { StudentStageRow } from '../student-stage-contract';
import type { LearningCheckStatus } from '../session-learning-contract';
import { studentStageMessages } from '../student-stage-messages';
import type { StatusFacet } from './contract';

const FACETS: Record<StudentStageRow['stage'], readonly StatusFacet[]> = {
  awaiting_first_contact: ['wechat','interest','visit'],
  awaiting_assessment: ['interest','visit'],
  awaiting_enrollment: ['assessment','interest'],
  awaiting_renewal: [],
  former_student: [],
};

export type ProgressGlyph = 'calendar' | 'calendarCheck' | 'calendarX' | 'teacher' | 'parent' | 'activity'
  | 'assessment' | 'message' | 'hourglass' | 'payment' | 'check' | 'pause' | 'class' | 'book';
export interface StageProgressTag { key: string; label: string; glyph: ProgressGlyph; tone: LearningCheckStatus; context: string[] }
const DETAIL_MARKS: Record<string, [ProgressGlyph, LearningCheckStatus]> = {
  not_booked: ['calendar','unchecked'], coordinating: ['calendar','prompted'], booked: ['calendarCheck','explained'],
  no_show: ['calendarX','incomplete'], cancelled: ['calendarX','imitated'], in_progress: ['assessment','prompted'],
  attended_without_result: ['assessment','imitated'], assessed: ['message','unchecked'], awaiting_reply: ['message','prompted'],
  considering: ['hourglass','prompted'], ready_to_enroll: ['check','explained'], payment_pending: ['payment','imitated'],
  not_enrolling: ['pause','incomplete'], nurturing: ['message','unchecked'], awaiting_class: ['class','prompted'], attending: ['book','independent'],
  renewal_considering: ['hourglass','prompted'], renewal_committed: ['check','explained'], renewal_confirmed: ['check','independent'],
  not_renewing: ['pause','incomplete'], withdrawn: ['pause','incomplete'], ended: ['book','unchecked'],
};

/** 主阶段决定关注范围；中间状态来自已保存的邀约、测评、报名与课程关系。 */
export function recordStageFocus(row: StudentStageRow, locale: string): { facets: readonly StatusFacet[]; progress: StageProgressTag | null } {
  const facets = FACETS[row.stage];
  // 首联已有独立的联系结果，不再重复绘制同一结果。
  if (row.stage === 'awaiting_first_contact') return { facets, progress: null };
  const en = locale.startsWith('en'), messages = studentStageMessages(locale);
  let key = row.detail, label = messages.details[key];
  let mark = DETAIL_MARKS[key];
  const invitation = row.stage === 'awaiting_assessment' ? row.invitation : null;
  const invitationLabels = en ? {
    coordinating_time: 'Coordinating time', awaiting_teacher: 'Awaiting teacher confirmation', awaiting_parent: 'Awaiting parent confirmation',
    waiting_activity: 'Waiting for a suitable activity', confirmed: invitation?.kind === 'activity' ? 'Activity booked' : 'Assessment booked',
  } : {
    coordinating_time: '协调时间中', awaiting_teacher: '待老师确认', awaiting_parent: '待家长确认',
    waiting_activity: '等待合适活动', confirmed: invitation?.kind === 'activity' ? '活动已约' : '已约待测',
  };
  const invitationMarks: Record<string, [ProgressGlyph, LearningCheckStatus]> = {
    coordinating_time: ['calendar','prompted'], awaiting_teacher: ['teacher','prompted'], awaiting_parent: ['parent','prompted'],
    waiting_activity: ['activity','unchecked'], confirmed: ['calendarCheck','explained'],
  };
  if (invitation && invitation.state in invitationMarks && !['no_show','cancelled','in_progress','attended_without_result'].includes(row.detail)) {
    key = invitation.state;
    label = invitationLabels[key as keyof typeof invitationLabels];
    mark = invitationMarks[key];
  }
  const context = row.stage === 'awaiting_assessment'
    ? [invitation ? (en ? 'Current invitation' : '当前邀约') : (en ? 'Current assessment progress' : '当前测评进展'), invitation?.locationText ?? '', row.sourceArrangement ?? '']
    : [row.stage === 'awaiting_enrollment' ? (en ? 'Enrollment follow-up' : '报名跟进') : (en ? 'Course / renewal record' : '课程／续班记录'), row.courseTitle, row.termName];
  return { facets, progress: mark && label ? { key, label, glyph: mark[0], tone: mark[1], context: context.filter(Boolean) } : null };
}
