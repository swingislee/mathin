import { describe, expect, it } from 'vitest';
import { sourceContactEvidence, sourceInterestEvidence, sourceNoteIsEffective, sourceWechatEvidence } from '@/features/school/source-lifecycle-evidence.mjs';
import { extractSourceStatusEvidence } from '../scripts/lib/source-status-evidence.mjs';
import { resolveStatusEvidence, type StatusEvidence } from '@/features/school/record-status/contract';
const source = (fields: Record<string,string>) => ({tableId:'table',sourceRecordId:'record',cells:Object.entries(fields).map(([fieldName,text])=>({fieldName,text}))});
const fact = (value: string, extra: Partial<StatusEvidence> = {}): StatusEvidence => ({type:'wechat',value,field:'备注',excerpt:value,priority:60,certainty:'confirmed',date:null,...extra});

describe('历史沟通语义边界', () => {
  it.each(['已加V与群','+v妈妈不考虑','加妈妈微信','有我们老师微信','已加微信，暂时不需要秋季联系'])('识别已加微信：%s', value => {
    expect(sourceWechatEvidence(value)).toBe('yes');
  });
  it.each(['未加V与群','微信查找不到该用户','微信未通过','不愿加微信'])('保留明确未加：%s', value => {
    expect(sourceWechatEvidence(value)).toBe('no');
  });
  it.each(['明天加微信','准备+V','微信申请已发','加了微信吗？','手机号不是微信'])('计划或疑问不当作已加：%s', value => {
    expect(sourceWechatEvidence(value)).not.toBe('yes');
  });
  it('区分拒绝课程、微信及其他物品', () => {
    for (const text of ['+v妈妈不考虑','家长不需要了','意向低']) expect(sourceInterestEvidence(text)).toBe('C');
    for (const text of ['不需要材料','不考虑英语','不想加微信','有理念','家长没有说不需要','如果不需要','意向高吗？']) expect(sourceInterestEvidence(text)).toBeNull();
    expect(sourceInterestEvidence('家长意向很高')).toBe('A');
    expect(sourceInterestEvidence('家长意向一般')).toBe('B');
  });
  it('未接、挂断、元信息不制造有效联系，有明确回应则保留', () => {
    for (const text of ['直接挂','接通直接挂断','未接触家长','2026-09-03未接','尚未联系','正在通话中','拦截号码','呼叫受限','暂停服务']) expect(sourceNoteIsEffective(text),text).toBe(false);
    for (const text of ['未接，二次联系家长说不需要','直接说不需要挂断','想周末来体验','妈妈说孩子不接受额外练习，换时间联系','资料没写，挂断']) expect(sourceNoteIsEffective(text),text).toBe(true);
    const fields: Record<string,string> = {确认结果:'未通',确认信息备注:'+V，妈妈不考虑'};
    expect(sourceContactEvidence((name:string)=>fields[name]??'','confirmation')).toMatchObject({effective:true,conflicting:true});
    expect(sourceContactEvidence((name:string)=>name==='确认结果'?'空号':'','confirmation')).toMatchObject({outcome:'invalid_number',effective:false,attempted:true});
  });
  it('测评他人、其他机构、计划及疑问不当作本人的已完成', () => {
    for (const text of ['哥哥已做过测评','在其他机构已做过测评','明天准备测评','已经测评过吗？','没有做过测评']) {
      expect(extractSourceStatusEvidence(source({确认信息备注:text})).filter((f:StatusEvidence)=>f.type==='assessment'&&f.certainty==='confirmed'),text).toHaveLength(0);
    }
    expect(extractSourceStatusEvidence(source({确认信息备注:'已完成测评，测评等级A+'}))).toEqual(expect.arrayContaining([expect.objectContaining({type:'assessment_band',value:'a_plus',certainty:'confirmed'})]));
  });
  it('实际日期沿各次沟通保存，月份和导出日期不伪装成发生日期', () => {
    const facts=extractSourceStatusEvidence(source({确认日期:'2026-09-01',确认信息备注:'未加微信',跟进日期:'2026-09-05',跟进信息:'已加微信'}));
    expect(facts.find((f:StatusEvidence)=>f.field==='确认信息备注'&&f.type==='wechat')?.date).toBe('2026-09-01');
    expect(resolveStatusEvidence(facts,'wechat')).toMatchObject({value:'yes',review:false});
    expect(extractSourceStatusEvidence(source({跟进日期:'9.5',跟进信息:'已加微信'})).find((f:StatusEvidence)=>f.type==='wechat')?.date).toBeNull();
  });
  it('分离报名意愿、待付款与费用顾虑，不生成正式报名', () => {
    const facts=extractSourceStatusEvidence(source({家长情况:'确定报名，已发收款码；觉得太贵，回去商量一下'}));
    expect(facts).toEqual(expect.arrayContaining([expect.objectContaining({type:'enrollment_progress',value:'payment_pending'}),expect.objectContaining({type:'concern',value:'cost'})]));
    expect(facts.some((f:StatusEvidence)=>f.type==='enrollment'&&f.value==='enrolled')).toBe(false);
  });
});

describe('来源证据时序与人工保护', () => {
  it('较新的有日期备注可推进旧明确字段，人工登记继续优先', () => {
    const rows=[fact('no',{priority:120,date:'2026-09-01'}),fact('yes',{date:'2026-10-01'})];
    expect(resolveStatusEvidence(rows,'wechat')).toMatchObject({value:'yes',review:false});
    expect(resolveStatusEvidence([...rows,fact('no',{priority:400,date:'2026-09-15'})],'wechat')).toMatchObject({value:'no',review:false});
  });
  it('同来源获客与后续沟通可以排序，跨来源无日期矛盾保留核对', () => {
    expect(resolveStatusEvidence([fact('no',{logicalKey:'a',phase:'acquisition',priority:90}),fact('yes',{logicalKey:'a',phase:'followup'})],'wechat')).toMatchObject({value:'yes',review:false});
    expect(resolveStatusEvidence([fact('no',{logicalKey:'a'}),fact('yes',{logicalKey:'b'})],'wechat')).toMatchObject({value:'conflicting',review:true});
  });
  it('同一份备注中的矛盾不会被另一条肯定证据静默掩盖', () => {
    expect(resolveStatusEvidence([fact('yes'),fact('conflicting',{certainty:'review'})],'wechat').review).toBe(true);
  });
});
