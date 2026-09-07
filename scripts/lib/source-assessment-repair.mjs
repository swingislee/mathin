import {historyFieldName,historicalDate} from './student-business-history.mjs';
import {isDeepStrictEqual} from 'node:util';
import {createImportUuid} from './import-uuid.mjs';
import {historyPayloadHash} from './history-import-trial.mjs';
import {sourceEnrollmentFacts,sourceVisitParticipation,mergeSourceNotes} from '../../src/features/school/business-source-contract.ts';

export const SOURCE_REPAIR_TABLES=['leads','activity_registrations','assessment_results','course_enrollments'];
const field=(row,name)=>row.record_data.cells.find(cell=>historyFieldName(cell.fieldName)===name)?.text.trim()??'';
const date=(row,...names)=>names.map(name=>historicalDate(field(row,name))).find(Boolean)??null;
const visitTables=new Set(['到访数据与信息表1.0-总','（老数据）各选拔产品协作信息表-总']);

/** 只修正明确来源事实；身份和跨表报名日期使用本次确认的精确清单。 */
export function buildSourceAssessmentRepair(snapshot,{associations=[],enrollmentDates=[],actorId=null}={}) {
  const sourceById=new Map(snapshot.history_import_records.map(row=>[row.id,row]));
  const patches=new Map(),inserts=[],skipped=[],confirmedAssociations=[];
  const id=createImportUuid((snapshot.assessment_results??[]).map(row=>row.id));
  const patch=(table,row,changes,reason)=>{
    const key=`${table}:${row.id}`;
    const prior=patches.get(key);
    const next={...prior?.changes,...changes};
    for(const [column,value] of Object.entries(next))if(isDeepStrictEqual(row[column]??null,value))delete next[column];
    if(!Object.keys(next).length)return;
    patches.set(key,{table,id:row.id,before:row,changes:next,reasons:[...new Set([...(prior?.reasons??[]),reason])]});
  };
  const binding=new Map((snapshot.history_import_associations??[]).map(row=>[row.record_id,row.student_id]));
  for(const decision of associations){
    const source=sourceById.get(decision.recordId);
    const student=snapshot.students.find(row=>row.id===decision.studentId&&!row.deleted_at);
    if(!source||!student||source.record_data.names.length!==1||source.record_data.names[0]!==student.name
      ||!(snapshot.history_import_identity_candidates??[]).some(row=>row.record_id===source.id&&row.student_id===student.id))throw new Error('CONFIRMED_SOURCE_CANDIDATE_MISMATCH');
    if(source.student_id&&source.student_id!==student.id||binding.has(source.id)&&binding.get(source.id)!==student.id)throw new Error('SOURCE_ALREADY_LINKED_ELSEWHERE');
    if(!source.student_id&&!binding.has(source.id))confirmedAssociations.push({recordId:source.id,studentId:student.id,expectedVersion:0});
    binding.set(source.id,student.id);
    for(const lead of snapshot.leads.filter(row=>row.source_record_id===source.id)){
      if(lead.student_id&&lead.student_id!==student.id)throw new Error('LEAD_ALREADY_LINKED_ELSEWHERE');
      if(!lead.student_id){
        if(!actorId)throw new Error('REPAIR_ACTOR_REQUIRED');
        patch('leads',lead,{student_id:student.id,status:'converted',identity_confirmed_by:actorId},'confirmed_source_identity');
      }
    }
  }
  for(const registration of snapshot.activity_registrations){
    const source=sourceById.get(registration.source_record_id);
    if(!source||!visitTables.has(source.record_data.tableName))continue;
    if(registration.history_revision>0){skipped.push({table:'activity_registrations',id:registration.id,reason:'manual_revision'});continue;}
    const assessment=snapshot.assessment_results.find(row=>row.activity_registration_id===registration.id);
    const protectedWork=registration.assessment_started_at||registration.assessment_completed_at
      ||(snapshot.assessment_workflows??[]).some(row=>row.registration_id===registration.id)
      ||(snapshot.assessment_quick_entries??[]).some(row=>row.registration_id===registration.id)
      ||assessment&&assessment.result_source!=='legacy';
    const content=field(source,'参与内容')||field(source,'选拔产品项目');
    const expected=sourceVisitParticipation(content,field(source,'到访与否')||field(source,'学员出勤情况'),field(source,'思维测评等级'),field(source,'学习力测评等级'),field(source,'测评成绩（分数）'));
    const facts=sourceEnrollmentFacts(field(source,'报名与否'),field(source,'班型'),date(source,'报名日期'));
    const changes={source_enrollment_facts:facts};
    if(registration.status==='booked'&&!protectedWork&&expected!=='booked')changes.status=expected;
    patch('activity_registrations',registration,changes,'source_enrollment_and_attendance');
    const effectiveStatus=changes.status??registration.status;
    const activity=snapshot.activities?.find(row=>row.id===registration.activity_id);
    if(!facts?.assessmentBand||field(source,'思维测评等级')||effectiveStatus!=='attended'||protectedWork||activity?.kind!=='assessment_1v1')continue;
    if(assessment){
      if(assessment.history_revision===0&&!assessment.assessment_band)
        patch('assessment_results',assessment,{assessment_band:facts.assessmentBand,strengths:mergeSourceNotes(assessment.strengths,'测评等级依据：报名班型')},'class_band_correspondence');
    }else{
      const key=`operation-visit:${source.id}:assessment_1v1:result`;
      const row={id:id(key),activity_registration_id:registration.id,student_id:registration.student_id??binding.get(source.id)??null,
        lead_id:registration.student_id||binding.has(source.id)?null:registration.lead_id,assessment_band:facts.assessmentBand,
        assessed_on:date(source,'体/测日期','参加选拔产品日期','到访日期'),score:null,score_max:null,
        strengths:'测评等级依据：报名班型',record_state:registration.record_state,history_key:key,
        history_batch_id:registration.history_batch_id,source_record_id:source.id,source_field_ids:registration.source_field_ids,
        history_imported_at:registration.history_imported_at};
      row.source_payload_sha256=historyPayloadHash(row);inserts.push({table:'assessment_results',row});
    }
  }
  for(const enrollment of snapshot.course_enrollments){
    const source=sourceById.get(enrollment.source_record_id);
    if(!source||enrollment.status!=='active')continue;
    if(enrollment.history_revision>0){skipped.push({table:'course_enrollments',id:enrollment.id,reason:'manual_revision'});continue;}
    const facts=sourceEnrollmentFacts('是',field(source,'班型')||field(source,'春季班型'),
      enrollment.registered_on??date(source,'报名日期','报名缴费日期','缴费时间','补续日期'));
    patch('course_enrollments',enrollment,{source_enrollment_facts:facts},'existing_source_enrollment');
  }
  for(const decision of enrollmentDates){
    const source=sourceById.get(decision.recordId),enrollment=snapshot.course_enrollments.find(row=>row.id===decision.enrollmentId);
    const sourceStudent=source&&(binding.get(source.id)??source.student_id);
    const enrollmentStudent=enrollment&&(binding.get(enrollment.source_record_id)??enrollment.student_id);
    if(!source||!enrollment||!sourceStudent||sourceStudent!==enrollmentStudent)throw new Error('ENROLLMENT_DATE_SUBJECT_MISMATCH');
    const facts=sourceEnrollmentFacts(field(source,'报名与否'),field(source,'班型'),date(source,'报名日期'));
    const sourceNote=`报名日期依据：${source.record_data.tableName}（已报名）`;
    if(facts?.registeredOn&&enrollment.registered_on===facts.registeredOn){
      const legacyNote=`报名日期依据：${source.id}`;
      if(enrollment.note?.split(/\r?\n/).includes(legacyNote))patch('course_enrollments',enrollment,
        {note:enrollment.note.split(/\r?\n/).map(line=>line===legacyNote?sourceNote:line).join('\n')},'readable_source_reference');
      continue;
    }
    if(!facts?.registeredOn||enrollment.history_revision>0||enrollment.registered_on&&enrollment.registered_on!==facts.registeredOn)throw new Error('ENROLLMENT_DATE_CONFLICT');
    const sourceFacts=patches.get(`course_enrollments:${enrollment.id}`)?.changes.source_enrollment_facts??enrollment.source_enrollment_facts;
    patch('course_enrollments',enrollment,{registered_on:facts.registeredOn,
      source_enrollment_facts:{...(sourceFacts??facts),registeredOn:facts.registeredOn},
      note:mergeSourceNotes(enrollment.note,sourceNote)},'confirmed_enrollment_date');
  }
  const result={patches:[...patches.values()],inserts,associations:confirmedAssociations,skipped};
  return {...result,counts:{patches:result.patches.length,registrations:result.patches.filter(row=>row.table==='activity_registrations').length,
    noShows:result.patches.filter(row=>row.changes.status==='no_show').length,assessments:result.patches.filter(row=>row.table==='assessment_results').length+inserts.length,
    enrollments:result.patches.filter(row=>row.table==='course_enrollments').length,associations:confirmedAssociations.length,skipped:skipped.length}};
}
