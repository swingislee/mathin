import { normalizeSourceAssessmentBand, normalizeSourceBoolean, normalizeSourceContact, sourceScore } from './business-source-contract.ts';

const emptyContact = /^(?:无|暂无结果|暂无|待补|待联系|待沟通|待确认|未联系|未沟通|不详|未知|[-—/？?])+$/u;
const failedContact = /(?:未|没|不)接(?:通|听|电话|手机)?(?!受|触)|无人接(?:通|听)?|未通|空号|停机|关机|号码无效|无效号码|忙线|占线|拒接|打不通|无法接通|联系不上|未接触家长|挂断|挂掉|秒挂|直接挂(?:断|掉|了|电话)?|无人说话|不说话|没有声音|无人应答|(?:正在)?通话中|呼叫受限|暂停服务|拦截(?:号码|电话)/gu;
const response = /(?:家长|妈妈|爸爸|父母|对方|奶奶|爷爷|老爷子).{0,6}(?:表示|说|回复|反馈|觉得|希望|想|考虑|同意|答应|拒绝|不清楚|不知道)|(?:直接说|直接拒绝)|(?:想|希望|愿意|同意|答应).{0,12}(?:体验|来|测评|报名|了解|上课)|(?:没时间|没有时间|时间不合适|太远|太贵|费用.{0,4}(?:顾虑|贵)|下班后.{0,4}(?:联系|再打))|(?:已沟通|沟通了|已联系|领取了|已领取)|(?:在忙|在上班|开会|有事).{0,8}(?:挂|联系)|换时间联系|资料.{0,5}(?:没写|没有写|没练习)|看小朋友意愿|已经在上.{0,8}有需要/u;
const directResponse = text => sourceWechatEvidence(text) === 'yes' || Boolean(sourceInterestEvidence(text)) || response.test(text);

