/** Import only the source's useful position and classifications, independently of lifecycle. */
const TABLES = {
  '获客&私域信息登记表1.0-总': 'acquisition',
  '到访数据与信息表1.0-总': 'assessment',
  '2026秋季在读学员表格': 'service',
};
const value = (record, ...names) => names.map(name => record.cells.find(cell => cell.fieldName.replace(/^A:\s*/, '').trim() === name)?.text?.trim()).find(Boolean) ?? '';
const MARKS = [
  ['promised_visit', '诺访', 'yellow', '诺访与否', '诺访'],
  ['arrived', '已到访', 'lime', '到访与否', '已到'],
  ['enrolled', '来源已报名', 'green', '报名与否', '已报名'],
  ['interest_a', 'A 类意向', 'purple', '意向分类', 'A'],
  ['wechat', '已加微信', 'green', '用户当下加V与否', '已加'],
  ['material_received', '已领真题', 'blue', '真题领取', '已领取'],
  ['group_started', '已开团', 'lime', '开团与否', '已开团'],
];

export function buildBaseWorklistLayout({ records, schemas }) {
  const tables = new Map(schemas);
  const layouts = new Map();
  for (const [tableId, schema] of tables) {
    const firstView = schema.table.viewMap?.[schema.table.views?.[0]];
    const ids = [...new Set([...(firstView?.property?.records ?? []), ...Object.keys(schema.recordMap)])];
    layouts.set(tableId, new Map(ids.map((id, index) => [id, index + 1])));
  }
  const rows = [];
  for (const record of records) {
    const kind = TABLES[record.tableName];
    if (!kind || record.names.length !== 1) continue;
    const schema = tables.get(record.tableId);
    const field = (...names) => value(record, ...names);
    const group = kind === 'acquisition' ? field('获客组别')
      : kind === 'assessment' ? field('到访月份', '确认月份') : field('授课学科老师');
    const subgroup = kind === 'acquisition' ? field('确认人员', '跟进人', '沟通人员')
      : kind === 'assessment' ? field('学服', '学服老师', '学服人员') : field('单师班序（仅多维统计用）');
    const markers = MARKS.flatMap(([key, label, color, name, match]) => {
      const text = field(name);
      return (name === '用户当下加V与否' ? /^(已加|是|加V)/.test(text) : text === match) ? [{ key, label, color, field: name }] : [];
    });
    // A source option is a parallel classification, never a replacement for formal enrollment.
    if (kind === 'service') {
      if (field('26秋在读') === '是') markers.push({ key: 'source_attending', label: '来源本期在读', color: 'green', field: '26秋在读' });
      if (field('26秋报名模式') === '待报') markers.push({ key: 'source_pending', label: '来源待报', color: 'yellow', field: '26秋报名模式' });
    }
    const contextFields = kind === 'acquisition'
      ? ['获取渠道', '获取人员', '跟进结果', '确认结果', '跟进信息', '确认信息备注', '沟通情况']
      : kind === 'assessment'
        ? ['参与内容', '到访日期', '体/测日期', '思维测评等级', '学习力测评等级', '学员情况', '家长情况', '培养重点&核心期待&共识点']
        : ['班型', '校区', '26秋上课周次', '26秋上课时段', '26秋报名模式', '报名服务老师'];
    const context = contextFields.flatMap(name => field(name) ? [{ label: name, value: field(name).slice(0, 800) }] : []);
    const classifications = record.cells.flatMap(cell => {
      const f = schema?.table.fieldMap?.[cell.fieldId];
      if (!Array.isArray(f?.property?.options) || !cell.text?.trim()) return [];
      return f.property.options.filter(option => cell.text.split(/[、,，\n]/).map(x => x.trim()).includes(option.name))
        .map(option => ({ field: cell.fieldName, label: option.name, sourceColor: option.color }));
    });
    rows.push({ logical_key: `${record.tableId}:${record.sourceRecordId}`, kind,
      group_label: group || '未分组', subgroup_label: subgroup || '未分配',
      source_rank: layouts.get(record.tableId)?.get(record.sourceRecordId) ?? Number.MAX_SAFE_INTEGER,
      markers, context, classifications });
  }
  for (const kind of Object.values(TABLES)) {
    const groups = new Map();
    for (const row of rows.filter(r => r.kind === kind).sort((a, b) => a.source_rank - b.source_rank)) {
      const key = `${row.group_label} / ${row.subgroup_label}`;
      if (!groups.has(key)) groups.set(key, groups.size + 1);
      row.group_rank = groups.get(key);
    }
  }
  return rows;
}
