import crypto from 'node:crypto';
import { normalizeNewlines } from './text-hash.mjs';

export const RECONCILIATION_VERSION = 1;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const unique = values => [...new Set(values.filter(Boolean))];
export const normalizeName = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('en');
const fieldName = cell => cell.fieldName.replace(/\s*\[[A-Z]+\]$/u, '').trim();
const letter = cell => cell.fieldId.replace(/\d+$/u, '');
export const valueAt = (row, column) => row.cells.find(cell => letter(cell) === column)?.text?.trim() ?? '';
const field = (row, name) => row.cells.find(cell => fieldName(cell) === name)?.text?.trim() ?? '';
const countBy = (items, select) => items.reduce((counts, item) => {
  const key = select(item); counts[key] = (counts[key] ?? 0) + 1; return counts;
}, {});
const STUDENT_NAME = /^(?:姓名|学员姓名|学生姓名|孩子姓名|儿童姓名|宝宝姓名)$/u;
const STUDENT_PHONE = /^(?:手机号|手机号码|家长电话|家长手机号|家长手机号码|联系电话|联系方式|电话)$/u;
const STAFF_FIELD = /^(?:老师|班级老师|授课老师|授课学科老师|报名服务老师|学服老师|学科老师|其他老师|带课老师|配合跟进学服老师|课程顾问|学管师|报名操作老师|非在读-学服|授课学服|获取人员|确认人员|沟通人员|跟进人)$/u;

export function phonesIn(value) {
  return unique(String(value ?? '').split(/[\n,，;；、/|]+/u).map(part => part.trim().replace(/[\s()（）-]/gu, '').replace(/^(?:\+86|0086)/u, ''))
    .filter(phone => /^1[3-9]\d{9}$/u.test(phone) && !/^1(\d)\1{9}$/u.test(phone) && !/^1\d{2}0{6}\d{2}$/u.test(phone)));
}

export function isPlaceholderStaff(name) {
  const text = normalizeName(name);
  return /^(?:待定|待安排|待分配|待招聘|管理员|测试(?:账号|老师|教师)?\d*|占位(?:老师|教师)?\d*)$/u.test(text)
    || /^(?:数学|语文|英语|思维|初中|高中|小学|小低|小高|专业思维)(?:老师|教师)?[a-z0-9一二三四五六七八九十]*$/u.test(text)
    || /^(?:老师|教师)[a-z0-9一二三四五六七八九十]+$/u.test(text);
}

/** 员工表确定当前成员；源表内明确写在同一姓名中的中英文别名可用于唯一匹配。 */
export function createStaffIndex(employees, confirmedAliases = []) {
  const exact = new Map();
  const embedded = new Map();
  const append = (map, key, employee) => { const items = map.get(key) ?? []; items.push(employee); map.set(key, items); };
  const roster = employees.map(employee => ({ ...employee, status: isPlaceholderStaff(employee.name) ? 'placeholder' : 'current', importEligible: !isPlaceholderStaff(employee.name),
    contactStatus: phonesIn(employee.phone).length === 1 ? 'complete' : 'needs_review' }));
  for (const employee of roster) {
    append(exact, normalizeName(employee.name), employee);
    const bilingual = employee.name.match(/^([\p{Script=Han}]{2,5})\s*([A-Za-z][A-Za-z .-]+)$/u);
    if (bilingual && employee.importEligible) for (const name of bilingual.slice(1)) append(embedded, normalizeName(name), employee);
  }
  const aliases = new Map();
  for (const alias of confirmedAliases) {
    if (!alias.confirmedBy || !alias.evidence || !alias.name || !alias.employeeId) throw new Error('STAFF_ALIAS_CONFIRMATION_REQUIRED');
    const target = roster.find(employee => employee.id === alias.employeeId && employee.importEligible);
    if (!target || exact.has(normalizeName(alias.name)) || aliases.has(normalizeName(alias.name))) throw new Error('STAFF_ALIAS_CONFLICT');
    aliases.set(normalizeName(alias.name), { target, evidence: alias.evidence, confirmedBy: alias.confirmedBy });
  }
  return { roster, match(name) {
    const key = normalizeName(name);
    if (!key) return { status: 'missing', employeeId: null, importEligible: false, reason: '来源未填写姓名' };
    if (/^(?:社区活动|群活动|运动会|小红书|转介绍|综合中心|已加|未加)$/u.test(key)) return { status: 'source_label', employeeId: null, importEligible: false, reason: '活动、渠道或状态标签' };
    if (isPlaceholderStaff(name)) return { status: 'placeholder', employeeId: null, importEligible: false, reason: '学科、学段或待定占位名称' };
    const direct = exact.get(key) ?? [];
    if (direct.length === 1) return { status: direct[0].status, employeeId: direct[0].id, importEligible: direct[0].importEligible, reason: '现有员工名单同名' };
    if (direct.length > 1) return { status: 'review', employeeId: null, importEligible: false, reason: '员工名单同名多条' };
    const explicit = aliases.get(key);
    if (explicit) return { status: 'current', employeeId: explicit.target.id, importEligible: true, reason: '用户确认别名', evidence: explicit.evidence };
    const candidates = embedded.get(key) ?? [];
    if (candidates.length === 1) return { status: 'current', employeeId: candidates[0].id, importEligible: true, reason: '员工姓名内明确中英文别名' };
    if (candidates.length > 1 || !/^[\p{Script=Han}]{2,6}(?:[A-Za-z .-]+)?$/u.test(name.trim()) || /(?:老师|姐|哥|妈|爸|总)$/u.test(name)) {
      return { status: 'review', employeeId: null, importEligible: false, reason: '简称、来源标签或多个别名候选' };
    }
    return { status: 'historical', employeeId: null, importEligible: false, reason: '不在现有真实员工名单中' };
  } };
}

