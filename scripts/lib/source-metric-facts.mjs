import {historicalDate,historyFieldName} from './student-business-history.mjs';
import {sourceContactEvidence,sourceContactFlags,sourceHasAssessmentResult,sourceNoteIsEffective} from '../../src/features/school/source-lifecycle-evidence.mjs';

const field=(source,name)=>source.record_data.cells.find(c=>historyFieldName(c.fieldName)===name)?.text?.trim()??'';
const monthNumber=value=>{const match=/^(?:\d{4}[-年/])?\s*(1[0-2]|[1-9])\s*月?$/.exec(value);return match?Number(match[1]):null;};

/** 月份选项属于来源报表年度；具体日期只用于推断已注明年份的独立日期事实。 */
export function sourceReportingMonth(value,sourceVersion,fallbackDate=null) {
  const explicit=/^(\d{4})[-年/](\d{1,2})月?$/.exec(value);
  if(explicit&&Number(explicit[2])>=1&&Number(explicit[2])<=12)return `${explicit[1]}-${explicit[2].padStart(2,'0')}`;
  const month=monthNumber(value),stamp=/^(\d{4})-(\d{2})-\d{2}$/.exec(sourceVersion);
  if(month&&stamp){const year=Number(stamp[1])-(month>Number(stamp[2])?1:0);return `${year}-${String(month).padStart(2,'0')}`;}
  return fallbackDate?.slice(0,7)??null;
}

/** 原表的月日记法只补统计月份；实际日期仍保持原有精度。 */
export function sourceContactReportingMonth(label,date,sourceVersion) {
  if(label.trim())return sourceReportingMonth(label,sourceVersion);
  const actual=historicalDate(date);if(actual)return actual.slice(0,7);
  const short=/^(1[0-2]|0?[1-9])[.月/-](0?[1-9]|[12]\d|3[01])日?$/.exec(date.trim());
  if(short){
    const month=sourceReportingMonth(`${Number(short[1])}月`,sourceVersion);
    return month&&historicalDate(`${month}-${short[2].padStart(2,'0')}`)?month:null;
  }
  return null;
}

export function buildSourceMetricFacts(source,{phase='confirmation',sourceVersion}={}) {
  if(source.source_data?.format!=='feishu-base')return null;
  const table=source.record_data.tableName;
  const version=sourceVersion??/^(\d{4}-\d{2}-\d{2})/.exec(source.source_data.filename??'')?.[1]??'';
  const facts={version:1,sourceKey:`${String(source.source_table_id??'').split(':').at(-1)}:${source.source_record_id??source.id}`,
    sourceName:source.record_data.names?.[0]??field(source,'学员姓名'),sourceTable:table,sourceVersion:version,
    scope:'other',confirmed:{},months:{},staff:{},evidence:[]};
  const put=(metric,confirmed,monthField,staffField,evidence,{fallback=false}={})=>{
    facts.confirmed[metric]=confirmed;
    facts.months[metric]=sourceReportingMonth(field(source,monthField),version,fallback?historicalDate(field(source,monthField.replace('月份','日期'))):null);
    facts.staff[metric]=field(source,staffField);
    if(confirmed)facts.evidence.push(...evidence);
  };
  if(table==='获客&私域信息登记表1.0-总'){
    facts.scope='acquisition';
    const read=name=>field(source,name),contact=sourceContactEvidence(read,phase),flags=sourceContactFlags(read);
    facts.effectiveContact=contact.effective||phase==='confirmation'&&(flags.wechatAdded===true||flags.visitCommitted===true||/(?:已加V|已加|加V)/u.test(read('获客加V情况')));
    facts.phase=phase;
    if(phase==='project')facts.scope='activity';
    const prefix=phase==='confirmation'?'确认':phase==='followup'?'跟进':'沟通';
    put('contacts',phase!=='project'&&contact.effective,`${prefix}月份`,phase==='confirmation'?'确认人员':phase==='followup'?'跟进人':'沟通人员',contact.evidence,{fallback:true});
    facts.months.contacts=sourceContactReportingMonth(field(source,`${prefix}月份`),field(source,`${prefix}日期`),version);
    facts.staff.contacts=field(source,phase==='confirmation'?'确认人员':phase==='followup'?'跟进人':'沟通人员');
  }else if(table==='到访数据与信息表1.0-总'){
    facts.scope='selection';
    const arrived=field(source,'到访与否')==='已到';
    facts.effectiveContact=arrived||Boolean(field(source,'确认日期'))
      || Boolean(field(source,'确认月份')&&field(source,'学服老师'))
      || ['学员情况','学员情况2','家长情况','家长情况2','家长沟通信息总结（附整理文档）'].some(name=>sourceNoteIsEffective(field(source,name)));
    put('contacts',Boolean(field(source,'确认日期')),'确认月份','学服老师',['确认日期','学服老师']);
    facts.months.contacts=sourceContactReportingMonth(field(source,'确认月份'),field(source,'确认日期'),version);
    put('invitations',Boolean(field(source,'确认日期')),'确认月份','学服老师',['确认月份','确认日期']);
    put('arrivals',arrived,'到访月份','学服老师',['到访月份','到访与否']);
    put('assessments',sourceHasAssessmentResult(name=>field(source,name)),'到访月份','学服老师',['思维测评等级','学习力测评等级','测评成绩（分数）']);
    put('enrollments',field(source,'报名与否')==='已报名','报名月份','学服老师',['报名月份','报名与否']);
  }else if(table==='袋鼠报名与备考信息表'){
    facts.scope='activity';facts.confirmed.activityRegistrations=true;
    facts.effectiveContact=Boolean(field(source,'报名日期'))||['是','已'].includes(field(source,'填写与否'));
    facts.months.activityRegistrations=historicalDate(field(source,'报名日期'))?.slice(0,7)??null;
    facts.staff.activityRegistrations=field(source,'学服老师')||field(source,'跟进人');facts.evidence.push('袋鼠报名与备考信息表','报名日期');
  }else if(table==='（老数据）各选拔产品协作信息表-总'){
    facts.scope='activity';facts.confirmed.activityRegistrations=true;
    facts.months.activityRegistrations=historicalDate(field(source,'报名选拔产品日期'))?.slice(0,7)??null;
    facts.staff.activityRegistrations=field(source,'学服老师')||field(source,'主线服务老师');facts.evidence.push('选拔产品项目');
  }
  facts.evidence=[...new Set(facts.evidence)];
  return facts;
}
