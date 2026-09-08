export type SourceUseCell = {name:string;text:string};
export type SourceUseStudent = {id:string;name:string;grade:number|null;phone:string};
export interface SourceUseContext {
  recordId:string;title:string;source:string;name:string;studentId:string|null;version:number;canConfirm:boolean;
  students:SourceUseStudent[];cells:SourceUseCell[];
  matchState?:'inferred'|'confirmed';
}
export interface StudentSourceArchive {
  total:number;page:number;pageSize:number;canConfirm:boolean;
  rows:{id:string;title:string;source:string;name:string;dateLabel:string|null;linked:boolean;version:number;matchState?:'inferred'|'confirmed';cells:SourceUseCell[]}[];
}
export const sourceUseMessages=(locale:string)=>locale==='en'?{
  title:'Source records',hint:'Records are saved with the most likely association. Check or correct uncertain details when working with the student.',
  original:'View original details',use:'Use for a follow-up',question:'Which student does this record belong to?',
  questionHint:'Check the original details and choose the student for this follow-up. This choice will be saved for future work.',
  choose:'Choose a student',search:'Search student name or phone',searchAction:'Search',confirm:'Confirm and continue',later:'Keep for later',
  loading:'Loading source details…',failed:'Unable to open this record. Please try again.',
  conflict:'This association has changed. Reopen the record to see the latest choice.',inUse:'This record is already used in another student’s work. Review that record before changing its association.',
  shared:'This source contains a shared roster. Its original details remain available; use an individual student record for this action.',
  unavailable:'This record keeps its existing association. You can continue to read the original details.',associationRequired:'Confirm which student this source belongs to before using it for a follow-up.',
  noStudents:'No matching student found. Search for an existing profile, or keep this source for later.',
  pending:'Confirm when used',linked:'Linked to this student',sourceContext:'Reference for this follow-up',sourceSaved:'View source used for this follow-up',
  empty:'No source records are linked to this student yet.',previous:'Previous',next:'Next',unknown:'Not recorded',
}:{
  title:'来源资料',hint:'资料已按现有线索保存最可能的关联；有疑点时，在实际办理到该学生时核对或修改。',
  original:'查看完整原文',use:'参考此资料记录沟通',question:'这条资料属于哪位学生？',
  questionHint:'结合原文确认本次沟通对应的学生。确认后会保存这次关联，以后可以直接使用。',
  choose:'选择学生',search:'按学生姓名或电话查找',searchAction:'查找',confirm:'确认并继续',later:'暂时保留',
  loading:'正在读取来源资料…',failed:'暂时无法读取这条资料，请重试。',
  conflict:'这条资料的归属刚有更新，请重新打开查看最新关联。',inUse:'这条资料已用于另一位学生的业务，请先查看已有记录再更正归属。',
  shared:'这是一份多人名册，原文会继续保留。此次操作请使用对应学生的个人记录。',
  unavailable:'这条资料保留现有关联，可以继续查阅原文。',associationRequired:'请先确认这条资料对应的学生，再用于此次沟通。',
  noStudents:'暂未找到对应学生，可以查找已有档案，或将这条资料保留到以后再用。',
  pending:'使用时确认归属',linked:'已关联此学生',sourceContext:'本次沟通参考资料',sourceSaved:'查看本次沟通的来源资料',
  empty:'目前没有关联到这位学生的来源资料。',previous:'上一页',next:'下一页',unknown:'未记录',
};

export function sourceFollowupHref(studentId:string,recordId:string) {
  return `/dashboard/students/${studentId}?tab=followups&source=${encodeURIComponent(recordId)}`;
}