/** 文件路径属于来源身份。相同内容的空班导出仍保留各自班级文件及位置。 */
export function locateWorkbooks(workbooks, manifest) {
  return workbooks.map(workbook => {
    const candidates = manifest.filter(file => file.path.split('/').at(-1) === workbook.source.filename && file.sha256 === workbook.source.sha256);
    if (candidates.length !== 1) throw new Error('WORKBOOK_SOURCE_PATH_AMBIGUOUS');
    const sourcePath = candidates[0].path;
    return { ...workbook, sourcePath, records: workbook.records.map(row => ({ ...row, sourcePath,
      key: `xlsx:${sourcePath}#${row.tableName}!${row.sourceRow}` })) };
  });
}

function expectColumns(workbook, names) {
  const header = workbook.records.find(row => row.sourceRow === 1);
  if (!header || names.some(([column, name]) => valueAt(header, column) !== name)) throw new Error(`SOURCE_HEADER_CHANGED:${workbook.source.filename}`);
}

const staffIdentity = (name, staff) => { const result = staff.match(name); return result.employeeId ? `employee:${result.employeeId}` : `source-name:${normalizeName(name)}`; };
export const normalizeCampus = name => normalizeName(name) === '紫辰' ? '紫辰阁' : normalizeName(name);
export function normalizeTime(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').replace(/(?<!\d)(\d):(\d{2})/gu, '0$1:$2');
}
const normalizeGrade = value => normalizeName(value).replace(/一年级/gu, '1年级').replace(/二年级/gu, '2年级').replace(/三年级/gu, '3年级').replace(/四年级/gu, '4年级').replace(/五年级/gu, '5年级').replace(/六年级/gu, '6年级').replace(/七年级|初一/gu, '7年级').replace(/八年级|初二/gu, '8年级').replace(/九年级|初三/gu, '9年级');

