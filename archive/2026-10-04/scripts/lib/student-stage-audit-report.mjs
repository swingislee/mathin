import fs from 'node:fs';
import path from 'node:path';

export const stageAuditBucketLabels = {
  has_enrollment_or_class_fact: '已有报名或在班业务记录',
  has_class_roster_source: '另有花名册在班经历',
  has_academic_result: '已有专业测评结果',
  has_attendance_fact: '已有到访或测评参加记录',
  has_renewal_or_payment_source: '已有续报、报名或退费来源',
  has_activity_registration: '已有活动或预约记录',
  contact_result_unspecified: '已有沟通记录，联系结果未结构化',
  has_effective_contact: '已有有效首联结果',
  has_followup_note: '已有学生跟进备注',
  only_unsuccessful_contact: '目前只有未接通或号码无效记录',
  no_later_business_fact_located: '尚未找到后续业务事实',
};
const stageLabels = { awaiting_first_contact:'待首联',awaiting_assessment:'待测评',awaiting_enrollment:'待报名',awaiting_renewal:'待续班',former_student:'历史学员' };

export function writeStudentStageAuditReport(run, audit, snapshot) {
  const comparisonFile = path.join(run, 'index-snapshot-comparison.json');
  const comparison = fs.existsSync(comparisonFile) ? JSON.parse(fs.readFileSync(comparisonFile, 'utf8')) : null;
  const compared = new Map((comparison?.mismatches ?? []).map(row => [row.key, row]));
  const enrollments = new Map(snapshot.course_enrollments.map(row => [row.id, row]));
  const payload = audit.rows.map(row => ({ key:row.key,name:row.name,phone:row.maskedPhone,stage:row.stage,bucket:row.bucket,
    subjectKind:row.studentId ? '学生档案' : '未关联学生的线索',id:row.studentId ?? row.leadId,
    counts:{报名:row.enrollmentIds.length,测评结果:row.assessmentIds.length,活动:row.registrationIds.length,沟通:row.contactIds.length,续报或报名机会:row.opportunityIds.length,来源:row.sourceIds.length},
    periods:[...new Set(row.enrollmentIds.map(id => enrollments.get(id)?.period_label || '期次未填写'))],
    sourceTables:row.sourceTables,rosters:row.rosterSources.map(roster => ({status:roster.status,endsOn:roster.endsOn})),
    candidates:row.exactStudentCandidates,projectionMismatch:compared.has(row.key) ? stageLabels[compared.get(row.key).actualStage] : null,
    phoneMissing:row.flags.usablePhoneMissing,
  }));
  const json = value => JSON.stringify(value).replaceAll('<','\\u003c');
  const summary = audit.summary.firstContactBuckets.map(group => `${stageAuditBucketLabels[group.key]}：${group.count}`).join('；');
  const capturedAt = new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Shanghai'}).format(new Date(snapshot.capturedAt));
  const html = String.raw`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>学员阶段逐人校验</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f5ef;color:#263d35;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1500px;margin:36px auto;padding:0 24px}h1{font-size:26px;margin-bottom:8px}p{max-width:1100px;color:#566b60}.summary{padding:14px 0;border-block:1px solid #cad3c8;font-size:13px}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:22px 0 12px}select,input,button{font:inherit;border:1px solid #bdc9bc;border-radius:6px;padding:7px 10px;background:#fff;color:inherit}input{width:230px}button{cursor:pointer}button:disabled{opacity:.4}.table{overflow:auto;border-top:1px solid #bac8bb}table{border-collapse:collapse;width:100%;min-width:1100px}th{text-align:left;white-space:nowrap;background:#edf0e8}th,td{padding:12px 10px;border-bottom:1px solid #d6ddd2;vertical-align:top}td small{display:block;color:#697a70}a{color:#236f54}details{max-width:370px}details p{margin:6px 0;font-size:12px;white-space:pre-wrap}footer{display:flex;gap:14px;justify-content:flex-end;align-items:center;margin:18px 0}.issue{color:#954c22}#count{color:#506a5b}
</style><main><h1>学员阶段逐人校验</h1>
<p>截至 ${capturedAt} 的本地只读快照，共 ${audit.summary.subjects} 个系统主体。当前“待首联” ${audit.summary.awaitingFirstContact} 条。姓名与电话相同只提示候选，记录原有身份保持不变。以下分组表示找到的证据，当前在读、退课和身份归属仍按实际业务确认。</p>
<p class="summary">${summary}。分组按证据优先级去重，每条只计一次。</p>
<div class="controls"><label>当前页面阶段 <select id="stage"></select></label><label>校验分组 <select id="bucket"></select></label><input id="search" placeholder="搜索姓名或电话尾号" aria-label="搜索姓名或电话尾号"><label><input type="checkbox" id="mismatch" style="width:auto">仅列表与个人快照不一致</label><span id="count"></span></div>
<div class="table"><table><thead><tr><th>学员</th><th>系统身份</th><th>当前标签</th><th>校验证据分组</th><th>业务记录</th><th>核对明细</th></tr></thead><tbody id="rows"></tbody></table></div>
<footer><button id="prev">上一页</button><span id="page"></span><button id="next">下一页</button></footer>
<p>“个人快照”仍使用现行阶段规则，其结果用于识别内部矛盾，不作为新的批量归类决定。旧花名册的记录数可能包含多个来源版本；人员分组按当前系统主体去重。完整来源 ID 和逐人标记在同目录 audit.json 中。</p></main>
<script type="application/json" id="data">${json(payload)}</script><script type="application/json" id="labels">${json({stages:stageLabels,buckets:stageAuditBucketLabels})}</script>
<script>
const data=JSON.parse(document.getElementById('data').textContent),labels=JSON.parse(document.getElementById('labels').textContent);
const stage=document.getElementById('stage'),bucket=document.getElementById('bucket'),search=document.getElementById('search'),mismatch=document.getElementById('mismatch');
function option(parent,value,label){const node=document.createElement('option');node.value=value;node.textContent=label;parent.append(node)}
option(stage,'','全部阶段');Object.entries(labels.stages).forEach(([key,value])=>option(stage,key,value));stage.value='awaiting_first_contact';
option(bucket,'','全部校验分组');Object.entries(labels.buckets).forEach(([key,value])=>option(bucket,key,value));
let page=1;const size=50;function cell(tr,value,tag='td'){const node=document.createElement(tag);node.textContent=value;tr.append(node);return node}
function render(){const q=search.value.trim().toLocaleLowerCase();const selected=data.filter(row=>(!stage.value||row.stage===stage.value)&&(!bucket.value||row.bucket===bucket.value)&&(!mismatch.checked||row.projectionMismatch)&&(!q||(row.name+' '+row.phone).toLocaleLowerCase().includes(q)));const pages=Math.max(1,Math.ceil(selected.length/size));page=Math.min(page,pages);const body=document.getElementById('rows');body.replaceChildren();
for(const row of selected.slice((page-1)*size,page*size)){const tr=document.createElement('tr');const identity=cell(tr,'');const link=document.createElement('a');link.textContent=row.name||'姓名待补';link.href='http://192.168.5.213:3130/zh/dashboard/students?q='+encodeURIComponent(row.id);link.target='_blank';link.rel='noreferrer';identity.append(link);const phone=document.createElement('small');phone.textContent=row.phone||'电话未填写';identity.append(phone);cell(tr,row.subjectKind);const state=cell(tr,labels.stages[row.stage]);if(row.projectionMismatch){const issue=document.createElement('small');issue.className='issue';issue.textContent='个人快照：'+row.projectionMismatch;state.append(issue)}cell(tr,labels.buckets[row.bucket]);cell(tr,Object.entries(row.counts).filter(([,n])=>n).map(([label,n])=>label+' '+n).join('；')||'未定位到业务记录');const facts=cell(tr,'');const details=document.createElement('details');const title=document.createElement('summary');title.textContent='查看期次、花名册与来源';details.append(title);const p=document.createElement('p');p.textContent=['报名期次：'+(row.periods.join('、')||'无'), '花名册：'+(row.rosters.map(x=>x.status+' / 结束 '+(x.endsOn||'未填写')).slice(0,12).join('；')||'无'), '来源表：'+(row.sourceTables.join('、')||'无'), '相同姓名电话的学生候选：'+row.candidates.length, row.phoneMissing?'联系方式需核对':''].filter(Boolean).join('\n');details.append(p);facts.append(details);body.append(tr)}
document.getElementById('count').textContent=selected.length+' 条';document.getElementById('page').textContent=page+' / '+pages;document.getElementById('prev').disabled=page<=1;document.getElementById('next').disabled=page>=pages}
[stage,bucket,search,mismatch].forEach(node=>node.addEventListener('input',()=>{page=1;render()}));document.getElementById('prev').onclick=()=>{page--;render()};document.getElementById('next').onclick=()=>{page++;render()};render();
</script></html>`;
  // 校验嵌入数据完整且可解析；所有来源显示值通过 textContent 展示。
  const embedded = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)?.[1];
  if (JSON.parse(embedded).length !== audit.summary.subjects) throw new Error('AUDIT_REPORT_INCOMPLETE');
  const report = path.join(run, '学员阶段逐人校验.html');
  fs.writeFileSync(report, html, 'utf8');
  return report;
}
