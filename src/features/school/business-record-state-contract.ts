export type BusinessRecordState = 'current' | 'historical';
export type BusinessRecordStateFilter = BusinessRecordState | 'all';
export function isCurrentBusinessRecord(state: BusinessRecordState | undefined) {
  return (state ?? 'current') === 'current';
}
export function businessRecordStateFilter(value:unknown):BusinessRecordStateFilter {
  const selected=Array.isArray(value)?value[0]:value;
  return selected==='historical'||selected==='all'?selected:'current';
}
export function matchesBusinessRecordState(state:BusinessRecordState|undefined,filter:BusinessRecordStateFilter):boolean {
  return filter==='all'||(state??'current')===filter;
}
export function businessRecordMessages(locale: string) {
  return locale==='zh'?{
    state:'工作范围',all:'全部记录',current:'当前工作',historical:'历史记录',unknown:'—',
    firstContactMissing:'待联系',firstContactHint:'查看已有记录并继续联系。',
    viewStudent:'查看学生档案',outcomeUnknown:'最终结果未记录',dateUnknown:'日期未记录',period:'学期',registeredOn:'报名日期',
    recordedOnly:'业务记录',historicalFeedback:'反馈与备注',historyCount:'记录',search:'搜索学生、活动或记录',
  }:{
    state:'Work scope',all:'All records',current:'Current work',historical:'History',unknown:'—',
    firstContactMissing:'To contact',firstContactHint:'Review the existing record and continue the conversation.',
    viewStudent:'Student profile',outcomeUnknown:'Final outcome not recorded',dateUnknown:'Date not recorded',period:'Term',registeredOn:'Registered on',
    recordedOnly:'Business record',historicalFeedback:'Feedback and notes',historyCount:'Records',search:'Search student, activity or record',
  };
}