export function readMagicReferences(workbooks, staff) {
  const master = workbooks.find(w => /^2026-09-07_学生管理-学生列表\.xlsx$/u.test(w.source.filename));
  const active = workbooks.find(w => /^2026-09-07_未开课与开课中班级列表导出数据\.xlsx$/u.test(w.source.filename));
  const summary = workbooks.find(w => w.source.filename === '班级学生汇总.xlsx');
  if (!master || !active || !summary) throw new Error('MAGIC_REQUIRED_SOURCES_MISSING');
  expectColumns(master, [['A', '学生ID'], ['C', '学生姓名'], ['D', '联系电话']]);
  expectColumns(active, [['A', '班级ID'], ['B', '班级名称'], ['L', '班级老师'], ['S', '班级状态']]);
  const detailBooks = workbooks.filter(w => w.sourcePath.includes('/班级学生明细/'));
  const rosterColumns = [['A', '班级名称'], ['F', '老师'], ['K', '学生ID'], ['L', '学生姓名'], ['N', '联系电话'], ['Q', '状态']];
  expectColumns(summary, rosterColumns);
  const signature = row => JSON.stringify(row.cells.map(cell => [letter(cell), normalizeNewlines(cell.text)]));
  const summaryCounts = countBy(summary.records.filter(row => row.sourceRow > 1), signature);
  const detailCounts = {};
  const members = [];
  const classFiles = [];
  for (const workbook of detailBooks) {
    expectColumns(workbook, rosterColumns);
    const classId = workbook.source.filename.match(/-(\d+)\.xlsx$/u)?.[1];
    if (!classId) throw new Error('CLASS_FILENAME_ID_MISSING');
    const rows = workbook.records.filter(row => row.sourceRow > 1);
    classFiles.push({ classId, sourcePath: workbook.sourcePath, studentRows: rows.length });
    for (const row of rows) {
      const key = signature(row); detailCounts[key] = (detailCounts[key] ?? 0) + 1;
      members.push({ key: row.key, sourcePath: row.sourcePath, sourceRow: row.sourceRow, classId,
        className: valueAt(row, 'A'), grade: valueAt(row, 'B'), subject: valueAt(row, 'C'), term: valueAt(row, 'D'), campus: valueAt(row, 'E'),
        teacher: valueAt(row, 'F'), starts: valueAt(row, 'G'), ends: valueAt(row, 'H'), time: valueAt(row, 'I'),
        studentId: valueAt(row, 'K'), name: valueAt(row, 'L'), phones: phonesIn(valueAt(row, 'N')), state: valueAt(row, 'Q') });
    }
  }
  const allSignatures = unique([...Object.keys(summaryCounts), ...Object.keys(detailCounts)]);
  const rosterDifferences = allSignatures.filter(key => (summaryCounts[key] ?? 0) !== (detailCounts[key] ?? 0)).map(key => ({
    cells: JSON.parse(key), summaryCount: summaryCounts[key] ?? 0, detailCount: detailCounts[key] ?? 0,
  }));
  const classes = active.records.filter(row => row.sourceRow > 1).map(row => ({ key: row.key, sourcePath: row.sourcePath, sourceRow: row.sourceRow,
    id: valueAt(row, 'A'), name: valueAt(row, 'B'), course: valueAt(row, 'D'), subject: valueAt(row, 'G'), grade: valueAt(row, 'H'), term: valueAt(row, 'I'),
    mode: valueAt(row, 'J') || valueAt(row, 'B').match(/秋季\s*(A\+?|G\+|X\+|S|培优|基础)/u)?.[1] || '',
    teacher: valueAt(row, 'L'), teacherMatch: staff.match(valueAt(row, 'L')), campus: valueAt(row, 'M'), room: valueAt(row, 'N'),
    studentCount: Number(valueAt(row, 'P')), state: valueAt(row, 'S'), starts: valueAt(row, 'T'), ends: valueAt(row, 'U'), time: valueAt(row, 'V'),
    weekday: valueAt(row, 'B').match(/周[一二三四五六日天]/u)?.[0]?.replace('天', '日') || '',
  }));
  const students = new Map();
  const add = (id, name, phones, evidence, masterFields) => {
    if (!/^\d+$/u.test(id)) throw new Error('MAGIC_STUDENT_ID_INVALID');
    const student = students.get(id) ?? { id, name, names: [], phones: [], evidence: [], master: null };
    student.names = unique([...student.names, name]); student.phones = unique([...student.phones, ...phones]); student.evidence.push(evidence);
    if (masterFields) { if (student.master) throw new Error('MAGIC_MASTER_DUPLICATE_ID'); student.master = masterFields; student.name = name; }
    students.set(id, student);
  };
  for (const row of master.records.filter(row => row.sourceRow > 1)) add(valueAt(row, 'A'), valueAt(row, 'C'), unique([...phonesIn(valueAt(row, 'D')), ...phonesIn(valueAt(row, 'S'))]), row.key, {
    state: valueAt(row, 'G'), grade: valueAt(row, 'N'), campus: valueAt(row, 'F'), school: valueAt(row, 'J'), updatedAt: valueAt(row, 'AG'),
  });
  for (const member of members) add(member.studentId, member.name, member.phones, member.key);
  return { classes, classFiles, students: [...students.values()], members, rosterDifferences,
    totals: { studentMasterRows: master.records.length - 1, studentIds: students.size, classListRows: classes.length,
      detailFiles: detailBooks.length, emptyClassFiles: classFiles.filter(file => !file.studentRows).length,
      summaryStudentRows: summary.records.length - 1, detailStudentRows: members.length, differentRosterSignatures: rosterDifferences.length } };
}

