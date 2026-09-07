import {analyzeStudentStageSnapshot} from './student-stage-audit.mjs';

const value=(row,field)=>(row.record_data.cells??[]).find(cell=>cell.fieldName===field)?.text.trim()??'';
const nameKey=text=>String(text??'').normalize('NFKC').trim().replace(/\([\u4e00-\u9fff]{1,3}\)$/u,'').replace(/\s+/gu,'');
const isBase=row=>row?.source_data.format==='feishu-base';
const processingFields=['跟进结果','确认结果','跟进信息','确认信息备注','沟通情况','真题拼团沟通','跟进日期','确认日期'];
const businessDates=['获取日期','跟进日期','确认日期','到访日期','体/测日期','报名日期','报名缴费日期','缴费时间','补续日期','参加选拔产品日期','报名选拔产品日期'];
const businessMonths=['获取月份','跟进月份','确认月份','到访月份','报名月份'];

/** 月份只决定工作资料所属期间，保留原始日期及其精度。 */
export function sourceWorkflowPeriod(row,currentPeriod) {
  const [year,month]=currentPeriod.split('-').map(Number);
  const periods=[];
  for(const field of businessDates) {
    const text=value(row,field);
    const match=text.match(/^(20\d{2})[./-](\d{1,2})(?:[./-]|$)/u)??text.match(/^(20\d{2})(\d{2})\d{2}(?:$|\D)/u);
    if(match&&Number(match[2])>=1&&Number(match[2])<=12)periods.push(`${match[1]}-${match[2].padStart(2,'0')}`);
  }
  for(const field of businessMonths) {
    const match=value(row,field).match(/^(1[0-2]|[1-9])月$/u);
    if(match)periods.push(`${Number(match[1])>month?year-1:year}-${match[1].padStart(2,'0')}`);
  }
  // 历年窗口表的文件年份与期次只用于历史归属，不生成发生日期。
  if(!periods.length&&/^20\d{2}/u.test(row.source_data.filename)&&!row.source_data.filename.startsWith(`${year}-`)) {
    const oldYear=Number(row.source_data.filename.slice(0,4));
    if(oldYear<year)periods.push(`${oldYear}-12`);
  }
  return periods.sort().at(-1)??null;
}

export function sourceHasProcessing(row) {
  const table=row.record_data.tableName??'';
  if(table==='获客&私域信息登记表1.0-总')return processingFields.some(field=>{
    const text=value(row,field);
    return Boolean(text)&&!['暂无结果','暂无','无','未跟进','未确认','-','—'].includes(text);
  });
  if(['到访数据与信息表1.0-总','（老数据）各选拔产品协作信息表-总'].includes(table)) {
    return ['确认日期','到访日期','体/测日期','报名日期','思维测评等级','测评成绩（分数）','学员情况','家长情况','家长沟通信息总结（附整理文档）'].some(field=>Boolean(value(row,field)))
      ||['已到','未到'].includes(value(row,'到访与否'))||['已报名','未报名'].includes(value(row,'报名与否'));
  }
  if(/续报|窗口期/u.test(table))return ['续报与否','是否续报','续报与近期新报情况','缴费时间','报名缴费日期','用户沟通情况（授课老师填写项）','用户运营情况（学服老师填写项）'].some(field=>Boolean(value(row,field)));
  return table==='袋鼠报名与备考信息表'&&Boolean(value(row,'报名日期'));
}

