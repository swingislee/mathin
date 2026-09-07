import {createHash} from 'node:crypto';
import {historyFieldName,historicalDate} from './student-business-history.mjs';
import {historyPayloadHash} from './history-import-trial.mjs';
import {normalizeSourceAssessmentBand,sourceAssessmentNote,normalizeSourceContact,sourceScore,mergeSourceNotes,sourceVisitKinds,resolveSourceStaffId} from '../../src/features/school/business-source-contract.ts';

export const OPERATIONAL_TABLES=['leads','lead_communications','activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments'];
const id=key=>{const h=createHash('md5').update(key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const field=(r,name)=>r.record_data.cells.find(c=>historyFieldName(c.fieldName)===name)?.text.trim()??'';
const originalNotes=(r,names)=>mergeSourceNotes(...names.map(name=>field(r,name)?`${name}：${field(r,name)}`:''));
const normalizedName=name=>name.normalize('NFKC').replace(/\s+/gu,'').toLocaleLowerCase('zh');
const phone=r=>r.record_data.phones.find(value=>/^\d{6,20}$/.test(value.replace(/\D/g,'')))?.replace(/\D/g,'')??'';
const name=r=>r.record_data.names[0]??'';
const grade=r=>{const v=field(r,'年级');return r.record_data.tableName==='2026秋季在读学员表格'&&/^(?:[1-9]|1[0-2])$/.test(v)?Number(v):null;};
const provenance=r=>({source_record_id:r.id,source_field_ids:r.record_data.cells.filter(c=>c.kind!=='system'&&c.text.trim()).map(c=>c.fieldId)});
const validDate=(r,...fields)=>fields.map(f=>historicalDate(field(r,f))).find(Boolean)??null;

/** 原表中的个人业务行各有稳定主键；待确认归属保留来源锚点，实际使用时绑定已有学生。 */
export function buildOperationalSourceImport(payload,snapshot) {
  /** @type {Record<string, Array<Record<string, unknown>>>} */
  const rows=Object.fromEntries(OPERATIONAL_TABLES.map(t=>[t,[]]));
  const existing=Object.fromEntries(OPERATIONAL_TABLES.map(t=>[t,new Map((snapshot[t]??[]).filter(r=>r.source_record_id).map(r=>[r.source_record_id,r]))]));
  const leadsByExact=new Map((snapshot.leads??[]).filter(l=>l.phone_normalized).map(l=>[`${l.phone_normalized}:${l.normalized_name}`,l.id]));
  const studentLeads=new Map((snapshot.leads??[]).filter(l=>l.student_id).map(l=>[l.student_id,l.id]));
  const coverage=[];
  const leadFacts=new Map();
  const staff=(r,fieldName)=>resolveSourceStaffId(field(r,fieldName),snapshot.profiles??[]);
  const add=(table,r,key,data)=>{
    const current=table==='course_opportunities'?(snapshot[table]??[]).find(row=>row.source_record_id===r.id&&row.term_label===data.term_label):existing[table].get(r.id);
    const row={id:current?.id??id(key),history_key:current?.history_key??key,...provenance(r),...data};
    if(current?.history_revision>0)return current.id;
    row.source_payload_sha256=historyPayloadHash(row);
    rows[table].push(row);return row.id;
  };
  function ensureLead(r) {
    if(r.lead_id)return r.lead_id;
    if(r.student_id&&studentLeads.has(r.student_id))return studentLeads.get(r.student_id);
    const tel=phone(r),normalized=normalizedName(name(r)),key=tel?`${tel}:${normalized}`:null;
    if(key&&leadsByExact.has(key))return leadsByExact.get(key);
    const leadId=id(`operation-lead:${r.id}`);
    rows.leads.push({id:leadId,provisional_student_name:name(r),normalized_name:normalized,phone:tel,phone_normalized:tel||null,
      grade_hint:grade(r),grade_text:field(r,'年级')||field(r,'年级/25级'),status:'unassigned',source_record_id:r.id,owner_id:staff(r,'学服老师'),
      note:originalNotes(r,['年级/25级','就读学校','获取渠道','渠道','获取人员','跟进人','确认人员','跟进结果','确认结果','意向分类','用户当下加V与否','诺访与否'])});
    if(key)leadsByExact.set(key,leadId);
    if(r.student_id)studentLeads.set(r.student_id,leadId);
    return leadId;
  }
  const subject=r=>r.student_id?{student_id:r.student_id,lead_id:null}:{student_id:null,lead_id:ensureLead(r)};
  for(const r of payload.records.filter(r=>r.source_data.format==='feishu-base'&&name(r))) {
    const table=r.record_data.tableName;
    const emitted=[];
    if(table==='获客&私域信息登记表1.0-总') {
      const leadId=ensureLead(r);emitted.push(['leads',leadId]);
      const previous=leadFacts.get(leadId);
      leadFacts.set(leadId,{id:leadId,source_record_id:previous?.source_record_id??r.id,note:mergeSourceNotes(previous?.note,originalNotes(r,['年级/25级','获取渠道','获取人员','跟进人','确认人员','跟进结果','确认结果','意向分类','用户当下加V与否','诺访与否','跟进信息','沟通情况','确认信息备注','到访与否','报名与否','当下状态']))});
      for(const [phase,resultField,dateField,noteFields] of [
        ['followup','跟进结果','跟进日期',['跟进信息','沟通情况','真题拼团沟通','跟进人']],
        ['confirmation','确认结果','确认日期',['确认信息备注','确认人员']],
      ]) {
        const result=field(r,resultField),mapped=normalizeSourceContact(result);
        const wechat=field(r,'用户当下加V与否'),visit=field(r,'诺访与否'),interest=field(r,'意向分类');
        const note=mergeSourceNotes(originalNotes(r,noteFields),mapped.note,originalNotes(r,['到访与否','报名与否','当下状态']));
        if(!mapped.outcome&&!originalNotes(r,noteFields.filter(f=>!['跟进人','确认人员'].includes(f)))&&!(phase==='confirmation'&&(['已','是'].includes(wechat)||['是','已'].includes(visit))))continue;
        const key=`operation-contact:${r.id}:${phase}`;
        rows.lead_communications.push({id:id(key),lead_id:leadId,source_record_id:r.id,source_key:key,channel:'other',outcome:mapped.outcome,
          note,occurred_at:null,occurred_on:validDate(r,dateField),recorded_by:staff(r,phase==='followup'?'跟进人':'确认人员'),
          wechat_added:phase==='confirmation'&&['已','是'].includes(wechat)?true:phase==='confirmation'&&['未','否'].includes(wechat)?false:mapped.wechatAdded,
          visit_committed:phase==='confirmation'&&['是','已'].includes(visit)?true:phase==='confirmation'&&['否','未'].includes(visit)?false:mapped.visitCommitted,
          interest_level:phase==='confirmation'&&['A','B','C'].includes(interest)?interest:null});
        emitted.push(['lead_communications',id(key)]);
      }
    }
    if(table==='袋鼠报名与备考信息表') {
      const key=`operation-kangaroo:${r.id}`,target=subject(r);
      const activityId=add('activities',r,`${key}:activity`,{kind:'competition',title:'袋鼠竞赛',scheduled_at:null,occurred_on:null,remark:originalNotes(r,['竞赛级别','短期班','短期班期次','备考打卡','真题领取'])});
      emitted.push(['activity_registrations',add('activity_registrations',r,`${key}:registration`,{...target,activity_id:activityId,status:'booked',registered_on:validDate(r,'报名日期'),outcome:originalNotes(r,['竞赛级别','填写与否','学员类型','所在班级','报名日期'])})]);
    }
    if(table==='到访数据与信息表1.0-总'||table==='（老数据）各选拔产品协作信息表-总') {
      const bandValue=field(r,'思维测评等级'),content=field(r,'参与内容')||field(r,'选拔产品项目');
      const date=validDate(r,'体/测日期','参加选拔产品日期','到访日期');
      const kinds=sourceVisitKinds(content,bandValue,field(r,'学习力测评等级'),field(r,'测评成绩（分数）'));
      if(!kinds.length){const leadId=ensureLead(r);const previous=leadFacts.get(leadId);leadFacts.set(leadId,{id:leadId,source_record_id:previous?.source_record_id??r.id,note:mergeSourceNotes(previous?.note,originalNotes(r,['参与内容','到访与否','到访日期','学员情况','学员情况2','家长情况','家长情况2','家长理念','培养重点&核心期待&共识点','体验测评家长关注点']))});emitted.push(['leads',leadId]);}
      const target=subject(r);
      for(const kind of kinds) {
        const suffix=`operation-visit:${r.id}:${kind}`;
        const oldActivity=(snapshot.activities??[]).find(x=>x.source_record_id===r.id&&x.kind===kind);
        const oldRegistration=(snapshot.activity_registrations??[]).find(x=>x.activity_id===oldActivity?.id);
        const activityId=oldActivity?.id??id(`${suffix}:activity`),registrationId=oldRegistration?.id??id(`${suffix}:registration`);
        const common=provenance(r);
        rows.activities.push({id:activityId,history_key:oldActivity?.history_key??`${suffix}:activity`,...common,kind,title:kind==='trial_class'?'体验课':kind==='competition'?content:'1 对 1 测评',scheduled_at:null,occurred_on:date,
          remark:originalNotes(r,['参与内容','选拔产品项目','学服老师','学科老师','主线服务老师','到访时段','体/测日期'])});
        rows.activity_registrations.push({id:registrationId,history_key:oldRegistration?.history_key??`${suffix}:registration`,...common,activity_id:activityId,...target,
          status:['已到','是','已出勤','出勤'].includes(field(r,'到访与否')||field(r,'学员出勤情况'))?'attended':['未到','未出勤'].includes(field(r,'到访与否')||field(r,'学员出勤情况'))?'no_show':bandValue?'attended':'booked',
          registered_on:validDate(r,'确认日期','报名选拔产品日期'),outcome:originalNotes(r,['到访与否','报名与否','班型','方案宣讲与否','选拔产品','年级/25级'])});
        emitted.push(['activity_registrations',registrationId]);
        if(kind==='trial_class')continue;
        const score=sourceScore(field(r,'测评成绩（分数）'));
        const notes=mergeSourceNotes(originalNotes(r,['学员情况','学员情况2','培养重点&核心期待&共识点','学员程度&推荐班型','学习力测评等级','英语测评成绩（年级限定下）','备考成绩']),sourceAssessmentNote(bandValue),score.note);
        const parent=originalNotes(r,['家长情况','家长情况2','家长理念','体验测评家长关注点','家长主要关注点','家长沟通信息总结（附整理文档）']);
        if(bandValue||score.score!==null||notes||parent)emitted.push(['assessment_results',add('assessment_results',r,`${suffix}:result`,{...target,activity_registration_id:registrationId,assessment_band:normalizeSourceAssessmentBand(bandValue),score:score.score,score_max:score.maxScore,assessed_on:date,assessed_by:existing.assessment_results.get(r.id)?.assessed_by??staff(r,'学科老师'),strengths:notes,parent_concerns:parent})]);
      }
    }
    const autumn=table==='2026秋季在读学员表格';
    const renewal=table==='2026暑秋续报数据表'||table.startsWith('调价续报与新报用户运营数据表-');
    const winter=table==='【重要】窗口期学员数据';
    if(autumn||renewal||winter) {
      const classValue=field(r,'班型')||field(r,'春季班型'),band=normalizeSourceAssessmentBand(classValue);
      const periods=autumn?['2026秋季']:table==='2026暑秋续报数据表'?(field(r,'续报类型')==='暑秋连报'?['2026暑假','2026秋季']:/暑/u.test(field(r,'续报类型'))?['2026暑假']:['2026暑秋']):[field(r,'学期')||field(r,'学期情况')||field(r,'报名季节')||''];
      const notes=mergeSourceNotes(originalNotes(r,['年级','学期情况','学期','续报与近期新报情况','调价运营结果','26秋在读','26秋报名模式','未报/连报情况','用户沟通情况（授课老师填写项）','续&未报家长情况说明','用户运营情况（学服老师填写项）','特别备注说明','备注']),sourceAssessmentNote(classValue,'班型'));
      const teacher=field(r,'授课学科老师')||field(r,'授课老师')||field(r,'带课老师')||field(r,'授课教师');
      const outcome=field(r,'续报与否')||field(r,'是否续报')||field(r,'续报与近期新报情况');
      const isPaid=autumn?field(r,'26秋在读')==='是':winter?!!(field(r,'缴费时间')||field(r,'缴费金额')||field(r,'报名季节')):['是','已续','新报'].includes(outcome);
      for(const period of periods) {
        const evidence=provenance(r),key=`operation-enrollment:${r.id}:${period}`;
        if(renewal)emitted.push(['course_opportunities',add('course_opportunities',r,`${key}:renewal`,{student_id:r.student_id,lead_id:r.student_id?null:ensureLead(r),opportunity_type:'renewal',stage:isPaid?'enrolled':['未续','未'].includes(outcome)?'not_enrolled':'planning',note:notes,period_year:/^2026/u.test(period)?2026:null,period_key:/秋/u.test(period)?'autumn':/暑/u.test(period)?'summer':null,term_label:period,class_label:band?classValue:'',teacher_label:teacher})]);
        if(autumn&&!isPaid)emitted.push(['course_opportunities',add('course_opportunities',r,`${key}:pending`,{student_id:r.student_id,lead_id:r.student_id?null:ensureLead(r),opportunity_type:'new',stage:'planning',note:notes,period_year:2026,period_key:'autumn',term_label:period,class_label:band?classValue:'',teacher_label:teacher})]);
        if(!isPaid)continue;
        const prior=(snapshot.course_enrollments??[]).find(e=>e.source_record_id===r.id&&e.period_label===period);
        const enrollmentId=prior?.id??id(key);
        rows.course_enrollments.push({id:enrollmentId,history_key:prior?.history_key??key,...evidence,student_id:r.student_id,status:'active',confirmed_at:null,
          registered_on:validDate(r,'报名缴费日期','缴费时间','补续日期'),period_label:period,note:notes});
        const assignment=(snapshot.course_enrollment_assignments??[]).find(a=>a.course_enrollment_id===enrollmentId);
        rows.course_enrollment_assignments.push({id:assignment?.id??id(`${key}:assignment`),history_key:assignment?.history_key??`${key}:assignment`,...evidence,course_enrollment_id:enrollmentId,status:'unknown',assigned_at:null,class_label:field(r,'班级')||(band?classValue:''),teacher_label:teacher,room_label:field(r,'校区'),schedule_label:[field(r,'26秋上课周次')||field(r,'周次'),field(r,'26秋上课时段')||field(r,'上课开始时间')].filter(Boolean).join(' '),note:notes});
        emitted.push(['course_enrollments',enrollmentId]);
      }
    }
    if(emitted.length)coverage.push({sourceId:r.id,table,records:emitted});
  }
  for(const table of OPERATIONAL_TABLES) {
    rows[table]=[...new Map(rows[table].map(row=>[row.id,row])).values()];
    for(const row of rows[table])if(row.history_key)row.source_payload_sha256=historyPayloadHash(row);
  }
  return {sourcePayloadHash:payload.payloadHash,sourceBatchKey:payload.batchKey,rows,leadFacts:[...leadFacts.values()],coverage,counts:Object.fromEntries(OPERATIONAL_TABLES.map(t=>[t,rows[t].length]))};
}
