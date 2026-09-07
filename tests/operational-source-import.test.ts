import {describe,expect,it} from 'vitest';
import {buildOperationalSourceImport} from '../scripts/lib/operational-source-import.mjs';

const source=(id:string,tableName:string,values:Record<string,string>,studentId:string|null=null)=>({
  id,student_id:studentId,lead_id:null,source_data:{format:'feishu-base',filename:'业务表.base'},
  record_data:{names:['示例学员'],phones:[],tableName,cells:Object.entries(values).map(([fieldName,text],index)=>({fieldId:`field-${index}`,fieldName,text,kind:'text'}))},
});
const payload=(records:ReturnType<typeof source>[])=>({records,payloadHash:'source-fingerprint',batchKey:'source-batch'});

describe('来源记录衔接当前业务模型',()=>{
  it('未关联到学生的到访行仍可继续测评，学习力等级保持独立，未达A进入备注',()=>{
    const p=buildOperationalSourceImport(payload([source('visit','到访数据与信息表1.0-总',{'参与内容':'测评','思维测评等级':'未达A','学习力测评等级':'A+','年级/25级':'3','到访与否':'已到'})]),{});
    expect(p.rows.activity_registrations).toHaveLength(1);
    expect(p.rows.activity_registrations[0]).toMatchObject({student_id:null,status:'attended'});
    expect(p.rows.activity_registrations[0].lead_id).toBe(p.rows.leads[0].id);
    expect(p.rows.assessment_results[0]).toMatchObject({assessment_band:null,score:null,score_max:null});
    expect(p.rows.assessment_results[0].strengths).toContain('原测评等级：未达A');
    expect(p.rows.assessment_results[0].strengths).toContain('学习力测评等级：A+');
    expect(p.rows.leads[0]).toMatchObject({phone:'',phone_normalized:null,grade_hint:null});
  });
  it('首联未知结果不生成联系事件；明确加V事实进入当前联系字段',()=>{
    const p=buildOperationalSourceImport(payload([
      source('unknown','获客&私域信息登记表1.0-总',{'跟进结果':'暂无结果','确认结果':'暂无结果','意向分类':'B'}),
      source('contact','获客&私域信息登记表1.0-总',{'确认结果':'加V','用户当下加V与否':'已','意向分类':'A'}),
    ]),{});
    expect(p.rows.lead_communications).toHaveLength(1);
    expect(p.rows.lead_communications[0]).toMatchObject({outcome:'connected',wechat_added:true,interest_level:'A',occurred_at:null});
    expect(p.leadFacts.find(row=>row.source_record_id==='unknown')?.note).toContain('暂无结果');
  });
  it('秋季在读和待报分别进入报名与意向，不把基础强配成当前班型',()=>{
    const p=buildOperationalSourceImport(payload([
      source('active','2026秋季在读学员表格',{'年级':'3','26秋在读':'是','班型':'基础'}),
      source('pending','2026秋季在读学员表格',{'年级':'3','26秋在读':'待报','班型':'A+'}),
    ]),{});
    expect(p.rows.course_enrollments).toHaveLength(1);
    expect(p.rows.course_enrollments[0]).toMatchObject({student_id:null,period_label:'2026秋季'});
    expect(p.rows.course_enrollment_assignments[0].class_label).toBe('');
    expect(p.rows.course_enrollments[0].note).toContain('原班型：基础');
    expect(p.rows.course_opportunities[0]).toMatchObject({source_record_id:'pending',stage:'planning',opportunity_type:'new'});
    expect(p.coverage).toHaveLength(2);
  });
  it('暑秋连报保持两个学期的独立业务主键，重跑产生相同清单',()=>{
    const input=payload([source('both','2026暑秋续报数据表',{'是否续报':'是','续报类型':'暑秋连报'})]);
    const first=buildOperationalSourceImport(input,{}),second=buildOperationalSourceImport(input,{});
    expect(first).toEqual(second);
    expect(first.rows.course_opportunities).toHaveLength(2);
    expect(new Set(first.rows.course_enrollments.map(row=>row.id)).size).toBe(2);
    expect(first.rows.course_enrollments.map(row=>row.period_label)).toEqual(['2026暑假','2026秋季']);
  });
});