export function createPersonIndex(people) {
  const names = new Map(); const phones = new Map();
  for (const person of people) {
    for (const name of unique(person.names.map(normalizeName))) { const ids = names.get(name) ?? new Set(); ids.add(person.id); names.set(name, ids); }
    for (const phone of person.phones) { const ids = phones.get(phone) ?? new Set(); ids.add(person.id); phones.set(phone, ids); }
  }
  return { people: new Map(people.map(person => [person.id, person])), names, phones };
}

/** 姓名与完整电话共同命中；电话属于家庭，姓名不足时只给候选。 */
export function matchPerson({ name, phones = [] }, index) {
  const nameIds = [...(index.names.get(normalizeName(name)) ?? [])];
  const phoneIds = unique(phones.flatMap(phone => [...(index.phones.get(phone) ?? [])]));
  const exactIds = nameIds.filter(id => phones.length > 0 && phones.every(phone => index.people.get(id).phones.includes(phone)));
  if (exactIds.length === 1) return { status: 'matched', method: 'name_and_all_phones', personId: exactIds[0], candidateIds: exactIds };
  const candidateIds = unique([...nameIds, ...phoneIds]);
  return { status: candidateIds.length ? 'review' : 'unmatched', personId: null, candidateIds,
    method: exactIds.length > 1 ? 'duplicate_name_phone' : nameIds.length && phones.length ? 'name_phone_conflict' : nameIds.length ? 'name_only' : phoneIds.length ? 'family_phone_only' : 'no_reference' };
}

function basePersonRows(base) {
  return base.records.filter(row => row.hasContent).flatMap(row => {
    const nameCells = row.cells.filter(cell => STUDENT_NAME.test(fieldName(cell)) && cell.text.trim());
    if (!nameCells.length) return [];
    const key = `feishu:${row.tableId}:${row.sourceRecordId}`;
    return [{ key, sourcePath: base.source.filename, sourceRecordId: row.sourceRecordId, tableId: row.tableId, tableName: row.tableName,
      name: nameCells.length === 1 ? nameCells[0].text.trim() : nameCells.map(cell => cell.text.trim()).join(' / '),
      phones: unique(row.cells.filter(cell => STUDENT_PHONE.test(fieldName(cell))).flatMap(cell => phonesIn(cell.text))),
      ambiguousNameFields: nameCells.length !== 1, sourceRow: row, authority: 'feishu_business' }];
  });
}

function columnIndex(value) { return [...value].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0); }

/** 横向花名册逐单元格拆分，保留每块课表上下文。 */
export function horizontalRosterPeople(workbook) {
  const people = [];
  for (const table of workbook.tables) {
    const rows = workbook.records.filter(row => row.tableId === table.id);
    const header = rows.find(row => row.sourceRow <= 5 && row.cells.some(cell => STUDENT_NAME.test(cell.text.trim())));
    if (!header || table.name === '学员报名信息' || table.name === '4退班学员表') continue;
    const starts = header.cells.filter(cell => STUDENT_NAME.test(cell.text.trim())).map(cell => letter(cell));
    for (const start of starts) {
      const ordinal = rows.find(row => row.sourceRow > header.sourceRow && row.sourceRow <= header.sourceRow + 2 && valueAt(row, start) === '1');
      if (!ordinal) continue;
      const columns = [];
      for (let col = columnIndex(start); ; col++) {
        const cell = ordinal.cells.find(cell => columnIndex(letter(cell)) === col);
        if (!cell || !/^\d+$/u.test(cell.text) || Number(cell.text) > 30 || Number(cell.text) < 1) break;
        columns.push(letter(cell));
      }
      const contextHeaders = header.cells.filter(cell => columnIndex(letter(cell)) < columnIndex(start));
      const lastNameHeader = Math.max(0, ...starts.filter(item => columnIndex(item) < columnIndex(start)).map(columnIndex));
      const context = contextHeaders.filter(cell => columnIndex(letter(cell)) > lastNameHeader && /^(?:老师|年级|学期|班号|教室|期别\/周别|周别|时段|班型|班级状态)$/u.test(cell.text.trim()));
      for (const row of rows.filter(row => row.sourceRow > ordinal.sourceRow)) for (const col of columns) {
        const name = valueAt(row, col);
        if (!name || name.startsWith('=') || /^\d+$/u.test(name)) continue;
        people.push({ key: `${row.key}:${col}`, sourcePath: workbook.sourcePath, tableId: table.id, tableName: table.name,
          sourceRow: row.sourceRow, cell: `${col}${row.sourceRow}`, name, phones: [], authority: 'historical_reference',
          context: Object.fromEntries(context.map(cell => [cell.text.trim(), valueAt(row, letter(cell))])) });
      }
    }
  }
  return people;
}

