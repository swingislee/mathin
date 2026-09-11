import { describe, expect, it } from 'vitest';
import { buildBaseBusinessPlan } from '../scripts/lib/base-business-fields.mjs';
import { baseChildEvidenceLeadIds } from '../scripts/lib/base-family-organization.mjs';
import { baseBusinessFieldsSchema } from '../src/features/school/base-business-fields-schema.mjs';

const source = (id: string, format: string, values: Record<string, string>, lead = 'linked-lead') => ({ id, lead_id: lead, payload_sha256: 'a'.repeat(64),
  source_sha256: 'b'.repeat(64), source_table_id: 'table', source_data: { format, filename: 'source' }, record_data: { tableName: 'table',
    cells: Object.entries(values).map(([fieldName, text], index) => ({ fieldId: String(index), fieldName, text, type: 'Text' })) } });
const household = () => source('household', 'feishu-base', { 学员姓名: '原称呼', 手机号: '13800001234', '年级/25级': '一年级 四年级', 确认信息备注: '哥哥四年级弟弟一年级' });

describe('Base source families', () => {
  it('stores separate stable children and shared contact details without choosing who owns a lone nickname', () => {
    const input = household(), before = structuredClone(input), plan = buildBaseBusinessPlan([input]);
    const fields = baseBusinessFieldsSchema.parse(plan.facts[0].fields);
    const family = fields.find(field => field.label === '子女资料')!;
    expect(family).toMatchObject({ review: [], value: { familyKey: 'household:family', sourceLabel: '原称呼', sharedPhones: ['13800001234'], identityStatus: 'structured',
      children: [{ index: 1, childKey: 'household:2:child:1', grade: 1, relation: '弟弟', name: null, nameStatus: 'information_pending' },
        { index: 2, childKey: 'household:2:child:2', grade: 4, relation: '哥哥', name: null, nameStatus: 'information_pending' }] } });
    expect(fields.find(field => field.name === '学员姓名')).toMatchObject({ key: 'family_source_label', label: '原线索称呼', originalText: '原称呼' });
    expect(plan.summary).toMatchObject({ familySources: 1, sourceChildren: 2, pendingChildNames: 2, reviewFields: 0 });
    expect(input).toEqual(before);
    expect(buildBaseBusinessPlan([input]).facts).toEqual(plan.facts);
  });
  it('assigns a name only with an independent source on the same linked lead, same phone and matching single grade', () => {
    const independent = source('worksheet', 'xlsx', { '孩子姓名 [A]': '原称呼', '手机号 [B]': '13800001234', '年级（9月开学年级） [C]': '一年级' });
    const plan = buildBaseBusinessPlan([household()], [independent]);
    expect(plan.summary).toMatchObject({ sourceChildren: 2, pendingChildNames: 1 });
    expect(baseBusinessFieldsSchema.parse(plan.facts[0].fields).find(field => field.label === '子女资料')!.value).toMatchObject({ children: [
      { name: '原称呼', grade: 1, nameStatus: 'source_confirmed', linkedLeadId: 'linked-lead', identityEvidence: { sourceId: 'worksheet', sourceHash: 'a'.repeat(64) } },
      { name: null, grade: 4, nameStatus: 'information_pending' },
    ] });
    for (const changed of [source('other', 'xlsx', { 姓名: '原称呼', 手机号: '13800001234', 年级: '一年级' }, 'unrelated-lead'),
      source('other', 'xlsx', { 姓名: '原称呼', 手机号: '13900001234', 年级: '一年级' }),
      source('other', 'xlsx', { 姓名: '另一个人', 手机号: '13800001234', 年级: '一年级' })]) {
      expect(buildBaseBusinessPlan([household()], [changed]).summary.pendingChildNames).toBe(2);
    }
    expect(baseChildEvidenceLeadIds([household(), independent])).toEqual(['linked-lead']);
  });
});