/** 已确认的业务主表形成当前工作范围；参考身份与旧月已处理资料保留原记录。 */
export function buildBaseWorkflowScope(snapshot,supplement,{authoritativeFilename,currentPeriod}) {
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/u.test(currentPeriod))throw new Error('CURRENT_PERIOD_REQUIRED');
  const audit=analyzeStudentStageSnapshot(snapshot);
  const sources=new Map(snapshot.history_import_records.map(row=>[row.id,row]));
  const main=[...sources.values()].filter(row=>row.source_data.filename===authoritativeFilename&&isBase(row));
  if(!main.length)throw new Error('AUTHORITATIVE_BASE_REQUIRED');
  const currentAutumn=main.filter(row=>row.record_data.tableName==='2026秋季在读学员表格'&&value(row,'姓名')
    &&(value(row,'26秋在读')==='是'||value(row,'26秋报名模式')==='待报'));
  const autumnNames=new Set(currentAutumn.map(row=>nameKey(value(row,'姓名'))));
  const associations=new Map(snapshot.history_import_associations.map(row=>[row.record_id,row.student_id]));
  const autumnStudents=new Set(currentAutumn.flatMap(row=>[associations.get(row.id),row.student_id].filter(Boolean)));
  const rowsByStudent=new Map(snapshot.students.map(row=>[row.id,row]));
  const leadKeys=new Map(snapshot.leads.map(row=>[row.id,row.student_id?`student:${row.student_id}`:`lead:${row.id}`]));
  const nativeSubjects=new Set((supplement.students??[]).filter(row=>row.hasUser||row.hasBindingUse).map(row=>`student:${row.id}`));
  for(const table of ['lead_communications','activity_registrations','assessment_results','course_enrollments','course_opportunities','student_follow_ups']) {
    for(const row of snapshot[table]??[]) {
      if(row.source_record_id)continue;
      if(row.student_id)nativeSubjects.add(`student:${row.student_id}`);
      if(row.lead_id&&leadKeys.has(row.lead_id))nativeSubjects.add(leadKeys.get(row.lead_id));
    }
  }
  for(const row of supplement.nextActions??[])if(row.status==='open'&&row.kind!=='initial_contact'&&leadKeys.has(row.lead_id))nativeSubjects.add(leadKeys.get(row.lead_id));
  for(const row of snapshot.lead_invitation_threads??[])if(!['completed','cancelled'].includes(row.state)&&leadKeys.has(row.lead_id))nativeSubjects.add(leadKeys.get(row.lead_id));
  const batchById=new Map(supplement.batches.map(row=>[row.id,row]));
  const importedStudents=new Set(supplement.rows.filter(row=>row.row_status==='inserted'&&batchById.get(row.batch_id)?.import_kind==='students').map(row=>row.target_id));
  const importedMemberships=new Set(supplement.rows.filter(row=>row.row_status==='inserted'&&batchById.get(row.batch_id)?.import_kind==='enrollments').map(row=>row.target_id));
  const importedLeads=new Set(snapshot.lead_source_records.map(row=>row.lead_id));
  for(const row of snapshot.enrollments) {
    if(importedMemberships.has(row.id))importedStudents.add(row.student_id);
    else nativeSubjects.add(`student:${row.student_id}`);
  }
  for(const row of snapshot.leads)if(row.source_record_id)importedLeads.add(row.id);
  const scopeRows=[];
  const decisions=[];
  for(const subject of audit.rows) {
    const sourceRows=subject.sourceIds.map(id=>sources.get(id)).filter(Boolean);
    const baseRows=sourceRows.filter(isBase);
    const periods=baseRows.map(row=>sourceWorkflowPeriod(row,currentPeriod)).filter(Boolean);
    const latestPeriod=periods.sort().at(-1)??null;
    const hasProcessing=baseRows.some(sourceHasProcessing);
    const currentAutumnCandidate=autumnStudents.has(subject.studentId)||autumnNames.has(nameKey(subject.name));
    const hasCurrentEvidence=currentAutumnCandidate||latestPeriod!==null&&latestPeriod>=currentPeriod;
    const native=nativeSubjects.has(subject.key);
    const imported=subject.studentId?importedStudents.has(subject.studentId):importedLeads.has(subject.leadId);
    let reason=null;
    if(imported&&!native&&!hasCurrentEvidence) {
      if(!baseRows.length)reason='reference_only';
      else if(hasProcessing&&latestPeriod!==null&&latestPeriod<currentPeriod)reason='processed_prior_period';
    }
    const decision={key:subject.key,studentId:subject.studentId,leadId:subject.studentId?null:subject.leadId,
      sourceIds:baseRows.map(row=>row.id),reason,latestPeriod,hasProcessing,hasCurrentEvidence,native,
      previousStage:subject.stage,bucket:subject.bucket};
    decisions.push(decision);
    if(reason)scopeRows.push({studentId:decision.studentId,leadId:decision.leadId,recordId:null,reason,sourceIds:decision.sourceIds,latestPeriod});
  }
  // 来源行本身的期间决定历史业务是否进入当前工作表；同人本期新业务仍单独保留。
  for(const row of main) {
    const latestPeriod=sourceWorkflowPeriod(row,currentPeriod);
    if(row.record_data.tableName!=='2026秋季在读学员表格'&&sourceHasProcessing(row)&&latestPeriod&&latestPeriod<currentPeriod) {
      scopeRows.push({studentId:null,leadId:null,recordId:row.id,reason:'processed_prior_period',sourceIds:[row.id],latestPeriod});
    }
  }
  const excludedKeys=new Set(decisions.filter(row=>row.reason).map(row=>row.key));
  const active=decisions.filter(row=>!row.reason);
  const count=(rows,key)=>Object.fromEntries([...new Set(rows.map(key))].map(value=>[value,rows.filter(row=>key(row)===value).length]));
  const summary={subjects:decisions.length,excludedSubjects:excludedKeys.size,currentSubjects:active.length,
    byReason:count(decisions.filter(row=>row.reason),row=>`${row.studentId?'student':'lead'}|${row.reason}`),
    firstContactBefore:decisions.filter(row=>row.previousStage==='awaiting_first_contact').length,
    firstContactAfter:active.filter(row=>row.previousStage==='awaiting_first_contact').length,
    currentByStage:count(active,row=>row.previousStage),historicalSourceRows:scopeRows.filter(row=>row.recordId).length,
    protectedCurrentAutumn:currentAutumn.length,protectedNativeSubjects:decisions.filter(row=>row.native).length,
    remainingFirstContactBuckets:count(active.filter(row=>row.previousStage==='awaiting_first_contact'),row=>row.bucket)};
  if(scopeRows.some(row=>row.studentId&&!rowsByStudent.has(row.studentId)))throw new Error('UNKNOWN_SCOPE_STUDENT');
  return {version:1,authoritativeFilename,currentPeriod,summary,scopeRows,decisions};
}
