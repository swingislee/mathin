import {describe,expect,it} from 'vitest';
import {buildBaseWorkflowScope,sourceWorkflowPeriod} from '../scripts/lib/base-workflow-scope.mjs';

const filename='source.base';
type ScopeRow={studentId:string|null;recordId:string|null;reason:string};
const source=(id:string,studentId:string,cells:Record<string,string>,table='获客&私域信息登记表1.0-总')=>({id,student_id:studentId,lead_id:null,
  source_data:{format:'feishu-base',filename},record_data:{tableName:table,cells:Object.entries(cells).map(([fieldName,text])=>({fieldName,text}))}});
function fixture() {
  const students=['reference','past','unknown','current','autumn','native'].map(id=>({id,name:id,phone:'',parent_phone:'',status:'lead'}));
  const snapshot={capturedAt:'2026-09-08T00:00:00Z',students,
    stages:students.map(row=>({key:`student:${row.id}`,student_id:row.id,lead_id:null,stage:'awaiting_first_contact'})),
    history_import_records:[source('past-source','past',{'获取月份':'8月','跟进信息':'已联系，等待下一轮'}),
      source('unknown-source','unknown',{'获取月份':'8月','跟进结果':'暂无'}),
      source('current-source','current',{'确认月份':'9月','确认结果':'未通'}),
      source('autumn-source','autumn',{'姓名':'autumn','26秋在读':'是'},'2026秋季在读学员表格')],
    leads:[] as {id:string;student_id:string}[],lead_source_records:[],lead_invitation_threads:[],history_import_associations:[],lead_communications:[],
    activity_registrations:[],activities:[],assessment_results:[],course_enrollments:[],enrollments:[],
    course_opportunities:[],student_follow_ups:[]};
  const supplement={students:[{id:'native',hasUser:true}],batches:[{id:'batch',import_kind:'students'}],
    rows:students.map(row=>({batch_id:'batch',row_status:'inserted',target_id:row.id})),nextActions:[] as {lead_id:string;status:string;kind:string}[]};
  return {snapshot,supplement};
}
describe('Base current workflow scope',()=>{
  it('separates reference identities and processed prior periods while protecting current and native work',()=>{
    const {snapshot,supplement}=fixture();const before=structuredClone(snapshot);
    const plan=buildBaseWorkflowScope(snapshot,supplement,{authoritativeFilename:filename,currentPeriod:'2026-09'});
    expect(plan.scopeRows.filter((row:ScopeRow)=>row.studentId).map((row:ScopeRow)=>[row.studentId,row.reason]))
      .toEqual([['reference','reference_only'],['past','processed_prior_period']]);
    expect(plan.scopeRows.filter((row:ScopeRow)=>row.recordId).map((row:ScopeRow)=>row.recordId)).toEqual(['past-source']);
    expect(snapshot).toEqual(before);
  });
  it('keeps native follow-up and an explicit open reminder even for a prior-period source',()=>{
    const {snapshot,supplement}=fixture();
    snapshot.leads=[{id:'lead',student_id:'past'}];
    supplement.nextActions=[{lead_id:'lead',status:'open',kind:'callback'}];
    const plan=buildBaseWorkflowScope(snapshot,supplement,{authoritativeFilename:filename,currentPeriod:'2026-09'});
    expect(plan.scopeRows.some((row:ScopeRow)=>row.studentId==='past')).toBe(false);
  });
  it('preserves month precision and retains sources with no known period',()=>{
    const row=source('one','past',{'获取月份':'8月','跟进信息':'已经处理'});const before=structuredClone(row);
    expect(sourceWorkflowPeriod(row,'2026-09')).toBe('2026-08');
    expect(sourceWorkflowPeriod(source('two','past',{'跟进信息':'已经处理'}),'2026-09')).toBeNull();
    expect(sourceWorkflowPeriod(source('three','past',{'获取月份':'12月'}),'2026-09')).toBe('2025-12');
    expect(row).toEqual(before);
  });
});
