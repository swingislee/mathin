import { normalizeSourceAssessmentBand, normalizeSourceBoolean, normalizeSourceContact, sourceScore } from './business-source-contract.ts';

/** 只有失败电话的备注仍属待首联；日期、人员和标点不构成一次成功沟通。 */
export function sourceNoteIsEffective(value) {
  const text = value.trim();
  if (!text || /^(?:无|暂无|待补|待联系|待沟通|待确认|未联系|未沟通|不详|未知|[-—/？?])+$/u.test(text)) return false;
  const remainder = text.replace(/(?:\d{2,4}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?/gu, '')
    .replace(/(?:多次|一直|再次|电话|拨打|联系|呼叫|家长|妈妈|爸爸|均|仍|都|又|了|暂时|今天|昨天|明天|目前|截至|第[一二三四五六七八九十\d]+次)/gu, '')
    .replace(/未接通|未接听|无人接听|无人接|未通|没接|不接|未接|空号|停机|关机|号码无效|无效号码|忙线|占线|拒接|稍后再打|下次再打|再联系|再打/gu, '')
    .replace(/[\s\d，,。.;；:：、\/\-—()（）]+/gu, '');
  return remainder.length > 0;
}

export function sourceContactFlags(read) {
  return {
    wechatAdded: normalizeSourceBoolean(read('用户当下加V与否'), ['是', '已', '已加V', '加V', '已加'], ['否', '未', '未加V', '未加']),
    visitCommitted: normalizeSourceBoolean(read('诺访与否'), ['是', '已', '诺访', '已诺访'], ['否', '未', '未诺访']),
  };
}

/** 首次确认、后续跟进、项目沟通各自保留结果，跨阶段证据仅用于当前标签。 */
export function sourceContactEvidence(read, phase) {
  const resultField = phase === 'confirmation' ? '确认结果' : phase === 'followup' ? '跟进结果' : '真题拼团沟通';
  const noteField = phase === 'confirmation' ? '确认信息备注' : phase === 'followup' ? '跟进信息' : '沟通情况';
  const result = normalizeSourceContact(read(resultField));
  const note = sourceNoteIsEffective(read(noteField));
  const negative = ['unreachable', 'invalid_number'].includes(result.outcome ?? '')
    || /未通|未接通|未接听|无人接听|空号|停机|无效号码|号码无效/u.test(read(resultField));
  const context = phase === 'confirmation' && Boolean((read('确认月份') || read('确认日期')) && read('确认人员'));
  const project = phase === 'project' && /^(?:是|已|已沟通)$/u.test(read(resultField).trim());
  const onlyFailedNote = Boolean(read(noteField).trim()) && !note;
  const inferred = note || project || context && !negative && !onlyFailedNote;
  const effective = result.outcome === 'connected' || result.outcome === 'declined' || inferred;
  return { outcome: result.outcome ?? (inferred ? 'connected' : null), effective,
    evidence: [result.outcome && effective ? resultField : '', note ? noteField : '', project ? resultField : '',
      context && !negative && !onlyFailedNote ? '确认月份／确认日期＋确认人员' : ''].filter(Boolean),
    conflicting: negative && note };
}

export function sourceHasAssessmentResult(read) {
  return Boolean(normalizeSourceAssessmentBand(read('思维测评等级'))
    || normalizeSourceAssessmentBand(read('学习力测评等级'))
    || sourceScore(read('测评成绩（分数）')).score !== null);
}
