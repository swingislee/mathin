import {describe,expect,it} from 'vitest';
import {reviewCurrentWorkflow} from '../scripts/lib/current-workflow-review.mjs';
import {sourceWorkflowPeriod} from '../scripts/lib/base-workflow-scope.mjs';
import {businessRecordStateFilter,matchesBusinessRecordState} from '../src/features/school/business-record-state-contract';

const options={authoritativeFilename:'current.base',currentPeriod:'2026-09'};
type Row=Record<string,unknown>;
type Decision={studentId:string|null;leadId:string|null;reason:string|null};
type Plan={decisions:Decision[];scopeRows:{studentId:string|null;recordId:string|null;reason:string}[];factScopes:{id:string}[];currentSourceIds:string[]};
const review=(snapshot:Row,supplement:Row)=>reviewCurrentWorkflow(snapshot,supplement,options) as Plan;
const source=(id:string,studentId:string|null,cells:Record<string,string>,tableName='获客&私域信息登记表1.0-总',filename='current.base')=>({id,student_id:studentId,
  source_data:{format:'feishu-base',filename},record_data:{tableName,cells:Object.entries(cells).map(([fieldName,text])=>({fieldName,text}))}});
function fixture(){
  const students=['current','unknown','autumn','reference'].map(id=>({id,name:id,phone:'',parent_phone:'',status:'lead'}));
  return {snapshot:{capturedAt:'2026-09-08T00:00:00Z',students,stages:students.map(row=>({key:`student:${row.id}`,student_id:row.id,lead_id:null,stage:'awaiting_first_contact'})) as Row[],
    history_import_records:[source('new','current',{'获取月份':'9月'}),source('missing','unknown',{}),
      source('roster','autumn',{'姓名':'autumn','26秋在读':'是'},'2026秋季在读学员表格')],
    leads:[] as Row[],lead_source_records:[],lead_invitation_threads:[],history_import_associations:[],lead_communications:[] as Row[],
    activities:[] as Row[],activity_registrations:[] as Row[],assessment_results:[] as Row[],course_enrollments:[],enrollments:[] as Row[],school_terms:[] as Row[],
    course_opportunities:[],student_follow_ups:[]},supplement:{students:[],batches:[],rows:[],nextActions:[] as Row[]}};
}
describe('current work separated from preserved history',()=>{
  it('requires current evidence for undated imports and preserves the complete input',()=>{
    const {snapshot,supplement}=fixture(),before=structuredClone(snapshot);
    const plan=review(snapshot,supplement);
    expect(plan.decisions.filter(row=>!row.reason).map(row=>row.studentId)).toEqual(['current','autumn']);
    expect(plan.scopeRows.find(row=>row.studentId==='unknown')?.reason).toBe('history_review_required');
    expect(snapshot).toEqual(before);
  });
  it('keeps an actual open reminder but excludes an automatic initial-contact reminder',()=>{
    const {snapshot,supplement}=fixture();snapshot.leads.push({id:'lead',student_id:'unknown'});
    for(const kind of ['callback','initial_contact']){
      supplement.nextActions=[{lead_id:'lead',kind,status:'open'}];
      const decision=review(snapshot,supplement).decisions.find(row=>row.studentId==='unknown');
      expect(Boolean(decision?.reason)).toBe(kind==='initial_contact');
    }
  });
  it('keeps the actual active roster identity without reviving same-name historical leads',()=>{
    const {snapshot,supplement}=fixture();
    snapshot.students.find(row=>row.id==='reference')!.name='autumn';
    snapshot.enrollments=[{id:'member',student_id:'reference',status:'active',left_at:null,term_id:'term'}];
    snapshot.school_terms=[{id:'term',ends_on:'2027-01-31'}];
    snapshot.leads=[{id:'old-lead',provisional_student_name:'autumn',student_id:null,source_record_id:'old'}];
    snapshot.stages.push({key:'lead:old-lead',student_id:null,lead_id:'old-lead',stage:'awaiting_first_contact'});
    snapshot.history_import_records.push(source('old',null,{'姓名':'autumn','获取月份':'8月'}));
    const plan=review(snapshot,supplement);
    expect(plan.decisions.find(row=>row.studentId==='reference')?.reason).toBeNull();
    expect(plan.decisions.find(row=>row.leadId==='old-lead')?.reason).toBe('history_review_required');
  });
  it('keeps old business facts historical even when the same source contains a September follow-up',()=>{
    const {snapshot,supplement}=fixture();
    snapshot.activities=[{id:'visit',source_record_id:'new',occurred_on:'2026-08-20'}];
    snapshot.activity_registrations=[{id:'registration',source_record_id:'new',activity_id:'visit',student_id:'current'}];
    snapshot.assessment_results=[{id:'assessment',source_record_id:'new',activity_registration_id:'registration',assessed_on:'2026-08-20'}];
    snapshot.lead_communications=[{id:'contact',source_record_id:'new',occurred_on:'2026-09-02'}];
    const plan=review(snapshot,supplement);
    expect(plan.factScopes.map(row=>row.id)).toEqual(['visit','registration','assessment']);
    expect(plan.currentSourceIds).toContain('new');
  });
  it('uses the primary Base and retains current autumn enrollments with unconfirmed identity',()=>{
    const {snapshot,supplement}=fixture();
    snapshot.history_import_records.push(source('pending-id',null,{'姓名':'new autumn','26秋报名模式':'待报'},'2026秋季在读学员表格'));
    snapshot.history_import_records.push(source('prior-base',null,{'获取月份':'9月'},'获客&私域信息登记表1.0-总','older.base'));
    const plan=review(snapshot,supplement);
    expect(plan.currentSourceIds).toContain('pending-id');
    expect(plan.scopeRows.find(row=>row.recordId==='prior-base')).toBeDefined();
  });
  it('uses an explicit year before a matching month label',()=>{
    expect(sourceWorkflowPeriod(source('old',null,{'获取日期':'2024-09-03','获取月份':'9月'}),'2026-09')).toBe('2024-09');
  });
  it('defaults invalid or missing scope to current and preserves explicit history/all requests',()=>{
    expect([undefined,'invalid',[],['historical'],'all'].map(businessRecordStateFilter)).toEqual(['current','current','current','historical','all']);
    expect(matchesBusinessRecordState('historical','current')).toBe(false);
    expect(matchesBusinessRecordState('current','historical')).toBe(false);
    expect(matchesBusinessRecordState('historical','all')).toBe(true);
    expect(matchesBusinessRecordState(undefined,'current')).toBe(true);
  });
});
