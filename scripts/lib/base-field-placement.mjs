// 产品负责人确认的错列内容按业务含义归位；原字段名、原文和原字段 ID 由来源合同保留。
const normalized = (value, display) => ({ value, display, status: 'normalized' });
const placed = (section, key, kind, label, value, display = value) => ({ section, key, kind, label, ...normalized(value, display) });
const nearbyPlaces = new Set(['中海广场', '方圆荟', '万年埠附近']);
const sourcePattern = /^金[子字]塔老生(秋季)?$/u;
const interestPattern = /^(?:《举一反三》(?:公开课|训练营)|数独|思维闯关|1对1测评分析|特别匹配问题)(?:[-、，].*)?$/u;
const addressPattern = /(?:停车场|停车点|停车|公园|销售店|(?:小区|公馆|广场|小学|附小|园|区)[^\n]*[-－](?:东|西|南|北)?门|[-－]\d+栋|新东方素质成长中心\(贵州路店\))/u;

function address(text) {
  return text === '水晶公馆' || addressPattern.test(text) || /^包河区.+(?:公馆|名庭|出入口|路侧)/u.test(text);
}
function source(text) {
  const match = sourcePattern.exec(text);
  return match ? placed('acquisition', 'channel', 'choice', '来源', { source: '金字塔老生', season: match[1] ? 'autumn' : null },
    `金字塔老生${match[1] ? '（秋季）' : ''}`) : null;
}
function interest(text) {
  if (!interestPattern.test(text)) return null;
  const values = [...new Set(text.split(/[-、，](?=《|数独|思维闯关|特别匹配问题)/u).map(value => value.trim()).filter(Boolean))];
  return placed('followup', 'interest_content', 'multi', '意向内容', values, values.join('、'));
}
function gradeProjection(grade) {
  return { section: 'identity', key: 'grade', kind: 'grade', label: '年级', ...grade };
}

export function resolveBaseFieldPlacement(definition, text, parseGrade) {
  const id = `${definition.section}.${definition.key}`;
  if (id === 'confirmation.occurred_on' || definition.kind === 'label') {
    const mention = /^@([^\s@()]+)(?:\s+\(https?:\/\/[^\s]+\))?$/u.exec(text);
    if (mention) {
      const target = id === 'confirmation.occurred_on' ? { section: 'confirmation', key: 'staff' } : definition;
      return placed(target.section, target.key, 'label', '历史职员', { name: mention[1], historical: true }, mention[1]);
    }
  }
  if (id === 'assessment.score' && ['随堂听', '随堂试听'].includes(text)) {
    return placed('visit', 'content', 'multi', '参与内容', ['随堂试听'], '随堂试听');
  }
  if (id === 'enrollment.term' && text === '特别匹配问题') return interest(text);
  if (definition.section !== 'identity' || !['school', 'grade', 'grade_2025', 'spring_grade'].includes(definition.key)) return null;
  if (nearbyPlaces.has(text)) return placed('identity', 'nearby_location', 'text', '附近地点', text);
  if (sourcePattern.test(text)) return source(text);
  if (interestPattern.test(text)) return interest(text);
  if (text === '小宝') return placed('reference', 'other', 'text', '其他资料', text);

  // 同一单元格中的地点/学校与年级分别呈现；单元格本身继续只有一个原始字段凭据。
  const parts = text.replace(/^[|｜]\s*/u, '').split(/[\n/|｜]+/u).map(value => value.trim()).filter(Boolean);
  if (parts.length === 2) {
    const grade = parseGrade(parts[1]);
    if (grade.status === 'normalized' && !grade.review?.length && (typeof grade.value === 'number' || grade.value?.stage)) {
      const location = nearbyPlaces.has(parts[0]) ? placed('identity', 'nearby_location', 'text', '附近地点', parts[0])
        : address(parts[0]) ? placed('acquisition', 'location', 'text', '获取地址', parts[0])
          : /小学|附小|中学|幼儿园|学校/u.test(parts[0]) ? placed('identity', 'school', 'text', '就读学校', parts[0]) : null;
      if (location) return { ...location, projections: [gradeProjection(grade)] };
    }
  }
  if (address(text) && !text.includes('\n')) return placed('acquisition', 'location', 'text', '获取地址', text);
  if (id === 'identity.school') {
    const grade = parseGrade(text);
    if (grade.status === 'normalized' && !grade.review?.length) return { ...placed('identity', 'grade', 'grade', '年级', grade.value, grade.display) };
    if (/知道金字塔|约体验|时间不行|目前不考虑/u.test(text)) return placed('notes', 'note', 'text', '备注', text);
    if (text.includes('\n') && /周[一二三四五六日天]|测评|公开课/u.test(text)) {
      return { ...placed('notes', 'activity_arrangements', 'text', '活动安排备注', text), review: ['record_scope'] };
    }
  }
  return null;
}
