export type BusinessRecordState = 'current' | 'historical';
export type BusinessRecordStateFilter = BusinessRecordState | 'all';
export function isCurrentBusinessRecord(state: BusinessRecordState | undefined) {
  return (state ?? 'current') === 'current';
}
export function businessRecordStateFilter(value: unknown): BusinessRecordStateFilter {
  return value==='current'||value==='historical'?value:'all';
}
export function matchesBusinessRecordState(state: BusinessRecordState | undefined, filter: BusinessRecordStateFilter) {
  return filter==='all'||(state??'current')===filter;
}
export function businessRecordMessages(locale: string) {
  return locale==='zh'?{
    state:'记录状态',all:'全部状态',current:'当前',historical:'历史',unknown:'资料未记录',
    firstContactMissing:'首联记录缺失',firstContactHint:'已有历史测评、报名或续费事实；原资料未提供首次联系记录。',
    viewStudent:'查看学生档案',outcomeUnknown:'最终结果未记录',dateUnknown:'日期未记录',period:'学期',registeredOn:'报名日期',
    recordedOnly:'历史事实',historicalFeedback:'历史反馈',historyCount:'历史记录',search:'搜索学生、活动或记录',
  }:{
    state:'Record state',all:'All states',current:'Current',historical:'Historical',unknown:'Not recorded',
    firstContactMissing:'First contact record missing',firstContactHint:'Historical assessment, enrollment or renewal facts exist; the original first contact record is missing.',
    viewStudent:'Student profile',outcomeUnknown:'Final outcome not recorded',dateUnknown:'Date not recorded',period:'Term',registeredOn:'Registered on',
    recordedOnly:'Historical fact',historicalFeedback:'Historical feedback',historyCount:'Historical records',search:'Search student, activity or record',
  };
}
