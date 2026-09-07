import {describe,expect,it} from 'vitest';
import {sourceEnrollmentFacts,sourceVisitParticipation,readSourceEnrollmentFacts} from '../src/features/school/business-source-contract';
import {buildSourceAssessmentRepair} from '../scripts/lib/source-assessment-repair.mjs';

const source=(id:string,values:Record<string,string>)=>({id,student_id:null,lead_id:null,
  record_data:{tableName:'到访数据与信息表1.0-总',names:['示例学生'],phones:[],cells:Object.entries(values).map(([fieldName,text])=>({fieldName,text,fieldId:fieldName}))}});
const registration=(id:string,sourceId:string,status='booked',revision=0)=>({id,source_record_id:sourceId,history_revision:revision,
  status,student_id:null,lead_id:'lead',assessment_started_at:null,assessment_completed_at:null,source_enrollment_facts:null});
const snapshot=(records:ReturnType<typeof source>[],registrations:ReturnType<typeof registration>[])=>({history_import_records:records,
  activity_registrations:registrations,assessment_results:[],course_enrollments:[],leads:[],students:[]});

describe('来源报名事实与多次预约修复',()=>{
  it('报名确认前序阶段，班型对应等级，缺失日期保持空值',()=>{
    expect(sourceEnrollmentFacts('已报名','A+',null)).toEqual({version:1,confirmed:true,assessmentBand:'a_plus',registeredOn:null});
    expect(readSourceEnrollmentFacts(sourceEnrollmentFacts('已报名','A+','2026-09-02'))?.assessmentBand).toBe('a_plus');
    expect(sourceEnrollmentFacts('意向报名','A+',null)).toBeNull();
    expect(sourceEnrollmentFacts('已报名','培优',null)?.assessmentBand).toBeNull();
  });
  it('空白参与内容默认未到，明确到场和实际测评记录优先',()=>{
    expect(sourceVisitParticipation('','','','','')).toBe('no_show');
    expect(sourceVisitParticipation('','已到','','','')).toBe('attended');
    expect(sourceVisitParticipation('','','A+','','')).toBe('attended');
    expect(sourceVisitParticipation('','','','','85')).toBe('attended');
    expect(sourceVisitParticipation('测评','','','','')).toBe('booked');
    expect(sourceVisitParticipation('测评','未到','A+','','')).toBe('no_show');
  });
  it('多次预约分别保留，报名等级不写到未到场次，不补造首联或测评结果',()=>{
    const data=snapshot([source('one',{'参与内容':'测评','到访与否':'已到'}),source('two',{'参与内容':'','报名与否':'已报名','班型':'A+','报名日期':'2026/09/02'})],
      [registration('r1','one','attended',1),registration('r2','two')]);
    const plan=buildSourceAssessmentRepair(data);
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]).toMatchObject({table:'activity_registrations',id:'r2',changes:{status:'no_show',source_enrollment_facts:{assessmentBand:'a_plus',registeredOn:'2026-09-02'}}});
    expect(plan.inserts).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });
  it('已经人工登记的到场状态和测评结果保持原值',()=>{
    const data=snapshot([source('row',{'参与内容':'','报名与否':'已报名','班型':'A+'})],[registration('reg','row','attended',2)]);
    expect(buildSourceAssessmentRepair(data).patches).toEqual([]);
  });
  it('已有报名缺少班型时保留确认事实，不强配等级',()=>{
    const data={...snapshot([source('row',{'报名与否':'已报名','班型':'培优'})],[]),
      course_enrollments:[{id:'enrollment',source_record_id:'row',student_id:null,status:'active',history_revision:0,registered_on:null}]};
    expect(buildSourceAssessmentRepair(data).patches[0].changes.source_enrollment_facts).toEqual({version:1,confirmed:true,assessmentBand:null,registeredOn:null});
  });
  it('重跑相同计划后不再产生更新',()=>{
    const data=snapshot([source('row',{'参与内容':'','报名与否':'已报名','班型':'A+'})],[registration('reg','row')]);
    const first=buildSourceAssessmentRepair(data);
    data.activity_registrations[0]={...data.activity_registrations[0],...first.patches[0].changes,
      source_enrollment_facts:Object.fromEntries(Object.entries(first.patches[0].changes.source_enrollment_facts).reverse())};
    expect(buildSourceAssessmentRepair(data).patches).toEqual([]);
  });
});
