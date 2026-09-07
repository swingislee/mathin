import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';

/** 按导出文件中的仪表盘筛选读取源行；遇到未实现的条件时明确停止该图表重算。 */
export function readDashboardArchive(file) {
  const bytes=fs.readFileSync(file),outer=JSON.parse(bytes.toString('utf8'));
  const decode=value=>JSON.parse(gunzipSync(Buffer.from(value,'base64')).toString('utf8'));
  const snapshots=decode(outer.gzipSnapshot),dashboards=decode(outer.gzipDashboard);
  const tables=new Map();
  for(const {schema} of snapshots){
    const id=schema.data.table.meta.id;
    if(tables.has(id)&&!isDeepStrictEqual(tables.get(id),schema.data))throw new Error(`CONFLICTING_TABLE_SNAPSHOT:${id}`);
    tables.set(id,schema.data);
  }
  const blocks=snapshots[0].schema.base.blockInfos;
  return {sha256:createHash('sha256').update(bytes).digest('hex'),tables,
    dashboards:dashboards.map(d=>{
      const block=Object.values(blocks).find(b=>b.blockToken===d.token);
      const layout=JSON.parse(Buffer.from(d.snapshot,'base64').toString('utf8'));
      return {name:block?.name??'',folder:blocks[block?.parentId]?.name??'',filters:layout.filterInfos??[],
        charts:Object.values(layout.map).filter(w=>w.data?.token).map(w=>{
          const chart=d.charts.find(c=>c.token===w.data.token);
          if(!chart)throw new Error('CHART_SNAPSHOT_MISSING');
          const parsed=JSON.parse(Buffer.from(chart.snapshot,'base64').toString('utf8'));
          return {name:w.name,type:w.data.chartType,ranges:(parsed.dataSources??[]).map(s=>JSON.parse(s.rangeDefinition)),viewModel:parsed.viewModel};
        })};
    })};
}

function atoms(value){
  if(value===null||value===undefined)return [];
  if(Array.isArray(value))return value.flatMap(atoms);
  if(typeof value!=='object')return [value];
  if('users' in value)return atoms(value.users);
  if('userId' in value)return [value.userId];
  if('id' in value)return [value.id];
  if('value' in value)return atoms(value.value);
  if('fullPhoneNum' in value)return atoms(value.fullPhoneNum);
  if('text' in value)return atoms(value.text);
  if(!Object.keys(value).length)return [];
  throw new Error('UNSUPPORTED_FILTER_VALUE');
}

export function matchesDashboardFilter(record,filter,fields){
  if(!filter)return true;
  if(filter.conditions){
    const values=filter.conditions.map(c=>matchesDashboardFilter(record,c,fields));
    if(filter.conjunction==='and')return values.every(Boolean);
    if(filter.conjunction==='or')return values.some(Boolean);
    throw new Error('UNSUPPORTED_FILTER_CONJUNCTION');
  }
  if(!fields[filter.fieldId])throw new Error(`MISSING_FILTER_FIELD:${filter.fieldId}`);
  const actual=atoms(record[filter.fieldId]?.value);
  if(filter.operator==='isNotEmpty')return actual.some(v=>String(v).trim()!=='');
  if(!['is','isNot'].includes(filter.operator))throw new Error(`UNSUPPORTED_FILTER_OPERATOR:${filter.operator}`);
  if([5,1001,1002].includes(filter.fieldType))throw new Error('RELATIVE_DATE_FILTER_REQUIRES_AS_OF');
  const wanted=atoms(filter.value);
  if(!wanted.length)throw new Error('EMPTY_EQUALITY_FILTER');
  const matched=actual.some(v=>wanted.includes(v));
  return filter.operator==='is'?matched:!matched;
}

export function evaluateDashboardRange(archive,range,condition=range.dataCondition){
  const tableId=range.refMap[condition.tableId]??condition.tableId;
  const table=archive.tables.get(tableId);
  if(!table)throw new Error(`MISSING_DASHBOARD_TABLE:${tableId}`);
  if(condition.source.type!=='CUSTOM')throw new Error(`UNSUPPORTED_DASHBOARD_SOURCE:${condition.source.type}`);
  const entries=Object.entries(table.recordMap).filter(([,r])=>matchesDashboardFilter(r,condition.source.filterInfo,table.table.fieldMap));
  return {tableId,tableName:table.table.meta.name,recordIds:entries.map(([id])=>id),count:entries.length,
    series:condition.seriesArray,filter:condition.source.filterInfo};
}

export function describeDashboardFilter(archive,tableId,filter){
  const fields=archive.tables.get(tableId).table.fieldMap;
  const visit=c=>{
    if(c.conditions)return {conjunction:c.conjunction,conditions:c.conditions.map(visit)};
    const field=fields[c.fieldId];
    return {field:field.name,operator:c.operator,value:(c.value??[]).map(v=>typeof v==='object'?v.name??v.userId:v)
      .map(v=>field.property?.options?.find(o=>o.id===v)?.name??v)};
  };
  return filter?visit(filter):null;
}
