import { normalizeSourceAssessmentBand, normalizeSourceBoolean } from '../../src/features/school/business-source-contract.ts';
import { sourceContactEvidence, sourceInterestEvidence, sourceWechatEvidence } from '../../src/features/school/source-lifecycle-evidence.mjs';

const normalizeName = name => name.replace(/^A:\s*/, '').trim();
const fullDate = text => {
  const match = text.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/u);
  if (!match) return null;
  const value = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value ? value : null;
};
const phaseFor = field => /^跟进/u.test(field) ? 'followup' : /^确认/u.test(field) ? 'confirmation'
  : /^获客/u.test(field) ? 'acquisition' : /当下|意向分类/u.test(field) ? 'current'
  : /^沟通|真题拼团/u.test(field) ? 'project' : 'visit';
const noteField = /备注|情况|信息|沟通|反馈|观察|总结|说明|关注|期待|初步/u;
const nonPersonalField = /人员|日期|月份|周次|组别|目标|文案|产出|姓名|电话|联系方式/u;
const futureAssessment = /(?:尚未|还未|未曾|从未|未|没有|还没(?:有)?|没)(?:做|参加|完成|进行)?(?:过|了)?测评|(?:准备|计划|打算|预约|邀约|约好|再约|在约|想|希望|如果|估计|可能|可以|明天|下周|以后|待).{0,12}(?:测评|测过)/u;
const otherAssessment = /(?:方田|学而思|新东方|高思|其他机构|别的机构|外面|外校|哥哥|姐姐|弟弟|妹妹|大宝|二宝).{0,15}(?:测评|测过)|测评.{0,8}(?:方田|学而思|新东方|其他机构)/u;
const question = /(?:是否|有没有|有无).{0,8}(?:测评|到访|报名|意向)|(?:测评|到访|报名|意向).{0,4}[吗么？?]/u;

