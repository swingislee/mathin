/** 全量来源编目只给出去向与覆盖情况；匹配快照不构成业务写入计划。 */
export const HISTORY_CATALOG_VERSION = 1;
const defs = {
  identity: ['身份基础', '学生档案与家庭联系人', 'P0', '复用已完成的来源身份映射；差异单独核对'],
  staff: ['员工资料', '历史作者与员工映射', 'P0', '员工资料独立核对；只建立作者映射，不据此开通账号'],
  lead: ['线索与沟通', '来源、历史首联及跟进', 'P1', '拆开获取、确认和跟进；只在有依据时记录发生日期和人员'],
  assessment: ['到访与测评', '历史活动、测评与反馈', 'P1', '思维测评已有样本；学习力、英语、试听及报名字段分别补映射'],
  legacy_activity: ['旧选拔与沟通', '历史活动、测评、报名与沟通', 'P1', '姓名归属先核对；同一宽表中的独立业务分别保存'],
  activity: ['竞赛报名', '活动与学生报名、备考及结果', 'P2', '已有单案例；批量前补届次共用、备考字段和修订保护'],
  renewal: ['暑秋续报', '按年与期别的续班意向、结果和沟通', 'P2', '已有备注样本；补是否续报、续报类型、缴费日期及矛盾处理'],
  enrollment: ['多期报名', '各期报名及原授课安排', 'P2', '已有寒春样本；补八组报名列、跨年同名期别、收据及退费资料'],
  price_renewal: ['调价续报', '续班、新报、沟通与结果', 'P3', '姓名候选按家庭核对；新报与续报、意向与结果分别判断'],
  current_roster: ['当前名单候选', '历史名单与本期在读核对', 'P4', '核实本期实际名单及身份后，再由当前流程启用'],
  roster: ['横向名单', '逐学生的历史授课安排', 'P4', '以单元格与班级块为边界；同一行多名学生分别归属'],
  pause: ['暂课名单', '历史暂课及原授课安排', 'P4', '逐名单位置归属；补历史暂课的业务承载方式'],
  withdrawal: ['退班资料', '历史退班、退款记载及原因', 'P4', '先关联原报名；原退款记载单独保留，不生成支付流水'],
  class: ['班级基础', '原班级、课程与教师映射', 'P4', '按来源班级 ID 对账；已确认的历史班级继续归档'],
  learning: ['教学记录', '历史学习表现与教学沟通', 'P4', '核实学期、讲次与学生；原记录不替代正式课次和考勤'],
  ambiguous: ['用途待核对', '原资料与待核对内容', 'P4', '先读版式与字段；保留原文后补学生和业务归属'],
  operations: ['运营与素材', '内部运营、教材及素材档案', 'P5', '保留原用途；具名日报中的学生事实需另行核对'],
};
const feishu = {
  '到访数据与信息表1.0-总': 'assessment', '获客&私域信息登记表1.0-总': 'lead',
  '（老数据）各选拔产品协作信息表-总': 'legacy_activity', '袋鼠报名与备考信息表': 'activity',
  '2026暑秋续报数据表': 'renewal', '调价续报与新报用户运营数据表-小学': 'price_renewal',
  '调价续报与新报用户运营数据表-初中': 'price_renewal', '2026秋季在读学员表格': 'current_roster',
  '一组学员学习信息': 'learning', '解决方案与内容产出框架': 'operations', '三组12月前端目标拆解': 'operations',
  '二组12月前端目标拆解': 'operations', '一组12月前端目标拆解': 'operations', '一组信息日报': 'operations',
  '运营相关图片-私域可用（公域勿用）': 'operations', '学科内容产出表1.0-总': 'operations',
  '袋鼠推广': 'operations', '一组市场获客信息': 'operations', '一组教学服务信息': 'operations',
};
const historicWorkbook = {
  '学员报名信息': 'enrollment', '4退班学员表': 'withdrawal', '3暂课学员': 'pause',
  '秋季教材': 'operations', '专属推广链接': 'operations', '用户通道在读学员信息记录': 'ambiguous',
  '2暑期班级（附秋季班-连报学员）': 'roster', '3023Q4春季班级情况': 'roster', '其他课程': 'roster',
  '寒春班级（待续班时建）': 'roster', '25暑秋班级进度': 'roster', '26寒春在读学员': 'roster',
  '讲义': 'roster', '26年暑秋在读学员': 'roster',
};
const pilotFields = {
  assessment: new Set(['到访日期', '思维测评等级', '学员情况', '学员情况2', '家长情况', '家长情况2', '家长理念']),
  activity: new Set(['报名日期', '真题领取', '填写与否']),
  renewal: new Set(['未报/连报情况', '春季班型', '带课老师']),
  enrollment: new Set(['报名日期', '缴费金额', '学期', '班型', '老师', '教室', '期别/周别', '时段']),
};
export const CATALOG_BATCHES = [
  ['P0', '核对身份与作者', '学生来源 ID、家庭联系人、历史作者', '使用目标库刷新身份匹配；员工和学生分别对账'],
  ['P1', '补齐沟通与到访', '私域、旧选拔、到访及测评', '保留全文，按获取／确认／跟进分组；补 Lead 历史承载及多类测评'],
  ['P2', '推广已验证业务', '竞赛、暑秋续报、多期报名', '以袋鼠小批验证共同活动与修订保留，再按字段覆盖扩大'],
  ['P3', '整理调价续报', '小学、初中调价表', '核对同名归属与期别，分别记录新报、续报、意向和结果'],
  ['P4', '整理名单与变动', '班级、横向名单、暂课、退班和学习记录', '拆单元格、核年份与课程，再关联原报名；当前启用单独确认'],
  ['P5', '保留其他资料', '运营目标、日报、内容、教材和推广链接', '按原用途保存并可查询；空表保留字段结构'],
];