function excelPeople(workbooks) {
  return workbooks.filter(w => w.source.filename.startsWith('子2') || w.sourcePath.includes('小地推')).flatMap(workbook => {
    const horizontal = workbook.source.filename.startsWith('子2') ? horizontalRosterPeople(workbook) : [];
    const horizontalTables = new Set(horizontal.map(row => row.tableId));
    const vertical = workbook.tables.flatMap(table => {
      if (horizontalTables.has(table.id) || !table.headerRow) return [];
      return workbook.records.filter(row => row.tableId === table.id && row.sourceRow > table.headerRow).flatMap(row => {
        const nameCells = row.cells.filter(cell => STUDENT_NAME.test(fieldName(cell)) && cell.text.trim());
        if (nameCells.length !== 1) return [];
        return [{ key: row.key, sourcePath: workbook.sourcePath, tableId: row.tableId, tableName: row.tableName, sourceRow: row.sourceRow,
          name: nameCells[0].text.trim(), phones: unique(row.cells.filter(cell => STUDENT_PHONE.test(fieldName(cell))).flatMap(cell => phonesIn(cell.text))),
          authority: 'historical_reference', context: Object.fromEntries(row.cells.filter(cell => STAFF_FIELD.test(fieldName(cell))).map(cell => [cell.fieldId, cell.text])) }];
      });
    });
    return [...vertical, ...horizontal];
  });
}

function currentClassCandidates(row, classes, staff) {
  const teacher = field(row, '授课学科老师'); const grade = field(row, '年级'); const campus = field(row, '校区');
  const weekday = field(row, '26秋上课周次'); const time = field(row, '26秋上课时段'); const mode = field(row, '班型');
  if (![teacher, grade, campus, weekday, time, mode].every(Boolean)) return [];
  return classes.filter(item => item.term === '秋季' && item.starts.startsWith('2026-') && normalizeGrade(item.grade) === normalizeGrade(grade)
    && normalizeCampus(item.campus) === normalizeCampus(campus) && item.weekday === weekday && normalizeTime(item.time) === normalizeTime(time)
    && normalizeName(item.mode) === normalizeName(mode) && staffIdentity(item.teacher, staff) === staffIdentity(teacher, staff));
}

function teacherReferences(base, workbooks, staff) {
  const refs = new Map();
  const add = (name, evidence) => {
    for (const value of name.split(/[、,，\n/]+/u).map(name => name.trim()).filter(Boolean)) {
      if (STAFF_FIELD.test(value)) continue;
      const item = refs.get(value) ?? { name: value, ...staff.match(value), evidence: [] };
      item.evidence.push(evidence); refs.set(value, item);
    }
  };
  for (const row of base.records) for (const cell of row.cells) {
    if ((cell.type === 'User' || STAFF_FIELD.test(fieldName(cell))) && cell.text.trim()) add(cell.text, { source: base.source.filename, table: row.tableName, position: `${row.sourceRecordId}/${cell.fieldId}` });
  }
  for (const workbook of workbooks) {
    if (workbook.source.filename === '员工管理.xlsx') continue;
    for (const table of workbook.tables) {
      const rows = workbook.records.filter(row => row.tableId === table.id);
      const header = rows.find(row => row.sourceRow === (table.headerRow || 1));
      if (!header) continue;
      for (const cell of header.cells.filter(cell => STAFF_FIELD.test(cell.text.trim()))) {
        for (const row of rows.filter(row => row.sourceRow > header.sourceRow)) {
          const name = valueAt(row, letter(cell));
          if (name && !name.startsWith('=')) add(name, { source: workbook.sourcePath, table: table.name, position: `${letter(cell)}${row.sourceRow}` });
        }
      }
    }
  }
  return [...refs.values()].sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name, 'zh'));
}

