import {buildBaseWorkflowScope,sourceWorkflowPeriod} from './base-workflow-scope.mjs';

const value=(row,field)=>(row.record_data.cells??[]).find(cell=>cell.fieldName===field)?.text.trim()??'';
const nameKey=text=>String(text??'').normalize('NFKC').trim().replace(/\([\u4e00-\u9fff]{1,3}\)$/u,'').replace(/\s+/gu,'');

/** 当前工作需要本期的正面依据；缺少依据的历史资料保留在历史核对范围。 */
export function reviewCurrentWorkflow(snapshot,supplement,{authoritativeFilename,currentPeriod}) {
  const previous=buildBaseWorkflowScope(snapshot,supplement,{authoritativeFilename,currentPeriod});
  const base=snapshot.history_import_records.filter(row=>row.source_data.format==='feishu-base');
  const main=base.filter(row=>row.source_data.filename===authoritativeFilename);
  const autumn=main.filter(row=>row.record_data.tableName==='2026秋季在读学员表格'&&value(row,'姓名')
    &&(value(row,'26秋在读')==='是'||value(row,'26秋报名模式')==='待报'));
  const autumnIds=new Set(autumn.map(row=>row.id));
  const autumnNames=new Set(autumn.map(row=>nameKey(value(row,'姓名'))));
  const currentSources=new Set(main.filter(row=>autumnIds.has(row.id)
    ||(sourceWorkflowPeriod(row,currentPeriod)??'')>=currentPeriod).map(row=>row.id));
  const terms=new Map(snapshot.school_terms.map(row=>[row.id,row]));
  const students=new Map(snapshot.students.map(row=>[row.id,row]));
  // 现有在班身份用于保护正式课堂；仅姓名相同的其他历史 Lead 不随之进入待办。
  const currentRosterStudents=new Set(snapshot.enrollments.filter(row=>row.status==='active'&&!row.left_at
    &&(!terms.get(row.term_id)?.ends_on||terms.get(row.term_id).ends_on>=`${currentPeriod}-01`)
    &&autumnNames.has(nameKey(students.get(row.student_id)?.name))).map(row=>row.student_id));
  const decisions=previous.decisions.map(row=>{
    const currentSource=row.sourceIds.some(id=>currentSources.has(id));
    const currentRoster=Boolean(row.studentId&&currentRosterStudents.has(row.studentId));
    const current=currentSource||currentRoster||row.native;
    return {...row,hasCurrentEvidence:current,reason:current?null:row.sourceIds.length?'history_review_required':'reference_only'};
  });
  const scopeRows=decisions.filter(row=>row.reason).map(row=>({studentId:row.studentId,leadId:row.leadId,recordId:null,
    reason:row.reason,sourceIds:row.sourceIds,latestPeriod:row.latestPeriod}));
  for(const row of base)if(!currentSources.has(row.id))scopeRows.push({studentId:null,leadId:null,recordId:row.id,
    reason:'history_review_required',sourceIds:[row.id],latestPeriod:sourceWorkflowPeriod(row,currentPeriod)});
  const factScopes=[];
  const activityCurrent=new Map();
  const month=date=>typeof date==='string'&&/^20\d{2}-\d{2}/.test(date)?date.slice(0,7):null;
  const factCurrent=(row,date)=>!row.source_record_id||currentSources.has(row.source_record_id)&&(!month(date)||month(date)>=currentPeriod);
  for(const row of snapshot.activities)activityCurrent.set(row.id,factCurrent(row,row.occurred_on??row.scheduled_at));
  const registrationCurrent=new Map(snapshot.activity_registrations.map(row=>[row.id,activityCurrent.get(row.activity_id)??false]));
  for(const table of ['activities','activity_registrations','assessment_results','course_enrollments','course_opportunities','student_follow_ups','lead_communications']) {
    for(const row of snapshot[table]) {
      if(!row.source_record_id||!currentSources.has(row.source_record_id))continue;
      let current=true;
      if(table==='activities')current=activityCurrent.get(row.id);
      if(table==='activity_registrations')current=registrationCurrent.get(row.id);
      if(table==='assessment_results')current=registrationCurrent.get(row.activity_registration_id)&&factCurrent(row,row.assessed_on);
      if(table==='student_follow_ups'||table==='lead_communications')current=factCurrent(row,row.occurred_on);
      if(table==='course_enrollments') {
        const term=terms.get(row.term_id);const year=row.period_label?.match(/20\d{2}/)?.[0];
        const ended=term?.ends_on&&term.ends_on<`${currentPeriod}-01`
          ||year&&(year<currentPeriod.slice(0,4)||year===currentPeriod.slice(0,4)&&/暑假|春季|寒假/.test(row.period_label));
        current=!ended;
      }
      if(!current)factScopes.push({relation:table,id:row.id,sourceRecordId:row.source_record_id,reason:'history_review_required'});
    }
  }
  const count=(rows,key)=>Object.fromEntries([...rows.reduce((m,row)=>{const k=key(row);m.set(k,(m.get(k)??0)+1);return m;},new Map())]);
  return {version:2,authoritativeFilename,currentPeriod,currentSourceIds:[...currentSources],scopeRows,factScopes,decisions,
    summary:{subjectsBefore:decisions.length,additionalHistoricalSubjects:decisions.filter(row=>row.reason).length,
      currentSubjects:decisions.filter(row=>!row.reason).length,currentSourceRows:currentSources.size,
      protectedCurrentRosterStudents:currentRosterStudents.size,priorFactsOnCurrentSources:factScopes.length,
      additionalByStage:count(decisions.filter(row=>row.reason),row=>row.previousStage),
      currentByPreviousStage:count(decisions.filter(row=>!row.reason),row=>row.previousStage)}};
}