export function classifyHistorySource(source, table) {
  let kind;
  if (source.format !== 'xlsx') kind = feishu[table.name];
  else if (source.filename === '学生管理-学生列表.xlsx') kind = 'identity';
  else if (source.filename === '员工管理.xlsx') kind = 'staff';
  else if (source.filename === '班级列表导出数据.xlsx') kind = 'class';
  else if (source.filename.startsWith('格致思维')) kind = 'lead';
  else if (source.filename === '子2：报名学员信息与2024课表【数据系列2】.xlsx') kind = historicWorkbook[table.name];
  const known = Boolean(kind);
  kind ??= 'ambiguous';
  const [category, destination, batch, nextStep] = defs[kind];
  const identityScope = ['staff', 'class', 'operations'].includes(kind) ? 'not_applicable'
    : ['roster', 'pause', 'ambiguous'].includes(kind) ? 'cell_review' : 'person_row';
  return { kind, known, category, destination, batch, nextStep, identityScope,
    coverage: pilotFields[kind] ? '仅部分字段有单案例' : ['identity', 'staff', 'class'].includes(kind) ? '已有来源资料，需目标对账' : '原文可查，业务转换待补' };
}

export function historyFieldDisposition(kind, field) {
  const name = field.name;
  let target, rule;
  const assign = (next, detail) => { target = next; rule = detail; };
  if (field.kind === 'system' || /^__/.test(field.key)) assign('来源凭据', '保留元数据；导入／修改时间与业务发生时间分开');
  else if (kind === 'staff') assign('员工与历史作者资料', '按员工来源 ID 及真实岗位核对；不参与学生匹配');
  else if (kind === 'operations') assign('运营与素材原档', '按本表用途保留原字段及来源');
  else if (/退款|退费/.test(name)) assign('历史退款记载', '保存金额、原文与对应期别，核对后关联原报名');
  else if (/^序号$|^序列$|^排序$|人数|名额|开班差额/.test(name)) assign('来源编号与派生统计', '原编号／公式保留；人数由逐人记录计算，缺缓存公式不作事实');
  else if (/手机号|手机号码|联系电话|家长电话|联系方式|团成员手机号/.test(name)) assign('联系人及身份依据', '结合姓名、来源 ID 与家庭关系核对；同电话多姓名保留候选');
  else if (/^(学员|学生|孩子)?姓名$|学生姓名|孩子姓名|学生ID|学员ID|家长姓名|微信昵称|学生英文名|直播云学生ID/.test(name)) assign('学生与家庭身份依据', '复用现有身份；昵称与姓名、家长与学生分别保存');
  else if (/性别|年级|学校|公立校|生日|出生日期|证件号码|邮箱|文\/理科/.test(name)) assign('学生档案候选值', '保留源值与适用时间；矛盾不覆盖，历史年级不直接作为当前年级');
  else if (kind === 'class') assign('原班级与授课资料', '用来源班级 ID 对账；原班级状态与当前启用分开');
  else if (/跟进人|确认人员|获取人员|沟通人员|课程顾问|学管师|服务老师|学服老师|报名操作老师|其他老师/.test(name)) assign('历史经办人与服务关系', '保留原人员及业务角色；按员工来源核对后关联真实身份');
  else if (/^是否测评$|^是否体验\/测评/.test(name)) assign('历史业务状态依据', '保留当时是否参与的记载，结果由原测评记录提供');
  else if (kind === 'activity' && name === '报名日期') assign('活动报名日期', '保存学生报名日期；活动举行日期与届次另行核对');
  else if (/测评|进门测|备考成绩|成绩级别|学员程度|学习力/.test(name)) assign('测评或学习结果', '区分学科、类型与发生日期；原等级保留，未知分数留空');
  else if (/学员情况|家长情况|家长理念|关注点|重视点|培养重点/.test(name)) assign(kind === 'assessment' || kind === 'legacy_activity' ? '测评及到访反馈' : '对应业务沟通', '同源重复反馈合并展示；独立记录继续保留');
  else if (kind === 'renewal' || kind === 'price_renewal') {
    if (/老师|班型|周类|上课|周次|组别|校区|管区/.test(name)) assign('续班时的原授课背景', '保留当时老师、班型、课表原值');
    else if (/缴费|补续日期/.test(name)) assign('续班日期与缴费依据', '保留原日期精度与来源；按期别核对结果');
    else assign(/情况|说明|备注/.test(name) ? '续班沟通' : '续班、新报与结果', '分开年份、期别、意向及最终结果；与其他来源矛盾时保留差异');
  } else if (/^报课\d*$|报名日期|报名缴费日期|缴费金额|缴费入口|收据编号|报名操作|减免/.test(name)) assign('各期历史报名', '按列组与年份拆分，原金额及收据依据保留；核对同名期别');
  else if (/班型|班号|教室|老师|学期|期别|周别|时段|班级|课程|校区|上课/.test(name)) assign('历史授课安排', '保留班级块／期别位置；具备真实对应关系后再连正式班级');
  else if (kind === 'activity') assign(/报名日期/.test(name) ? '活动报名日期' : '竞赛报名与备考资料', '报名、领取、填报、备考和成绩各自保存；届次及举行日期独立核对');
  else if (/日期|时间|月份|周次/.test(name)) assign('业务时间候选值', '按字段所属业务保留原粒度；只有月份／周次时保留原文');
  else if (/沟通|备注|初步信息|跟进信息|确认信息|触达内容/.test(name)) assign('历史沟通', '保留完整内容及原字段，按本次沟通日期／作者分组');
  else if (/获取|渠道|来源|推广员|提交时间|定位|区位/.test(name)) assign('来源与获客事实', '保留渠道、时间和来源记录；不同活动中的同一家庭保留各次来源');
  else if (/确认|跟进|到访|诺访|预约|报名|出勤|参与|兴趣|加V|状态|意向/.test(name)) assign('历史业务状态依据', '只表达当时记录；真实发生与意向分开，当前工作单独启用');
  else if (['roster', 'pause'].includes(kind)) assign('名单单元格或班级块', '逐单元格核对学生与相邻班级信息；整行继续作为原始依据');
  else assign('原字段待核对', '原值可查；补明确业务含义后再转换');
  let coverage = pilotFields[kind]?.has(name) || (kind === 'enrollment' && /^报课\d*$/.test(name)) ? '已有样本涉及，批量仍需扩展' : '待补规则';
  if (kind === 'activity' && ['真题领取', '填写与否'].includes(name)) coverage = '样本仅保留依据，独立字段待补';
  if (['来源凭据', '运营与素材原档', '来源编号与派生统计'].includes(target)) coverage = '按原始资料保留';
  if (['identity', 'staff', 'class'].includes(kind)) coverage = '已有来源资料，需目标对账';
  return { target, rule, coverage };
}