export function compareBaseRevisions(previous, current) {
  if (!previous) return null;
  if (previous.source.id !== current.source.id) throw new Error('PREVIOUS_BASE_ID_DIFFERS');
  const byKey = records => new Map(records.map(row => [`${row.tableId}:${row.sourceRecordId}`, row]));
  const oldRows = byKey(previous.records); const newRows = byKey(current.records);
  const added = []; const absent = []; const changed = []; const representationChanges = [];
  for (const [key, row] of newRows) {
    const before = oldRows.get(key);
    if (!before) { added.push({ key, table: row.tableName, hasContent: row.hasContent }); continue; }
    const oldCells = new Map(before.cells.filter(cell => cell.kind !== 'system').map(cell => [cell.fieldId, cell]));
    const newCells = new Map(row.cells.filter(cell => cell.kind !== 'system').map(cell => [cell.fieldId, cell]));
    const fieldIds = unique([...oldCells.keys(), ...newCells.keys()]);
    const fields = fieldIds.filter(id => (oldCells.get(id)?.text ?? '') !== (newCells.get(id)?.text ?? '')).map(id => ({ fieldId: id, field: newCells.get(id)?.fieldName ?? oldCells.get(id).fieldName,
        before: oldCells.get(id)?.text ?? null, after: newCells.get(id)?.text ?? null }));
    if (fields.length) changed.push({ key, table: row.tableName, fields });
    const rawOnly = fieldIds.filter(id => (oldCells.get(id)?.text ?? '') === (newCells.get(id)?.text ?? '')
      && JSON.stringify(oldCells.get(id)?.rawValue ?? null) !== JSON.stringify(newCells.get(id)?.rawValue ?? null));
    if (rawOnly.length) representationChanges.push({ key, table: row.tableName, fieldIds: rawOnly });
  }
  for (const [key, row] of oldRows) if (!newRows.has(key)) absent.push({ key, table: row.tableName });
  return { previousSha256: previous.source.sha256, currentSha256: current.source.sha256, added, absent, changed, representationChanges,
    totals: { addedRecords: added.length, absentRecords: absent.length, changedRecords: changed.length, changedFields: changed.reduce((n, row) => n + row.fields.length, 0),
      representationChangedRecords: representationChanges.length, representationChangedFields: representationChanges.reduce((n, row) => n + row.fieldIds.length, 0) } };
}

