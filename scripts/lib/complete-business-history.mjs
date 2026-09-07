import { createHash } from 'node:crypto';
import { buildStudentBusinessHistory, historicalDate, historyFieldName } from './student-business-history.mjs';
import { historyPayloadHash } from './history-import-trial.mjs';

export const COMPLETE_HISTORY_TABLES = ['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups'];
const uuid = key => { const hash=createHash('md5').update(key).digest('hex');return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`; };
const cell = (source,name) => source.record_data.cells.find(item=>historyFieldName(item.fieldName)===name);
const value = (source,name) => cell(source,name)?.text.trim()??'';
const fields = (source,names) => source.record_data.cells.filter(item=>names.includes(historyFieldName(item.fieldName))).map(item=>item.fieldId);
export const sourceLineage = source => JSON.stringify([source.source_data.logicalSourceId??source.source_data.id,source.record_data.tableId,source.record_data.sourceRecordId]);

/** 完整原文已入库；明确字段归入现有业务表，已有人工修订的来源保持原有业务版本。 */
export function buildCompleteBusinessHistory(payload, priorSources=[]) {
  const prior = new Set(priorSources.map(sourceLineage));
  const byStudent = new Map();
  const skipped = [];
  for(const record of payload.records) {
    if(!record.student_id||record.match_status!=='matched')continue;
    if(prior.has(sourceLineage(record))){skipped.push(record.id);continue;}
    const rows=byStudent.get(record.student_id)??[];rows.push(record);byStudent.set(record.student_id,rows);
  }
  const rows=Object.fromEntries(COMPLETE_HISTORY_TABLES.map(table=>[table,[]]));
  const add=(table,key,sourceId,fieldIds,data)=> {
    if(!fieldIds.length)throw new Error('COMPLETE_BUSINESS_FIELD_EVIDENCE');
    const row={id:uuid(key),history_key:key,source_record_id:sourceId,source_field_ids:[...new Set(fieldIds)],...data};
    row.source_payload_sha256=historyPayloadHash(row);rows[table].push(row);return row.id;
  };
  for(const [studentId,records] of byStudent) {
    const sourceMap=new Map(records.map(source=>[source.id,source]));
    const converted=buildStudentBusinessHistory({manifest:{mode:'local_family_audit',subject:{studentId}},records,payloadHash:payload.payloadHash}).rows;
    for(const record of converted.student_activity_history) {
      const activityId=add('activities',`${record.id}:activity`,record.source_record_id,record.source_field_ids,{kind:record.activity_kind,title:record.activity_name,scheduled_at:null,occurred_on:record.occurred_on});
      add('activity_registrations',record.id,record.source_record_id,record.source_field_ids,{student_id:studentId,activity_id:activityId,status:record.participation_status==='attended'?'attended':'booked',registered_on:record.registered_on,
        reported_result:record.reported_result,result_link_status:record.result_link_status,result_source_record_id:record.result_source_record_id,result_field_ids:record.result_field_ids});
    }
    for(const record of converted.student_assessment_history) {
      const activityId=add('activities',`${record.id}:activity`,record.source_record_id,record.source_field_ids,{kind:'assessment_1v1',title:'1 对 1 测评',scheduled_at:null,occurred_on:record.assessed_on});
      const registrationId=add('activity_registrations',`${record.id}:registration`,record.source_record_id,record.source_field_ids,{student_id:studentId,activity_id:activityId,status:'attended',registered_on:null});
      const bands={'A+':'a_plus',A:'a',S:'s',C:'c','G+':'g_plus','X+':'x_plus','未达A':'below_a'};
      add('assessment_results',record.id,record.source_record_id,record.source_field_ids,{student_id:studentId,activity_registration_id:registrationId,
        assessment_band:bands[record.assessment_band]??null,assessed_on:record.assessed_on,score:record.score,strengths:record.learning_notes,parent_concerns:record.parent_notes});
    }
    for(const record of converted.student_enrollment_history) {
      const source=sourceMap.get(record.source_record_id);
      // 同名学期多次出现时，仅保留报名本身；课表对应关系留在来源中待业务使用时确认。
      const schedules=source.record_data.cells.filter(item=>historyFieldName(item.fieldName)==='学期'&&item.text.trim()===record.period_label);
      const unambiguous=schedules.length===1;
      const id=add('course_enrollments',record.id,record.source_record_id,record.source_field_ids,{student_id:studentId,status:'active',confirmed_at:null,
        registered_on:record.registered_on,period_label:record.period_label,amount:record.amount,amount_original:record.amount_original});
      add('course_enrollment_assignments',`${record.id}:assignment`,record.source_record_id,record.source_field_ids,{course_enrollment_id:id,status:'unknown',assigned_at:null,
        class_label:unambiguous?record.class_label:'',teacher_label:unambiguous?record.teacher_label:'',room_label:unambiguous?record.room_label:'',schedule_label:unambiguous?record.schedule_label:''});
    }
    for(const record of converted.student_communication_history) add('student_follow_ups',record.id,record.source_record_id,record.source_field_ids,
      {student_id:studentId,content:record.content,kind:'note',occurred_on:record.occurred_on,context_kind:record.context_kind,author_label:record.author_label,date_basis:record.date_basis});
    for(const source of records.filter(record=>/^\d{4}暑秋续报数据表$/u.test(record.record_data.tableName))) {
      const kind=value(source,'续报类型'),outcome=value(source,'是否续报'),paid=value(source,'缴费时间'),note=value(source,'未报/连报情况');
      if(!kind&&!outcome&&!paid&&!note)continue;
      const legacy=converted.student_renewal_history.filter(record=>record.source_record_id===source.id);
      const periods=[...new Set([...(/暑/u.test(kind)?['summer']:[]),...(/秋/u.test(kind)?['autumn']:[]),...legacy.map(record=>record.period_key)])];
      if(!periods.length)periods.push(null);
      for(const period of periods) {
        const original=legacy.find(record=>record.period_key===period);
        const label=period==='summer'?'暑假':period==='autumn'?'秋季':'暑秋';
        add('course_opportunities',`source-renewal:${historyPayloadHash([source.id,period])}`,source.id,fields(source,['续报类型','是否续报','缴费时间','未报/连报情况','春季班型','带课老师']),
          {student_id:studentId,opportunity_type:'renewal',stage:outcome==='是'&&((period==='summer'&&/暑/u.test(kind))||(period==='autumn'&&/秋/u.test(kind)))?'enrolled':'unknown',
            note:original?.decision_note??note,period_year:Number(source.record_data.tableName.slice(0,4)),period_key:period,
            term_label:`${source.record_data.tableName.slice(0,4)}${label}`,class_label:value(source,'春季班型'),teacher_label:value(source,'带课老师')});
      }
    }
    for(const source of records.filter(record=>record.source_data.filename==='2024 11月 寒春续报 学员明细.base')) {
      const period=value(source,'报名季节'),paid=value(source,'缴费时间'),amount=value(source,'缴费金额');
      if(!period&&!paid&&!amount)continue;
      const evidence=fields(source,['报名季节','缴费时间','缴费金额','缴费方式','班级','授课教师','备注']);
      const key=`source-enrollment:${historyPayloadHash(source.id)}`;
      const id=add('course_enrollments',key,source.id,evidence,{student_id:studentId,status:'active',confirmed_at:null,registered_on:historicalDate(paid),
        period_label:period||'寒春（学期未注明）',amount:/^\d{1,12}(\.\d{1,2})?$/u.test(amount)?Number(amount):null,amount_original:amount});
      add('course_enrollment_assignments',`${key}:assignment`,source.id,evidence,{course_enrollment_id:id,status:'unknown',assigned_at:null,class_label:value(source,'班级')||value(source,'班型'),teacher_label:value(source,'授课教师'),room_label:'',schedule_label:''});
      if(value(source,'备注'))add('student_follow_ups',`${key}:note`,source.id,fields(source,['备注']),{student_id:studentId,content:value(source,'备注'),kind:'note',occurred_on:null,context_kind:'renewal',author_label:null,date_basis:'unknown'});
    }
    for(const source of records.filter(record=>record.record_data.tableName==='获客&私域信息登记表1.0-总')) {
      const names=['跟进信息','沟通情况','确认信息备注','真题拼团沟通'];
      const notes=names.flatMap(name=>value(source,name)?[`${name}：${value(source,name)}`]:[]);
      if(notes.length)add('student_follow_ups',`source-note:${historyPayloadHash(source.id)}`,source.id,fields(source,names),
        {student_id:studentId,content:notes.join('\n\n'),kind:'note',occurred_on:null,context_kind:null,author_label:null,date_basis:'unknown'});
    }
  }
  return {schemaVersion:1,sourceBatchKey:payload.batchKey,sourcePayloadHash:payload.payloadHash,rows,
    counts:Object.fromEntries(Object.entries(rows).map(([table,records])=>[table,records.length])),skippedExistingSourceIds:skipped};
}
