import {historicalDate,historyFieldName} from './student-business-history.mjs';
import {normalizeSourceContact} from '../../src/features/school/business-source-contract.ts';

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
    const outcomes=['确认结果','跟进结果'].map(name=>normalizeSourceContact(field(source,name)).outcome);
    const positive=outcomes.some(outcome=>['connected','declined'].includes(outcome));
    const negative=outcomes.some(outcome=>['unreachable','invalid_number'].includes(outcome))
      || ['确认结果','跟进结果'].some(name=>/(?:未通|未接通|未接听|无人接听|号码无效|无效号码|空号|停机)/.test(field(source,name)));
    const confirmedSource=Boolean(field(source,'确认月份')&&field(source,'确认人员'));
    const downstream=['已到','是'].includes(field(source,'到访与否'))||['已报名','是','已报'].includes(field(source,'报名与否'));
    const confirmed=phase==='confirmation'&&(positive||!negative&&(confirmedSource||downstream));
    put('contacts',confirmed,'确认月份','确认人员',positive?['确认结果','跟进结果']:downstream?['到访与否','报名与否']:['确认月份','确认人员'],{fallback:true});
    facts.months.contacts=sourceContactReportingMonth(field(source,'确认月份'),field(source,'确认日期'),version);
    facts.staff.contacts=field(source,'确认人员')||field(source,'沟通人员')||field(source,'跟进人');
  }else if(table==='到访数据与信息表1.0-总'){
    facts.scope='selection';
    const arrived=field(source,'到访与否')==='已到';
    put('contacts',Boolean(field(source,'确认日期')),'确认月份','学服老师',['确认日期','学服老师']);
    facts.months.contacts=sourceContactReportingMonth(field(source,'确认月份'),field(source,'确认日期'),version);
    put('invitations',Boolean(field(source,'确认日期')),'确认月份','学服老师',['确认月份','确认日期']);
    put('arrivals',arrived,'到访月份','学服老师',['到访月份','到访与否']);
    put('assessments',arrived,'到访月份','学服老师',['到访月份','到访与否']);
    put('enrollments',field(source,'报名与否')==='已报名','报名月份','学服老师',['报名月份','报名与否']);
  }else if(table==='袋鼠报名与备考信息表'){
    facts.scope='activity';facts.confirmed.activityRegistrations=true;
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
