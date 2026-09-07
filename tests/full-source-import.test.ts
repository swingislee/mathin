import { describe, expect, it } from 'vitest';
import { buildCompleteSourcePayload } from '../scripts/lib/full-source-import.mjs';

function source(count = 1, filename = '学生资料.xlsx') {
  const source = { id:'source-a', sha256:'a'.repeat(64), format:'xlsx', filename };
  return { source, warnings:[], tables:[{id:'table',name:'学员表',rowCount:count,contentRowCount:count-1}],
    records:Array.from({length:count}, (_, i) => ({id:`row-${i}`,sourceId:source.id,tableId:'table',tableName:'学员表',sourceRecordId:`${i}`,
      sourceRow:i+1,label:'同名孩子',names:['同名孩子'],phones:[] as string[],dateLabel:null,hasContent:i>0,warnings:[],links:[],
      cells:[{fieldId:'name',fieldName:'姓名',type:'Text',kind:'identity',text:'同名孩子',rawValue:{text:'同名孩子',original:true}}] })) };
}
const tables = { students:[{id:'student-a',name:'同名孩子',phone:'13800000000',grade:3}],
  data_import_batches:[{id:'batch',status:'completed',source_system:'mofaxiao',import_kind:'students'}],
  data_import_rows:[{batch_id:'batch',row_status:'inserted',normalized_key:'mofaxiao:id:1001',target_id:'student-a'}] };
function input(count = 1, filename?: string) {
  return { packages:[source(count,filename)],files:[{path:filename??'学生资料.xlsx',sha256:'a'.repeat(64),bytes:3,contentBase64:'YWJj',metadata:{}}],
    tables,sourceAt:'2026-09-07T00:00:00Z' };
}

describe('complete source import', () => {
  it('retains every row beyond the pilot limit, including blank rows and raw values', () => {
    const value=input(503), before=structuredClone(value);
    const payload=buildCompleteSourcePayload(value);
    expect(payload.records).toHaveLength(503);
    expect(payload.manifest.summary).toMatchObject({recordCount:503,contentRecordCount:502,reviewCount:502});
    expect(payload.records.find(row=>row.id==='row-0')?.record_data.hasContent).toBe(false);
    expect(payload.records[0].record_data.cells[0].rawValue).toEqual({text:'同名孩子',original:true});
    expect(value).toEqual(before);
  });
  it('retains candidates without turning a name-only guess into a student association', () => {
    const payload=buildCompleteSourcePayload(input(2));
    expect(payload.records[1]).toMatchObject({match_status:'review',student_id:null,lead_id:null,entity_data:null});
    expect(payload.records[1].candidate_data).toHaveLength(1);
    expect(payload.manifest.deferredAssociation).toBe(true);
    expect(buildCompleteSourcePayload(input(2)).payloadHash).toBe(payload.payloadHash);
  });
  it('keeps staff source records out of student and lead identity matching even when name and phone match', () => {
    const value=input(2,'员工管理.xlsx');
    value.packages[0].records[1].phones=['13800000000'];
    const payload=buildCompleteSourcePayload(value);
    expect(payload.records.every(row=>row.student_id===null&&row.lead_id===null&&row.candidate_data.length===0)).toBe(true);
    expect(payload.records[1].match_data.reason).toBe('non_student_source');
    expect(payload.records[1].record_data.names).toEqual(['同名孩子']);
  });
  it('rejects duplicate record IDs and detects a changed original value', () => {
    const value=input(2), original=buildCompleteSourcePayload(value);
    value.packages[0].records[1].cells[0].rawValue.original=false;
    expect(buildCompleteSourcePayload(value).payloadHash).not.toBe(original.payloadHash);
    value.packages[0].records[1].id='row-0';
    expect(()=>buildCompleteSourcePayload(value)).toThrow('FULL_SOURCE_DUPLICATE_RECORD');
  });
});
