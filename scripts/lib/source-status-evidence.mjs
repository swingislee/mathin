import { normalizeSourceAssessmentBand, normalizeSourceBoolean } from '../../src/features/school/business-source-contract.ts';
import { sourceInterestEvidence, sourceWechatEvidence } from '../../src/features/school/source-lifecycle-evidence.mjs';

const normalizeName = name => name.replace(/^A:\s*/, '').trim();
const monthDate = text => {
  const match = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (!match) return null;
  const value = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value ? value : null;
};
const words = text => text.split(/[、,，;；\n]/u).map(part => part.trim()).filter(Boolean);
const future = /(?:尚未|还未|未曾|从未|未|没有|还没(?:有)?|没)(?:做|参加|完成|进行)?(?:过|了)?测评|(?:准备|计划|打算|预约|邀约|约好|再约|在约|想|希望|如果|估计|可能|可以|明天|下周|以后|待).{0,12}(?:测评|测过|加.{0,4}[Vv微])/u;
const externalAssessment = /(?:方田|学而思|新东方|高思|其他机构|别的机构|外面|外校).{0,12}测评|测评.{0,8}(?:方田|学而思|新东方|其他机构)/u;

/** Preserve explicit source facts and their wording; plans and ambiguous shorthand stay reviewable. */
export function extractSourceStatusEvidence(source) {
  const cells = source.record_data?.cells ?? source.cells ?? [];
  const read = name => cells.find(cell => normalizeName(cell.fieldName) === name)?.text?.trim() ?? '';
  const facts = [];
  const add = (type, value, field, excerpt, priority = 80, certainty = 'confirmed') => {
    if (value == null || !excerpt.trim()) return;
    facts.push({ type, value: String(value), field, excerpt: excerpt.trim().slice(0, 500), priority, certainty,
      date: monthDate(read(field.startsWith('跟进') ? '跟进日期' : field.startsWith('确认') ? '确认日期' : '到访日期')) });
  };
  const wechat = normalizeSourceBoolean(read('用户当下加V与否'), ['是','已','已加V','加V','已加'], ['否','未','未加V','未加']);
  if (wechat !== null) add('wechat',wechat ? 'yes' : 'no','用户当下加V与否',read('用户当下加V与否'),120);
  for (const field of ['获客加V情况','确认结果','跟进结果']) {
    const parts = words(read(field));
    if (parts.some(part => /^(?:已加V|加V|已加微信|已加微|已加)$/iu.test(part))) add('wechat','yes',field,read(field),90);
    if (parts.some(part => /^(?:未加V|未加微信|未加微|未加|加不上)$/iu.test(part))) add('wechat','no',field,read(field),90);
    if (parts.some(part => /^(?:已沟通|已联系|加V|诺访|暂缓|下次联系|下期次再联系)$/u.test(part))) add('contact','reached',field,read(field),90);
    if (parts.includes('诺访')) add('visit','promised',field,read(field),90);
    const interest = sourceInterestEvidence(read(field));
    if (interest) add('interest',interest,field,read(field),90);
  }
  if (/^(?:是|已|诺访|已诺访)$/u.test(read('诺访与否'))) add('visit','promised','诺访与否',read('诺访与否'),110);
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
    if (!/备注|情况|信息|沟通|反馈|观察|总结/u.test(field) || /加V情况/u.test(field)) continue;
    for (const clause of (cell.text ?? '').split(/[。；;\n]/u).map(text => text.trim()).filter(Boolean)) {
      const wechat = sourceWechatEvidence(clause);
      if (wechat) add('wechat',wechat === 'review' ? 'unspecified' : wechat,field,clause,wechat === 'review' ? 20 : 60,
        wechat === 'review' || wechat === 'conflicting' ? 'review' : 'confirmed');
      const completed = /已(?:经)?(?:做|完成|参加)?(?:过|了)?测评|测评(?:已经)?(?:完毕|完成|结束|过)|做过测评|测过评|只测评未随堂|(?:暑假|之前|年前|上次).{0,10}测评后|测评后直接报名/u.test(clause);
      const bandMatch = clause.match(/(?:思维测评|测评(?:结果|等级)?|思维等级|学习力(?:测评)?(?:等级)?)\s*[:：为是]?\s*(未达A|[XG][+＋]|A[+＋]?|S|C)(?![A-Za-z+＋−-])/u);
      if ((completed || bandMatch) && !future.test(clause)) {
        const certainty = externalAssessment.test(clause) || /(?:测评过|测评结束|做过测评)[吗么？?]|(?:是否|有没有).{0,6}测评/u.test(clause) ? 'review' : 'confirmed';
        add('assessment','complete',field,clause,60,certainty);
        if (bandMatch) add(/学习力/u.test(bandMatch[0]) ? 'learning_band' : 'assessment_band',normalizeSourceAssessmentBand(bandMatch[1]),field,clause,60,certainty);
      }
      else if (/测评后|测评\s*[A-Z][−-]/u.test(clause) && !future.test(clause)) add('assessment','unspecified',field,clause,20,'review');
      if (/(?:已(?:经)?|今天)(?:到访|到店)|来过(?:校区|我们)/u.test(clause) && !future.test(clause)) add('visit','arrived',field,clause,60);
      const interest = clause.match(/(?:意向(?:分类)?|意向等级)\s*[:：为是]?\s*([ABC])(?:类|级)?/u);
      if (interest) add('interest',interest[1],field,clause,60);
      else {
        const inferredInterest = sourceInterestEvidence(clause);
        if (inferredInterest) add('interest',inferredInterest,field,clause,60);
      }
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