/** 只提取原文支持的事实；报名意愿、待缴费与正式报名分别保存。 */
export function extractSourceStatusEvidence(source) {
  const data = source.record_data ?? source;
  const cells = data.cells ?? [];
  const read = name => cells.find(cell => normalizeName(cell.fieldName) === name)?.text?.trim() ?? '';
  const logicalKey = data.tableId && data.sourceRecordId ? `${data.tableId}:${data.sourceRecordId}` : source.id ?? null;
  const facts = [];
  const add = (type, value, field, excerpt, priority = 80, certainty = 'confirmed', extra = {}) => {
    if (value == null || !excerpt.trim()) return;
    const phase = phaseFor(field);
    const dateField = phase === 'followup' ? '跟进日期' : phase === 'confirmation' ? '确认日期'
      : phase === 'acquisition' ? '获取日期' : phase === 'project' ? '沟通日期' : phase === 'current' ? null : '到访日期';
    const dateLabel = dateField ? read(dateField) : '';
    facts.push({ type, value: String(value), field, excerpt: excerpt.trim().slice(0, 500), priority, certainty,
      date: fullDate(excerpt) ?? fullDate(dateLabel), dateLabel: dateLabel || null, phase, logicalKey, version: 2, ...extra });
  };
  const wechat = normalizeSourceBoolean(read('用户当下加V与否'), ['是','已','已加V','加V','已加'], ['否','未','未加V','未加']);
  if (wechat !== null) add('wechat',wechat ? 'yes' : 'no','用户当下加V与否',read('用户当下加V与否'),120);
  const explicitWechatFields = ['获客加V情况','确认结果','跟进结果','加V与否（学服）','加V与否（老师）'];
  for (const field of explicitWechatFields) {
    const text = read(field), result = sourceWechatEvidence(text);
    const boolean = /^加V与否/u.test(field) ? normalizeSourceBoolean(text,['是','已','已加'],['否','未','未加']) : null;
    if (boolean !== null) add('wechat',boolean ? 'yes' : 'no',field,text,90);
    else if (result) add('wechat',result === 'review' ? 'unspecified' : result,field,text,90,
      ['review','conflicting'].includes(result) ? 'review' : 'confirmed');
    if (/诺访/u.test(text) && !/未诺访|不诺访/u.test(text)) add('visit','promised',field,text,90);
    const interest = sourceInterestEvidence(text);
    if (interest) add('interest',interest,field,text,90,interest==='conflicting'?'review':'confirmed');
  }
  for (const [phase,field] of [['confirmation','确认信息备注'],['followup','跟进信息'],['project','沟通情况']]) {
    const evidence = sourceContactEvidence(read,phase), resultField = phase === 'confirmation' ? '确认结果' : phase === 'followup' ? '跟进结果' : '真题拼团沟通';
    if (evidence.attempted) add('contact',evidence.effective ? 'reached' : evidence.outcome === 'invalid_number' ? 'invalid_number' : 'unreached',field,
      read(field) || read(resultField),60,evidence.outcome && !evidence.review ? 'confirmed' : 'review');
    if (evidence.conflicting) add('contact_conflict','result_and_note',field,[read(resultField),read(field)].filter(Boolean).join('；'),20,'review');
  }
  if (/^(?:是|已|诺访|已诺访)$/u.test(read('诺访与否'))) add('visit','promised','诺访与否',read('诺访与否'),110);
  if (/^(?:否|未|未诺访)$/u.test(read('诺访与否'))) add('visit','not_promised','诺访与否',read('诺访与否'),110);
  if (/^(?:已到|是|已到访)$/u.test(read('到访与否'))) add('visit','arrived','到访与否',read('到访与否'),120);
  if (/^[ABC]$/u.test(read('意向分类'))) add('interest',read('意向分类'),'意向分类',read('意向分类'),120);
  for (const [field,type] of [['思维测评等级','assessment_band'],['学习力测评等级','learning_band']]) {
    const raw = read(field), band = normalizeSourceAssessmentBand(raw);
    if (band) { add(type,band,field,raw,120); add('assessment','complete',field,raw,120); }
    else if (raw && !/^(?:无|暂无|未测|待测|未知|不详|[-—/])$/u.test(raw)) add(type,raw,field,raw,40,'review');
  }
  const score = read('测评成绩（分数）');
  if (/^\d+(?:\.\d+)?\s*(?:分)?(?:\s*[/／]\s*\d+(?:\.\d+)?\s*分?)?$/u.test(score)) {
    add('assessment','complete','测评成绩（分数）',score,120); add('assessment_score',score,'测评成绩（分数）',score,120);
  }
  for (const cell of cells) {
    const field = normalizeName(cell.fieldName);
    if (!noteField.test(field) || nonPersonalField.test(field) || explicitWechatFields.includes(field)) continue;
    const clauses = (cell.text ?? '').split(/[。；;\n]/u).map(text => text.trim()).filter(Boolean);
    for (const [ordinal,clause] of clauses.entries()) {
      const fact = (type,value,certainty = 'confirmed') => add(type,value,field,clause,60,
        /progress|concern/u.test(type)&&/猜测|估计|可能|应该|不确定/u.test(clause)?'review':certainty,{ordinal});
      const wechat = sourceWechatEvidence(clause);
      if (wechat) fact('wechat',wechat === 'review' ? 'unspecified' : wechat,['review','conflicting'].includes(wechat) ? 'review' : 'confirmed');
      const interest = sourceInterestEvidence(clause);
      if (interest) fact('interest',interest,interest==='conflicting'?'review':'confirmed');
      const completed = /已(?:经)?(?:做|完成|参加)?(?:过|了)?测评|测评(?:已经)?(?:完毕|完成|结束|过)|做过测评|测过评|只测评未随堂|(?:暑假|之前|年前|上次).{0,10}测评后|测评后直接报名/u.test(clause);
      const bandMatch = clause.match(/(?:思维测评|测评(?:结果|等级)?|思维等级|学习力(?:测评)?(?:等级)?)\s*[:：为是]?\s*(未达A|[XG][+＋]|A[+＋]?|S|C)(?![A-Za-z+＋−-])/u);
      if ((completed || bandMatch) && !futureAssessment.test(clause)) {
        const certainty = otherAssessment.test(clause) || question.test(clause) ? 'review' : 'confirmed';
        fact('assessment','complete',certainty);
        if (bandMatch) fact(/学习力/u.test(bandMatch[0]) ? 'learning_band' : 'assessment_band',normalizeSourceAssessmentBand(bandMatch[1]),certainty);
      } else if (/测评后|测评\s*[A-Z][−-]/u.test(clause) && !futureAssessment.test(clause)) fact('assessment','unspecified','review');
      if (question.test(clause)) continue;
      if (/(?:已(?:经)?|今天)(?:到访|到店)|来过(?:校区|我们)/u.test(clause)
        && !/(?:未|没|不|如果|计划|准备|明天).{0,5}(?:到访|到店|来过)/u.test(clause)) fact('visit','arrived');
      if (/(?:再|重新|改期|下次).{0,5}(?:约|联系|沟通)|时间.{0,4}(?:协调|再定|未定)|协调.{0,4}时间/u.test(clause)) fact('invitation_progress','coordinating');
      if (/(?:等|待).{0,4}(?:家长|妈妈|爸爸).{0,5}(?:回复|确认)|家长.{0,4}(?:未回复|未确认)/u.test(clause)) fact('invitation_progress','awaiting_parent');
      if (/(?:等|待).{0,4}老师.{0,5}确认/u.test(clause)) fact('invitation_progress','awaiting_teacher');
      if (/(?:已约|约好|确定|答应|同意).{0,12}(?:到访|来|测评|体验)/u.test(clause)
        && !/(?:没|未|不|如果|待).{0,3}(?:约好|确定|答应|同意)/u.test(clause)) fact('invitation_progress','booked');
      if (/下班后.{0,5}(?:联系|再打)|(?:让|说).{0,8}(?:晚点|稍后|明天|下次).{0,5}(?:联系|再打)/u.test(clause)) fact('followup_progress','callback_requested');
      if (/(?:暑假|寒假|秋季|春季|下学期|开学|以后|后面).{0,5}(?:再联系|再沟通|再考虑)|暂缓|下期次再联系/u.test(clause)) fact('followup_progress','deferred');
      if (/(?:再|还在|正在|需要|回去|回家).{0,4}(?:考虑|商量)|考虑一下|考虑中|商量一下/u.test(clause)) fact('enrollment_progress','considering');
      if (/(?:确定|决定|同意|准备).{0,5}(?:报名|报班)/u.test(clause)
        && !/(?:未|没|不|还没).{0,3}(?:确定|决定|同意|准备)|(?:外面|其他机构|方田|学而思).{0,8}(?:报名|报班)/u.test(clause)) fact('enrollment_progress','ready_to_enroll');
      if (/(?:待|等|尚未|还未|还没|未)(?:交费|缴费|付款)|(?:已发|发了).{0,5}(?:收款码|付款码)/u.test(clause)) fact('enrollment_progress','payment_pending');
      if (/(?:不报|不续报|不报名|不报班|放弃报名)/u.test(clause)) fact('enrollment_progress','not_enrolling');
      if (/(?:已经|已)(?:报名|报班|缴费|交费)|交了(?:学费|定金)/u.test(clause)) fact('enrollment_report','reported','review');
      if (/太贵|贵了|价格.{0,4}(?:高|贵)|费用.{0,4}(?:高|贵|顾虑)|经济.{0,4}(?:压力|原因)|负担不起/u.test(clause)
        && !/不(?:是|觉得|认为|算|太).{0,5}(?:贵|费用)|不是.{0,5}(?:价格|费用)/u.test(clause)) fact('concern','cost');
      if (/太远|距离.{0,4}(?:远|问题)|接送.{0,4}(?:困难|不便|问题|不方便)/u.test(clause)) fact('concern','distance');
      if (/没时间|没有时间|时间.{0,4}(?:不合适|冲突|不方便|排不开)|课太多/u.test(clause)) fact('concern','schedule');
      if (/孩子.{0,5}(?:不愿意|不想|抵触)|(?:需要|回去|回家).{0,5}(?:商量|问爸爸|问妈妈)/u.test(clause)) fact('concern','family_decision');
      if (/(?:在|报了|已报).{0,5}(?:方田|学而思|新东方|高思)|(?:其他机构|别的机构|外面).{0,5}(?:已报|报了|上课|学习)/u.test(clause)) fact('concern','other_provider');
    }
  }
  return facts.filter((fact,index) => facts.findIndex(other => other.type===fact.type && other.value===fact.value && other.field===fact.field && other.excerpt===fact.excerpt) === index);
}

/** Refresh after history_import_records are written; payload matching prevents stale evidence. */
export function buildSourceStatusEvidenceRows(records) {
  return records.filter(record => record.source_data?.format === 'feishu-base').map(record => ({
    source_record_id: record.id, payload_sha256: record.payload_sha256, facts: extractSourceStatusEvidence(record),
  }));
}