/** 只有联络失败与其修饰语时才确定为未成功联系；夹杂家庭信息的记录保留复核。 */
export function sourceNoteIsFailureOnly(value) {
  const text=value.trim();
  if (text.search(failedContact)<0 || directResponse(text)) return false;
  return !text.replace(/(?:\d{2,4}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?/gu,'')
    .replace(failedContact,'')
    .replace(/话还没说完|一听|叹口气|响一声|重复|态度巨差|态度差|脾气暴躁|上来一顿输出|啥都不说|稍后再打|下次再打|再打|待联系|不方便接听/gu,'')
    .replace(/家长|妈妈|爸爸|奶奶|爷爷|接通|接听|接电话|电话|手机|拨打|联系|直接|然后|那边|今天|昨天|明天|多次|一直|再次|还是|第[一二三四五六七八九十\d]+次|在|后|就|了|又|都|均/gu,'')
    .replace(/[\s\d\p{P}]/gu,'');
}

/** 明确拒绝课程需求可作为低意向证据；联络方式、资料需求和反问保留原意。 */
function clauseInterest(value) {
  const text = value.trim();
  if (/(?:是否|有没有|有无).{0,4}(?:意向|需求)|(?:意向|不需要|不考虑).{0,2}[吗么？?]|(?:没(?:有)?(?:说|表示|提到)|如果).{0,5}(?:不需要|不考虑|没需求)/u.test(text)) return null;
  const explicit = text.match(/(?:意向(?:分类|等级)?)\s*[:：为是]?\s*([ABC])(?:类|级)?(?![A-Za-z])/u);
  if (explicit) return explicit[1];
  if (/(?:意向(?:非常|很|比较|较)?(?:高|强烈|强)|(?:非常|很)有意向)/u.test(text) && !/(?:没|不|无).{0,2}(?:意向|兴趣)/u.test(text)) return 'A';
  if (/意向(?:一般|中等|不高不低)/u.test(text)) return 'B';
  // 拒绝资料、微信或另一科目，不等同于拒绝本课程。
  const low = /(?:不需要|没有需求|没需求|暂无需求|不感兴趣|没有兴趣|没兴趣|不考虑|没有意向|没意向|无意向|意向(?:很|较)?低)(?:了|课程|课外班|培训|补习|辅导|报名|测评|活动|数学|思维)?(?=$|[，,。；;！!\s]|下次|以后|后面|暑假|寒假|秋季|直接挂|挂断)/u;
  if (low.test(text)) return 'C';
  if (!/(?:未|没(?:有)?|不|如果|是否).{0,7}(?:意向|有兴趣)/u.test(text)
    && /有(?:报名|报班|秋季|春季|暑假|寒假)?意向|意向(?:报名|报班|报入)|(?:家长|妈妈|爸爸).{0,4}有兴趣/u.test(text)) return 'interested';
  return null;
}

export function sourceInterestEvidence(value) {
  const values=[...new Set(value.split(/[，,。；;\n]/u).map(clauseInterest).filter(Boolean))];
  if (values.includes('interested') && values.some(v=>v==='A'||v==='B')) values.splice(values.indexOf('interested'),1);
  return values.length>1?'conflicting':values[0]??null;
}

/** 通话备注中的“加V”是已发生结果；计划、申请中和未通过仍保留各自含义。 */
export function sourceWechatEvidence(value) {
  const text = value.trim().normalize('NFKC');
  const parts = text.split(/[，,。；;\n]/u).filter(Boolean);
  const states = parts.map(part => {
    const target = '(?:家长|妈妈|爸爸|父母|老师|学服)?(?:的)?(?:微信|[Vv微])';
    const negative = new RegExp(`(?:未|没(?:有)?|尚未|不愿|拒绝|不想)(?:能|成功)?加(?:上|到|了)?${target}|加不[上到](?:${target})?|(?:微信|加[Vv微]).{0,6}(?:没(?:有)?|未)通过|微信.{0,8}(?:查找不到|搜不到|搜索不到)|(?:微信.{0,4}(?:拉黑|删除)|(?:拉黑|删除).{0,4}微信)`, 'u').test(part);
    const pending = /(?:准备|计划|打算|想|希望|可以|尝试|试着|待|需要|让|要求|明天|以后|下次|再).{0,6}(?:加|\+)(?:妈妈|爸爸|家长)?(?:微信|[Vv微])|(?:加|\+)(?:微信|[Vv微]).{0,6}(?:试试|申请|待通过|等通过)|(?:已发|发送).{0,5}(?:微信|好友)申请/u.test(part);
    const question = /(?:是否|有没有|为什么).{0,5}(?:加|微信|\+)|(?:加|\+)(?:了|上)?(?:微信|[Vv微]).{0,3}[吗么？?]/u.test(part);
    const positive = new RegExp(`(?:已(?:经)?加(?:上|好|了)?|互加(?:了)?)${target}|微信(?:已)?通过|微信(?:已经|已)加|(?:通过|在)微信(?:上)?(?:沟通|联系|交流)|有(?:我们|咱们)?(?:老师|学服)(?:的)?微信|(?:^|[：:\\s])(?:加(?:了|上|好)?${target}|\\+[Vv])`, 'u').test(part);
    return question ? 'review' : negative ? 'no' : positive && !pending ? 'yes' : /微信|加[Vv微]|\+[Vv]/u.test(part) ? 'review' : null;
  }).filter(Boolean);
  const definite = [...new Set(states.filter(s => s !== 'review'))];
  if (definite.length > 1) return 'conflicting';
  return definite[0] ?? (states.length ? 'review' : null);
}

/** 只有失败电话的备注仍属待首联；日期、人员和标点不构成一次成功沟通。 */
export function sourceNoteIsEffective(value) {
  const text = value.trim();
  if (!text || emptyContact.test(text)) return false;
  if (directResponse(text)) return true;
  if (/^(?:\d+[.、])?(?:(?:接通|接听|接电话)(?:后|就)?|妈妈|爸爸)?(?:不说话|直接挂(?:了|电话)?|没有声音|通话中|正在通话中)$/u.test(text)) return false;
  const remainder = text.replace(/(?:\d{2,4}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?/gu, '')
    .replace(failedContact, '')
    .replace(/稍后再打|下次再打|再联系|再打|待回访|待联系|待沟通|暂未联系|尚未联系|未联系|未沟通|暂无结果|待确认|微信申请已发|等待通过|待通过/gu, '')
    .replace(/(?:第[一二三四五六七八九十\d]+次|多次|一直|再次|电话|拨打|联系|接通|呼叫|回访|家长|妈妈|爸爸|奶奶|爷爷|直接|均|仍|都|又|了|暂时|今天|昨天|明天|目前|截至|上午|下午|晚上|跟|给|与|向|和|对)/gu, '')
    .replace(/[\s\d，,。.;；:：、\/\-—()（）]+/gu, '');
  if (!remainder) return false;
  if (text.search(failedContact) >= 0 && (remainder.length < 18 || /^(?:话还没说完|一听|一声|响一声|后那边|那边|然后|就|后|听|很吵|态度|脾气|上来)/u.test(remainder))) return false;
  if (/微信.{0,4}(?:未|没)通过|(?:准备|计划|下次|明天).{0,5}加(?:微信|[Vv微])/u.test(text) && remainder.length < 18) return false;
  // 无失败标记的实质沟通备注仍可沿用；纯日期、经手人与待办不算回应。
  return !/^(?:待联系|需联系|计划联系|准备联系|稍后再打|后续跟进|下次再打|尝试联系|尚未联系|未接触家长)$/u.test(remainder)
    && !/^(?:已|未)?加[Vv微]与群$/u.test(remainder);
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
  const resultText = read(resultField).trim();
  if (!result.outcome && /^(?:空号|号码无效|无效号码)$/u.test(resultText)) result.outcome='invalid_number';
  else if (!result.outcome && sourceNoteIsFailureOnly(resultText)) result.outcome='unreachable';
  else if (!result.outcome && sourceWechatEvidence(resultText)==='yes') result.outcome='connected';
  else if (!result.outcome && sourceInterestEvidence(resultText)==='C') result.outcome='declined';
  const noteText = read(noteField).trim();
  const note = sourceNoteIsEffective(noteText);
  const negative = ['unreachable', 'invalid_number'].includes(result.outcome ?? '')
    || /未通|未接通|未接听|无人接听|空号|停机|无效号码|号码无效/u.test(read(resultField));
  const project = phase === 'project' && /^(?:是|已|已沟通)$/u.test(read(resultField).trim());
  const inferred = note && (!negative || directResponse(noteText)) || project;
  const failedNote = !note && sourceNoteIsFailureOnly(noteText);
  const invalidNote = !note && /空号|号码无效|无效号码/u.test(noteText);
  const outcome = inferred ? (sourceInterestEvidence(noteText) === 'C' ? 'declined' : result.outcome === 'declined' ? 'declined' : 'connected')
    : result.outcome ?? (invalidNote ? 'invalid_number' : failedNote ? 'unreachable' : null);
  const effective = outcome === 'connected' || outcome === 'declined';
  const attempted = Boolean(result.outcome || project || noteText && !emptyContact.test(noteText));
  const explicitReachedWithFailure = ['connected','declined'].includes(result.outcome??'') && sourceNoteIsFailureOnly(noteText);
  const review = negative && note && !directResponse(noteText)
    || explicitReachedWithFailure || attempted && !inferred && !result.outcome && !failedNote && !invalidNote;
  return { outcome, effective, attempted,
    evidence: [result.outcome && effective && !negative ? resultField : '', note ? noteField : '', project ? resultField : ''].filter(Boolean),
    conflicting: negative && note || explicitReachedWithFailure, review };
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
