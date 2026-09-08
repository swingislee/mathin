import {normalizeSourceAssessmentBand,readSourceEnrollmentFacts,type CurrentAssessmentBand} from './business-source-contract';

export type SourceMissingField='first_contact'|'assessment_record'|'assessment_date'|'assessment_score'|'assessment_teacher'|'assessment_band'|'assessment_occurrence'|'band_conflict';
export interface SourceCompletionSummary { enrolled: boolean; knownBand: CurrentAssessmentBand | null; missing: SourceMissingField[] }
export interface SourceAssessmentEvidence {
  status: string; hasResult: boolean; date: string | null; band: string | null; score: number | null; teacher: string | null;
}

/** 缺项从当前记录计算，补齐后消失；学生阶段与单次预约的状态分别展示。 */
export function sourceCompletionSummary(facts: readonly unknown[],contactRecorded: boolean,assessments: readonly SourceAssessmentEvidence[]): SourceCompletionSummary | null {
  const enrollment=facts.map(readSourceEnrollmentFacts).filter(fact=>fact!==null);
  const bands=[...new Set(enrollment.map(fact=>fact.assessmentBand).filter(band=>band!==null))];
  const knownBand=bands.length===1?bands[0]:null;
  const attended=assessments.filter(row=>row.status==='attended');
  const recorded=attended.filter(row=>row.hasResult).sort((a,b)=>(b.date??'').localeCompare(a.date??''));
  const latest=recorded[0];
  if(!enrollment.length&&!latest)return null;
  const missing:SourceMissingField[]=[];
  if(!contactRecorded)missing.push('first_contact');
  if(!latest)missing.push('assessment_record');
  if(!(latest?.date??attended.find(row=>row.date)?.date))missing.push('assessment_date');
  if(latest?.score==null)missing.push('assessment_score');
  if(!latest?.teacher)missing.push('assessment_teacher');
  if(!knownBand&&!latest?.band)missing.push('assessment_band');
  if(knownBand&&!recorded.some(row=>normalizeSourceAssessmentBand(row.band)===knownBand))missing.push('assessment_occurrence');
  if(bands.length>1)missing.push('band_conflict');
  return {enrolled:enrollment.length>0,knownBand,missing};
}

export function sourceCompletionMessages(locale:string) {
  const en=locale.startsWith('en');
  return {
    contacted:en?'Contact confirmed':'已首联',assessed:en?'Assessment confirmed':'已测评',enrolled:en?'Enrolled':'已报名',
    pending:en?'Details to complete':'资料待补',basis:en?'Earlier stages confirmed by enrollment; original details remain to be completed.':'依据报名确认首联与测评已完成，具体资料按下列缺项补录。',
    assessmentBasis:en?'Attendance and assessment feedback are recorded. Complete the missing assessment details while following up on enrollment.':'已到场并有测评记录，请补充下列测评资料，继续跟进报名。',
    knownBand:en?'Known band from enrolled class':'报名班型对应等级',noShow:en?'No show':'未到',cancelled:en?'Cancelled':'已取消',
    attendance:en?'Attendance':'到访状态',booked:en?'Booked':'已预约',attended:en?'Attended':'已到',
    closedHint:en?'This appointment has ended. Its attendance is separate from the student’s overall progress.':'本次预约已结束，到访状态与学生整体进展分别保留。',
    missing:{
      first_contact:en?'First contact record':'首联记录',assessment_record:en?'Assessment record':'测评记录',
      assessment_date:en?'Assessment date':'测评日期',assessment_score:en?'Assessment score':'测评分数',
      assessment_teacher:en?'Assessment teacher':'测评老师',assessment_band:en?'Assessment band':'测评等级',
      assessment_occurrence:en?'Link the band to its assessment':'等级所属测评场次',band_conflict:en?'Reconcile differing class bands':'不同报名班型对应的等级核对',
    } satisfies Record<SourceMissingField,string>,
  };
}
