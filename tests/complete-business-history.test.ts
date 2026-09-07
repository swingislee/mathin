import { describe, expect, it } from 'vitest';
import { buildCompleteBusinessHistory } from '../scripts/lib/complete-business-history.mjs';

function record(tableName: string, values: [string,string][], filename='2026-09-07【思维】用户与产品运营表.base') {
  return {id:'source-row',source_data:{id:'new-file-version',logicalSourceId:'stable-source',filename},match_status:'matched',student_id:'student-a',
    record_data:{tableId:'table-a',tableName,sourceRecordId:'original-row',cells:values.map(([fieldName,text],index)=>({fieldName,fieldId:`f-${index}`,text,kind:'context'}))}};
}
function payload(records:ReturnType<typeof record>[]) { return {records,payloadHash:'source-hash',batchKey:'source-batch'}; }

describe('complete business history projection', () => {
  it('imports explicit paid renewal outcomes even when the narrative is empty', () => {
    const result=buildCompleteBusinessHistory(payload([record('2026暑秋续报数据表',[['续报类型','暑秋连报'],['是否续报','是'],['缴费时间','2026/07/01']])]));
    expect(result.rows.course_opportunities.map((row:{period_key:string;stage:string})=>[row.period_key,row.stage])).toEqual([['summer','enrolled'],['autumn','enrolled']]);
    expect(result.rows.student_follow_ups).toHaveLength(0);
  });
  it('retains an unknown season without assigning it to autumn', () => {
    const result=buildCompleteBusinessHistory(payload([record('2026暑秋续报数据表',[['是否续报','是']])]));
    expect(result.rows.course_opportunities[0]).toMatchObject({period_key:null,term_label:'2026暑秋',stage:'unknown'});
  });
  it('keeps undated historical payments undated and retains the combined course label', () => {
    const result=buildCompleteBusinessHistory(payload([record('【重要】窗口期学员数据',[['报名季节','寒春连报'],['缴费金额','3500']],'2024 11月 寒春续报 学员明细.base')]));
    expect(result.rows.course_enrollments[0]).toMatchObject({registered_on:null,confirmed_at:null,period_label:'寒春连报',amount:3500,amount_original:'3500'});
    expect(result.rows.course_enrollment_assignments[0]).toMatchObject({status:'unknown',class_label:'',teacher_label:''});
  });
  it('leaves ambiguous same-name schedule blocks in the source instead of choosing the first class', () => {
    const result=buildCompleteBusinessHistory(payload([record('学员报名信息',[['报课1','秋季'],['报名日期','2024/09/01'],['缴费金额','1000'],['学期','秋季'],['班型','甲班'],['学期','秋季'],['班型','乙班']],'学员报名.xlsx')]));
    expect(result.rows.course_enrollments[0]).toMatchObject({registered_on:'2024-09-01',amount:1000});
    expect(result.rows.course_enrollment_assignments[0]).toMatchObject({class_label:'',teacher_label:'',schedule_label:''});
  });
  it('preserves existing business versions for the same source row across source file updates', () => {
    const fresh=record('2026暑秋续报数据表',[['续报类型','暑秋连报'],['是否续报','是']]);
    const prior={...fresh,id:'old-source-row',source_data:{...fresh.source_data,id:'stable-source',logicalSourceId:undefined}};
    const result=buildCompleteBusinessHistory(payload([fresh]),[prior]);
    expect(result.skippedExistingSourceIds).toEqual(['source-row']);
    expect(Object.values(result.counts).every(count=>count===0)).toBe(true);
  });
});
