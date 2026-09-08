import {describe,it,expect} from 'vitest';
import {buildSourceMetricFacts,sourceReportingMonth} from '../scripts/lib/source-metric-facts.mjs';
import {buildSourceMetricFactsRepair} from '../scripts/lib/source-metric-facts-repair.mjs';
import {buildOperationalSourceImport} from '../scripts/lib/operational-source-import.mjs';
import {readSourceMetricFacts,uniqueSourceMetricRows} from '../src/features/school/source-metric-facts-contract';

const source=(tableName:string,values:Record<string,string>,extra={})=>({id:'source',source_table_id:'export:table',source_record_id:'row',
  source_data:{format:'feishu-base',filename:'2026-09-07-export.base'},
  record_data:{tableName,names:['来源学员'],phones:['12345678901'],cells:Object.entries(values).map(([fieldName,text])=>({fieldName,text}))},...extra});
describe('来源确认标签',()=>{
  it('后续导入自动写入确认标签，袋鼠保留活动标签',()=>{
    const contact=source('获客&私域信息登记表1.0-总',{'确认月份':'9月','确认人员':'学服甲'});
    const kangaroo=source('袋鼠报名与备考信息表',{'报名日期':'2026-03-12'},{id:'kangaroo',source_record_id:'kangaroo'});
    const plan=buildOperationalSourceImport({records:[contact,kangaroo],payloadHash:'test',batchKey:'test'},{});
    expect(plan.rows.lead_communications).toHaveLength(1);
    expect(plan.rows.lead_communications[0]).toMatchObject({outcome:'connected',occurred_on:null,source_metric_facts:{confirmed:{contacts:true},months:{contacts:'2026-09'}}});
    expect(plan.rows.activity_registrations[0]).toMatchObject({source_metric_facts:{scope:'activity',confirmed:{activityRegistrations:true}}});
  });
  it('按已确认的月份与人员补有效沟通，保留明确失败结果和日期精度',()=>{
    const positive=source('获客&私域信息登记表1.0-总',{'确认月份':'9月','确认人员':'学服甲'});
    expect(buildSourceMetricFacts(positive)).toMatchObject({confirmed:{contacts:true},months:{contacts:'2026-09'},staff:{contacts:'学服甲'}});
    expect(readSourceMetricFacts(buildSourceMetricFacts(positive,{phase:'followup'}))!.confirmed.contacts).toBe(false);
    for(const result of ['未接通','空号'])expect(readSourceMetricFacts(buildSourceMetricFacts(source('获客&私域信息登记表1.0-总',{'确认月份':'9月','确认人员':'学服甲','确认结果':result})))!.confirmed.contacts).toBe(false);
    expect(sourceReportingMonth('12月','2026-09-07')).toBe('2025-12');
    expect(sourceReportingMonth('','2026-09-07')).toBeNull();
  });
  it('到访表沿用 Base 标签，袋鼠单列活动报名',()=>{
    const facts=readSourceMetricFacts(buildSourceMetricFacts(source('到访数据与信息表1.0-总',{'确认日期':'9月','确认月份':'9月','到访月份':'9月','到访与否':'已到','报名月份':'8月','报名与否':'已报名'})))!;
    expect(facts.confirmed).toEqual({invitations:true,arrivals:true,assessments:true,enrollments:true});
    expect(facts.months.enrollments).toBe('2026-08');expect(readSourceMetricFacts(facts)).toEqual(facts);
    const kangaroo=readSourceMetricFacts(buildSourceMetricFacts(source('袋鼠报名与备考信息表',{'报名日期':'2026-03-12'})))!;
    expect(kangaroo).toMatchObject({scope:'activity',confirmed:{activityRegistrations:true},months:{activityRegistrations:'2026-03'}});
    expect(kangaroo.confirmed.invitations).toBeUndefined();expect(kangaroo.confirmed.enrollments).toBeUndefined();
  });
  it('重复导出按来源行去重，同名不同来源行保留',()=>{
    const facts=buildSourceMetricFacts(source('袋鼠报名与备考信息表',{}));
    const rows=[{id:'old',source_metric_facts:{...facts,sourceVersion:'2026-09-05'}},{id:'new',source_metric_facts:facts},
      {id:'separate',source_metric_facts:{...facts,sourceKey:'table:other'}}];
    expect(uniqueSourceMetricRows(rows).map(row=>row.id)).toEqual(['new','separate']);
    expect(readSourceMetricFacts({...facts,months:{contacts:'2026-19'}})).toBeNull();
  });
  it('旧沟通补标、缺失确认补建后重跑无变更',()=>{
    const original=source('获客&私域信息登记表1.0-总',{'确认月份':'9月','确认人员':'学服甲'},{lead_id:'lead'});
    const snapshot={history_import_records:[original],leads:[{id:'lead'}],profiles:[],activity_registrations:[],course_enrollments:[],lead_communications:[]};
    const plan=buildSourceMetricFactsRepair(snapshot);
    expect(plan.unresolved).toEqual([]);expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].row).toMatchObject({lead_id:'lead',outcome:'connected',occurred_on:null,occurred_at:null});
    const next=buildSourceMetricFactsRepair({...snapshot,lead_communications:plan.inserts.map((r:{row:unknown})=>r.row)});
    expect(next.patches).toEqual([]);expect(next.inserts).toEqual([]);
  });
});
