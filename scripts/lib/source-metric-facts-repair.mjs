import {isDeepStrictEqual} from 'node:util';
import {createImportUuid} from './import-uuid.mjs';
import {buildSourceMetricFacts} from './source-metric-facts.mjs';
import {historicalDate,historyFieldName} from './student-business-history.mjs';
import {resolveSourceStaffId} from '../../src/features/school/business-source-contract.ts';

export const SOURCE_METRIC_TABLES=['activity_registrations','course_enrollments','lead_communications'];
const field=(source,name)=>source.record_data.cells.find(c=>historyFieldName(c.fieldName)===name)?.text?.trim()??'';

/** 只补来源业务标签与确认沟通，不修改身份、真实日期、人工修订或实际测评结果。 */
export function buildSourceMetricFactsRepair(snapshot){
  const sourceById=new Map(snapshot.history_import_records.filter(h=>h.source_data.format==='feishu-base').map(h=>[h.id,h]));
  const patches=[],inserts=[],unresolved=[],excluded=[];
  const patch=(table,row,changes)=>{if(Object.entries(changes).some(([key,value])=>!isDeepStrictEqual(row[key]??null,value)))patches.push({table,id:row.id,before:row,changes});};
  for(const table of SOURCE_METRIC_TABLES){for(const row of snapshot[table]){
    const source=sourceById.get(row.source_record_id);if(!source)continue;
    const phase=table==='lead_communications'&&row.source_key?.endsWith(':followup')?'followup':'confirmation';
    const facts=buildSourceMetricFacts(source,{phase});
    const changes={source_metric_facts:facts};
    if(table==='lead_communications'&&!row.outcome&&facts?.confirmed.contacts)changes.outcome='connected';
    patch(table,row,changes);
  }}
  const id=createImportUuid(snapshot.lead_communications.map(c=>c.id));
  const originalByKey=new Map(snapshot.lead_communications.map(c=>[c.source_key,c]));
  const canonical=h=>`${String(h.source_table_id).split(':').at(-1)}:${h.source_record_id}`;
  const latest=new Map();
  for(const source of sourceById.values()){
    const previous=latest.get(canonical(source));
    if(!previous||buildSourceMetricFacts(source).sourceVersion>buildSourceMetricFacts(previous).sourceVersion)latest.set(canonical(source),source);
  }
  for(const source of latest.values()){
    const facts=buildSourceMetricFacts(source);if(!facts?.confirmed.contacts)continue;
    if(!source.record_data.names?.length){excluded.push({sourceId:source.id,reason:'unnamed_source_not_imported'});continue;}
    const key=`operation-contact:${source.id}:confirmation`;if(originalByKey.has(key))continue;
    const related=snapshot.lead_communications.filter(c=>c.source_record_id===source.id).map(c=>c.lead_id);
    const direct=snapshot.leads.filter(l=>l.source_record_id===source.id).map(l=>l.id);
    const phone=(source.record_data.phones??[]).map(p=>p.replace(/\D/g,''));
    const names=new Set((source.record_data.names??[]).map(n=>n.normalize('NFKC').replace(/\s/g,'').toLocaleLowerCase('zh')));
    const exact=snapshot.leads.filter(l=>phone.includes(l.phone_normalized)&&names.has(l.normalized_name)).map(l=>l.id);
    const candidates=[source.lead_id,...related,...direct,...exact].filter(Boolean);
    const distinct=[...new Set(candidates)];
    if(distinct.length!==1){unresolved.push({sourceId:source.id,reason:distinct.length?'multiple_existing_leads':'missing_existing_lead'});continue;}
    inserts.push({table:'lead_communications',row:{id:id(key),lead_id:distinct[0],source_record_id:source.id,source_key:key,
      channel:'other',outcome:'connected',note:`来源业务确认：${facts.evidence.join('、')}。`,occurred_at:null,
      occurred_on:historicalDate(field(source,'确认日期')),
      recorded_by:resolveSourceStaffId(field(source,'确认人员'),snapshot.profiles),owner_id_at_contact:null,
      wechat_added:null,visit_committed:null,interest_level:null,source_metric_facts:facts}});
  }
  return {patches,inserts,unresolved,excluded,counts:{taggedRecords:patches.length,confirmedExistingContacts:patches.filter(p=>p.changes.outcome==='connected').length,
    addedConfirmedContacts:inserts.length,unresolved:unresolved.length,
    excludedUnnamedSources:excluded.length,
    byTable:Object.fromEntries(SOURCE_METRIC_TABLES.map(table=>[table,patches.filter(p=>p.table===table).length]))}};
}