export function reconcileSources({ base, workbooks: extracted, manifest, confirmedStaffAliases = [], previousBase = null }) {
  const workbooks = locateWorkbooks(extracted, manifest);
  const employeeBook = workbooks.find(workbook => workbook.source.filename === '员工管理.xlsx');
  if (!employeeBook) throw new Error('EMPLOYEE_SOURCE_REQUIRED');
  expectColumns(employeeBook, [['A', 'ID'], ['B', '姓名'], ['C', '手机号']]);
  const staff = createStaffIndex(employeeBook.records.filter(row => row.sourceRow > 1).map(row => ({ id: valueAt(row, 'A'), name: valueAt(row, 'B'),
    phone: valueAt(row, 'C'), position: valueAt(row, 'H'), sourcePath: row.sourcePath, sourceRow: row.sourceRow })), confirmedStaffAliases);
  const magic = readMagicReferences(workbooks, staff);
  const magicIndex = createPersonIndex(magic.students);
  const basePeople = basePersonRows(base);
  const referencePeople = excelPeople(workbooks);
  const peopleRows = [...basePeople, ...referencePeople].map(row => ({ ...row, match: row.ambiguousNameFields
    ? { status: 'review', method: 'multiple_name_fields', personId: null, candidateIds: [] } : matchPerson(row, magicIndex) }));
  const current = base.records.filter(row => row.tableName === '2026秋季在读学员表格').map(row => {
    const sourceKey = `feishu:${row.tableId}:${row.sourceRecordId}`;
    const person = peopleRows.find(person => person.key === sourceKey);
    const matches = currentClassCandidates(row, magic.classes, staff);
    const memberIds = unique(magic.members.filter(member => field(row, '姓名') && matches.some(item => item.id === member.classId) && member.state === '在班学生'
      && normalizeName(member.name) === normalizeName(field(row, '姓名'))).map(member => member.studentId));
    const match = memberIds.length === 1 ? { status: 'matched', method: 'name_and_current_class_roster', personId: memberIds[0], candidateIds: memberIds }
      : person?.match ?? { status: 'unmatched', method: 'missing_name', personId: null, candidateIds: [] };
    const reference = magicIndex.people.get(match.personId);
    const inStudy = field(row, '26秋在读'); const registrationMode = field(row, '26秋报名模式');
    const businessState = inStudy === '是' && registrationMode === '待报' ? 'source_conflict' : inStudy === '是' ? 'in_study' : registrationMode === '待报' ? 'pending_registration' : 'unspecified';
    const differences = [];
    if (reference?.master) {
      if (businessState === 'in_study' && reference.master.state !== '在读') differences.push({ field: '在读状态', authority: inStudy, reference: reference.master.state });
      if (reference.master.grade && normalizeGrade(reference.master.grade) !== normalizeGrade(field(row, '年级'))) differences.push({ field: '年级', authority: field(row, '年级'), reference: reference.master.grade });
    }
    if (person) person.match = match;
    return { key: sourceKey, sourceRecordId: row.sourceRecordId, name: field(row, '姓名'), businessState, sourceInStudy: inStudy, sourceRegistrationMode: registrationMode,
      campus: field(row, '校区'), grade: field(row, '年级'), mode: field(row, '班型'), teacher: field(row, '授课学科老师'), teacherMatch: staff.match(field(row, '授课学科老师')),
      serviceTeacher: field(row, '报名服务老师'), serviceTeacherMatch: staff.match(field(row, '报名服务老师')), weekday: field(row, '26秋上课周次'), time: field(row, '26秋上课时段'),
      paymentDate: field(row, '报名缴费日期'), match, classCandidateIds: matches.map(item => item.id), differences };
  });
  // 飞书有完整姓名和电话的相同行可相互定位，仍与魔法校 ID 候选分开。
  const pairGroups = new Map();
  for (const row of peopleRows.filter(row => row.name && row.phones.length && !row.ambiguousNameFields)) {
    const key = hash(`${normalizeName(row.name)}\n${[...row.phones].sort().join(',')}`);
    const group = pairGroups.get(key) ?? { key, name: row.name, phones: row.phones, sourceKeys: [], magicIds: [] };
    group.sourceKeys.push(row.key); if (row.match.status === 'matched') group.magicIds.push(row.match.personId); pairGroups.set(key, group);
    row.exactContactGroup = key;
  }
  const contactGroups = [...pairGroups.values()].map(group => ({ ...group, magicIds: unique(group.magicIds) }));
  const householdPhones = [...magicIndex.phones].filter(([, ids]) => ids.size > 1).map(([phone, ids]) => ({ phone, personIds: [...ids], names: [...ids].map(id => magicIndex.people.get(id).name) }));
  const sourcePhones = new Map();
  for (const group of contactGroups) for (const phone of group.phones) {
    const groups = sourcePhones.get(phone) ?? []; groups.push(group); sourcePhones.set(phone, groups);
  }
  const sharedSourcePhones = [...sourcePhones].filter(([, groups]) => unique(groups.map(group => normalizeName(group.name))).length > 1)
    .map(([phone, groups]) => ({ phone, names: unique(groups.map(group => group.name)), contactGroupKeys: groups.map(group => group.key) }));
  for (const row of current) {
    row.sameNameContactCandidates = row.name ? contactGroups.filter(group => normalizeName(group.name) === normalizeName(row.name)).map(group => group.key) : [];
    row.sameNameSourceRows = row.name ? peopleRows.filter(person => person.key !== row.key && normalizeName(person.name) === normalizeName(row.name)).map(person => person.key) : [];
  }
  const teacherRefs = teacherReferences(base, workbooks, staff);
  const placeBook = workbooks.find(workbook => workbook.source.filename === '校区与教室管理.xlsx');
  if (!placeBook) throw new Error('PLACE_SOURCE_REQUIRED');
  const campuses = placeBook.records.filter(row => row.tableName === '校区管理').map(row => ({ name: valueAt(row, 'A'), address: valueAt(row, 'B'), state: valueAt(row, 'C'),
    kind: /^(?:默认校区|详见选班页面)$/u.test(valueAt(row, 'A')) ? 'placeholder' : 'directory', sourceRow: row.sourceRow }));
  const rooms = placeBook.records.filter(row => row.tableName === '教室管理').map(row => ({ name: valueAt(row, 'A'), campus: valueAt(row, 'C'), state: valueAt(row, 'D'),
    kind: /待分发|详见选班/u.test(valueAt(row, 'A')) ? 'placeholder' : 'directory', sourceRow: row.sourceRow }));
  const roomChecks = magic.classes.map(item => ({ classId: item.id, room: item.room, campus: item.campus,
    status: !item.room ? 'missing' : rooms.some(room => room.name === item.room && normalizeCampus(room.campus) === normalizeCampus(item.campus) && room.kind === 'directory') ? 'matched' : 'review' }));
  const tableMatches = base.tables.map(table => ({ id: table.id, name: table.name, rawRows: table.rowCount, contentRows: table.contentRowCount,
    personRows: peopleRows.filter(row => row.tableId === table.id).length,
    matches: countBy(peopleRows.filter(row => row.tableId === table.id), row => row.match.status) }));
  const revisions = compareBaseRevisions(previousBase, base);
  return { schemaVersion: RECONCILIATION_VERSION, generatedAt: new Date().toISOString(), mode: 'source_reconciliation_preview', businessWrites: 0,
    policy: { businessAuthority: base.source.filename, employeeAuthority: employeeBook.sourcePath, referenceStatusChangesAllowed: false,
      phoneOnlyMergeAllowed: false, placeholderEmployeeImportAllowed: false, confirmedStaffAliases },
    sourceFiles: manifest, baseTables: tableMatches, employees: staff.roster, teacherReferences: teacherRefs,
    currentAutumn: current, people: peopleRows.map(({ sourceRow, ...person }) => ({ ...person, sourceRow: typeof sourceRow === 'number' ? sourceRow : null })),
    contactGroups, householdPhones, sharedSourcePhones, magic, places: { campuses, rooms, classRoomChecks: roomChecks }, revisions,
    warnings: base.warnings,
    totals: { sourceFiles: manifest.length, baseTables: base.tables.length, baseRawRows: base.records.length, baseContentRows: base.records.filter(row => row.hasContent).length,
      excelFiles: workbooks.length, excelTables: workbooks.reduce((n, workbook) => n + workbook.tables.length, 0),
      employees: countBy(staff.roster, row => row.status), currentEmployeesWithContactReview: staff.roster.filter(row => row.status === 'current' && row.contactStatus === 'needs_review').length,
      teacherReferences: countBy(teacherRefs, row => row.status),
      currentAutumn: { rows: current.length, namedRows: current.filter(row => row.name).length, states: countBy(current, row => row.businessState),
        identity: countBy(current, row => row.match.status), teachers: countBy(current, row => row.teacherMatch.status),
        classMatchedRows: current.filter(row => row.classCandidateIds.length === 1).length, classAmbiguousRows: current.filter(row => row.classCandidateIds.length > 1).length,
        rowsWithSameNameContacts: current.filter(row => row.sameNameContactCandidates.length).length },
      allPersonRows: peopleRows.length, personMatches: countBy(peopleRows, row => row.match.status),
      horizontalPersonCells: referencePeople.filter(row => row.cell).length, sameNameContactGroups: contactGroups.length,
      crossSourceContactGroups: contactGroups.filter(group => group.sourceKeys.length > 1).length,
      sharedReferencePhones: householdPhones.length, sharedSourcePhones: sharedSourcePhones.length, campuses: campuses.length, rooms: rooms.length, magic: magic.totals, revisions: revisions?.totals ?? null } };
}