const colKey = id => id.replace(/\d+$/, '');
const columnNumber = value => [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
export function summarizeHistoryTable({ source, table, records, matches, entities }) {
  const classification = classifyHistorySource(source, table);
  let headerRow = table.headerRow ?? 0;
  let headerBasis = headerRow ? '提取器识别的表头及之前说明行' : '未识别表头';
  if (classification.kind === 'class' && source.format === 'xlsx' && headerRow === 0) {
    const first = records.find(r => r.sourceRow === 1);
    if (first?.cells[0]?.text === '班级ID' && first?.cells[1]?.text === '班级名称') { headerRow = 1; headerBasis = '原第 1 行班级ID／班级名称已核对'; }
  }
  const headers = new Map((records.find(r => r.sourceRow === headerRow)?.cells ?? []).map(c => [colKey(c.fieldId), c.text.trim()]));
  const fields = new Map(), counts = { rawRows: records.length, contentRows: 0, headerRows: 0, dataRows: 0, matchedStudentRows: 0,
    matchedLeadRows: 0, reviewRows: 0, unmatchedRows: 0, inapplicableRows: 0, ignoredSnapshotMatches: 0, missingFormulaCells: 0 };
  for (const record of records) {
    const header = source.format === 'xlsx' && headerRow > 0 && record.sourceRow <= headerRow;
    if (record.hasContent) {
      counts.contentRows++;
      if (header) counts.headerRows++;
      else {
        counts.dataRows++;
        const match = matches.get(record.id);
        if (classification.identityScope !== 'person_row') {
          counts.inapplicableRows++;
          if (match?.status === 'matched') counts.ignoredSnapshotMatches++;
        } else if (match?.status === 'matched') {
          const entity = entities.get(match.entityKey);
          if (!entity || !['student', 'lead'].includes(entity.kind)) throw new Error('CATALOG_MATCH_REFERENCE');
          counts[entity.kind === 'student' ? 'matchedStudentRows' : 'matchedLeadRows']++;
        } else counts[match?.status === 'review' ? 'reviewRows' : 'unmatchedRows']++;
      }
    }
    for (const cell of record.cells) {
      const key = source.format === 'xlsx' ? colKey(cell.fieldId) : cell.fieldId;
      const name = source.format === 'xlsx' ? headers.get(key) || `列 ${key}（原表无标题）` : cell.fieldName;
      const f = fields.get(key) ?? { key, name, kind: cell.kind, types: new Set(), filledCells: 0, formulaCount: 0, missingFormulaCells: 0 };
      f.types.add(cell.type);
      if (!header && record.hasContent) {
        const formula = cell.rawValue && typeof cell.rawValue === 'object' && Object.hasOwn(cell.rawValue, 'formula');
        const missing = formula && cell.rawValue.xmlValue == null;
        if (cell.text.trim() && !missing) f.filledCells++;
        if (formula) f.formulaCount++;
        if (missing) { f.missingFormulaCells++; counts.missingFormulaCells++; }
      }
      fields.set(key, f);
    }
  }
  if (counts.contentRows !== counts.headerRows + counts.dataRows || counts.dataRows !== counts.matchedStudentRows + counts.matchedLeadRows + counts.reviewRows + counts.unmatchedRows + counts.inapplicableRows) throw new Error('CATALOG_COUNTS');
  const fieldRows = [...fields.values()].sort((a, b) => source.format === 'xlsx' ? columnNumber(a.key) - columnNumber(b.key) : a.key.localeCompare(b.key))
    .map(f => ({ ...f, types: [...f.types].sort(), ...historyFieldDisposition(classification.kind, f) }));
  return { sourceId: source.id, sourceName: source.filename, tableId: table.id, tableName: table.name, headerRow, headerBasis, ...classification, counts, fields: fieldRows };
}
