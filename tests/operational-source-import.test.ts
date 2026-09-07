import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {buildOperationalSourceImport} from '../scripts/lib/operational-source-import.mjs';

const source=(id:string,tableName:string,values:Record<string,string>,studentId:string|null=null)=>({
  id,student_id:studentId,lead_id:null,source_data:{format:'feishu-base',filename:'业务表.base'},
  record_data:{names:['示例学员'],phones:[],tableName,cells:Object.entries(values).map(([fieldName,text],index)=>({fieldId:`field-${index}`,fieldName,text,kind:'text'}))},
});
const payload=(records:ReturnType<typeof source>[])=>({records,payloadHash:'source-fingerprint',batchKey:'source-batch'});

describe('来源记录衔接当前业务模型',()=>{
  it('generates standard IDs for new source rows and reuses the complete legacy graph on reimport',()=>{
    const input=payload([source('visit','到访数据与信息表1.0-总',{'思维测评等级':'A'})]);
    const fresh=buildOperationalSourceImport(input,{});
    const legacy=new Map<string,string>();
    for(const [table,rows] of Object.entries(fresh.rows))for(const row of rows){
      expect(z.uuid().safeParse(row.id).success).toBe(true);
      const hash=createHash('md5').update(table==='leads'?'operation-lead:visit':String(row.history_key)).digest('hex');
      legacy.set(String(row.id),`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`);
    }
    const previous=Object.fromEntries(Object.entries(fresh.rows).map(([table,rows])=>[table,rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'?(legacy.get(value)??value):value])))]));
    const repeated=buildOperationalSourceImport(input,previous);
    for(const [table,rows] of Object.entries(repeated.rows))expect(rows.map(row=>row.id)).toEqual(previous[table].map(row=>row.id));
    expect(repeated.rows.activity_registrations[0].lead_id).toBe(previous.leads[0].id);
    expect(repeated.rows.assessment_results[0].activity_registration_id).toBe(previous.activity_registrations[0].id);
  });
  it('maps source subject teachers to assessment teachers and support teachers to lead owners',()=>{
    const profile={id:'assessor',display_name:'示例测评老师',role:'staff',is_active:true};
    const p=buildOperationalSourceImport(payload([source('visit','到访数据与信息表1.0-总',{'学科老师':'示例测评老师','学服老师':'示例学服老师','思维测评等级':'A'})]),{profiles:[profile,{...profile,id:'support',display_name:'示例学服老师'}]});
    expect(p.rows.assessment_results[0].assessed_by).toBe('assessor');
    expect(p.rows.leads[0].owner_id).toBe('support');
    expect(p.rows.activities[0].remark).toContain('学科老师：示例测评老师');
  });
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
