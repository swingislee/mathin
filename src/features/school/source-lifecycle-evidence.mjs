import { normalizeSourceAssessmentBand, normalizeSourceBoolean, normalizeSourceContact, sourceScore } from './business-source-contract.ts';

const emptyContact = /^(?:无|暂无结果|暂无|待补|待联系|待沟通|待确认|未联系|未沟通|不详|未知|[-—/？?])+$/u;
const failedContact = /未接通|未接听|无人接听|无人接|未通|没接通|没接|不接|未接|空号|停机|关机|号码无效|无效号码|忙线|占线|拒接|打不通|无法接通|挂断|挂掉|秒挂|无人说话|无人应答/gu;

/** 明确拒绝课程需求可作为低意向证据；联络方式、资料需求和反问保留原意。 */
export function sourceInterestEvidence(value) {
  return /(?:^|[，,。；;：:\s]|但是|不过|但)(?:(?:家长|妈妈|爸爸|父母|对方)(?:明确)?(?:表示|说|回复|反馈|觉得)?[：:]?)?(?:目前|现在|暂时|暂|明确)?(?:不需要|没有需求|没需求|暂无需求|不感兴趣|没有兴趣|没兴趣|不考虑|没有意向|没意向|无意向|意向(?:较)?低)(?:了|课程|课外班|培训|补习|辅导|报名|测评|活动)?(?:$|[，,。；;！!])/u.test(value.trim()) ? 'C' : null;
}

/** 通话备注中的“加V”是已发生结果；计划、申请中和未通过仍保留各自含义。 */
export function sourceWechatEvidence(value) {
  const text = value.trim();
  const notAccepted = /(?:微信|加[微Vv]).{0,6}(?:没(?:有)?|未)通过/u.test(text);
  const negative = notAccepted || /(?:未|没(?:有)?|尚未|不愿|拒绝)(?:能|成功)?加(?:上|到|了)?(?:家长|妈妈|爸爸)?(?:微信|[Vv微])|加不[上到](?:微信|[Vv微])|(?:微信.{0,4}(?:拉黑|删除)|(?:拉黑|删除).{0,4}微信)/u.test(text);
  const pending = /(?:准备|计划|打算|想|希望|可以|尝试|试着|待|需要|让|要求).{0,6}加(?:微信|[Vv微])|加(?:微信|[Vv微]).{0,6}(?:试试|申请|待通过|等通过)|(?:已发|发送).{0,5}(?:微信|好友)申请/u.test(text);
  const question = /加(?:了|上)?(?:微信|[Vv微]).{0,3}[吗么？?]/u.test(text);
  const positive = /(?:已(?:经)?加(?:上|好|了)?|互加(?:了)?)(?:家长|妈妈|爸爸)?(?:微信|[Vv微])|微信(?:已)?通过|(?:通过|在)微信(?:上)?(?:沟通|联系|交流)|(?:^|[，,。；;\n])\s*加(?:了|上|好)?(?:微信|[Vv微])(?:了|成功)?(?=[\s，,。；;:：!！]|$)/u.test(text);
  if (negative) return positive && !notAccepted && !pending && !question ? 'conflicting' : 'no';
  if (positive && !pending && !question) return 'yes';
  return /加.{0,4}(?:微信|[Vv微])/u.test(text) ? 'review' : null;
}

/** 只有失败电话的备注仍属待首联；日期、人员和标点不构成一次成功沟通。 */
export function sourceNoteIsEffective(value) {
  const text = value.trim();
  if (!text || emptyContact.test(text)) return false;
  const remainder = text.replace(/(?:\d{2,4}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?/gu, '')
    .replace(failedContact, '')
    .replace(/稍后再打|下次再打|再联系|再打|待回访|待联系|待沟通|暂未联系|尚未联系|未联系|未沟通|暂无结果|待确认|微信申请已发|等待通过|待通过/gu, '')
    .replace(/(?:第[一二三四五六七八九十\d]+次|多次|一直|再次|电话|拨打|联系|呼叫|回访|家长|妈妈|爸爸|奶奶|爷爷|直接|均|仍|都|又|了|暂时|今天|昨天|明天|目前|截至|上午|下午|晚上|跟|给|与|向|和|对)/gu, '')
    .replace(/[\s\d，,。.;；:：、\/\-—()（）]+/gu, '');
  return remainder.length > 0;
}

export function sourceContactFlags(read) {
  return {
    wechatAdded: normalizeSourceBoolean(read('用户当下加V与否'), ['是', '已', '已加V', '加V', '已加'], ['否', '未', '未加V', '未加']),
    visitCommitted: normalizeSourceBoolean(read('诺访与否'), ['是', '已', '诺访', '已诺访'], ['否', '未', '未诺访']),
  };
}

/** 首次确认、后续跟进、项目沟通各自保留结果；月份与经手人不是成功联系证据。 */
export function sourceContactEvidence(read, phase) {
  const resultField = phase === 'confirmation' ? '确认结果' : phase === 'followup' ? '跟进结果' : '真题拼团沟通';
  const noteField = phase === 'confirmation' ? '确认信息备注' : phase === 'followup' ? '跟进信息' : '沟通情况';
  const result = normalizeSourceContact(read(resultField));
  const noteText = read(noteField).trim();
  const note = sourceNoteIsEffective(noteText);
  const negative = ['unreachable', 'invalid_number'].includes(result.outcome ?? '')
    || /未通|未接通|未接听|无人接听|空号|停机|无效号码|号码无效/u.test(read(resultField));
  const project = phase === 'project' && /^(?:是|已|已沟通)$/u.test(read(resultField).trim());
  const inferred = !negative && (note || project);
  const failedNote = !note && /未接通|未接听|无人接|未通|没接|不接|未接|忙线|占线|拒接|打不通|无法接通|停机|关机|挂断|挂掉|秒挂|无人说话|无人应答/u.test(noteText);
  const invalidNote = !note && /空号|号码无效|无效号码/u.test(noteText);
  const outcome = result.outcome ?? (inferred ? 'connected' : invalidNote ? 'invalid_number' : failedNote ? 'unreachable' : null);
  const effective = outcome === 'connected' || outcome === 'declined';
  const attempted = Boolean(result.outcome || project || noteText && !emptyContact.test(noteText));
  return { outcome, effective, attempted,
    evidence: [result.outcome && effective ? resultField : '', note && !negative ? noteField : '', project ? resultField : ''].filter(Boolean),
    conflicting: negative && note };
}

/** 列表只读沟通内容，原字段、经手人和占位结果留在来源记录中。 */
export function sourceContactSummary(read, phase) {
  const noteField = phase === 'confirmation' ? '确认信息备注' : phase === 'followup' ? '跟进信息' : '沟通情况';
  const resultField = phase === 'confirmation' ? '确认结果' : phase === 'followup' ? '跟进结果' : '真题拼团沟通';
  const values = [read(noteField).trim(), read(resultField).trim()].filter(value => value && !emptyContact.test(value));
  return [...new Set(values)].filter((value,index) => !values.some((other,otherIndex) => otherIndex < index && other.includes(value))).join('；');
}

export function sourceHasAssessmentResult(read) {
  return Boolean(normalizeSourceAssessmentBand(read('思维测评等级'))
    || normalizeSourceAssessmentBand(read('学习力测评等级'))
    || sourceScore(read('测评成绩（分数）')).score !== null);
}
