import {describe,expect,it} from 'vitest';
import {buildHistoryIdentityIndex} from '../scripts/lib/history-archive-identity.mjs';

function fixture() {
  const sha='a'.repeat(64);
  const key=`roster:sha256:${sha}:sheet:${encodeURIComponent('来源名册')}:cell:A8`;
  return {students:[{id:'source-student',name:'来源学员',grade:2}],data_import_batches:[{
    id:'source-batch',status:'completed',import_kind:'students',source_system:'source_archive',template_version:'source-student-identities-v1',
  }],data_import_rows:[{batch_id:'source-batch',row_status:'inserted',target_id:'source-student',normalized_key:key,
    payload:{kind:'roster_cell',sourceKey:key,sourceSha256:sha,sourceSheet:'来源名册',sourceCell:'A8'}}]};
}

describe('source student identity ledger',()=>{
  it('keeps a completed source identity independent of classroom creation',()=>{
    const tables=fixture();
    expect(buildHistoryIdentityIndex({tables}).entities).toMatchObject([{localId:'source-student',sourceKeys:[tables.data_import_rows[0].normalized_key]}]);
    const rewritten=structuredClone(tables);rewritten.students[0].id='production-student';rewritten.data_import_rows[0].target_id='production-student';
    expect(buildHistoryIdentityIndex({tables:rewritten}).entities[0].key).toBe(buildHistoryIdentityIndex({tables}).entities[0].key);
  });
  it('requires matching file, cell, template and completed import proof',()=>{
    for(const change of [
      (t:ReturnType<typeof fixture>)=>{t.data_import_rows[0].payload.sourceCell='A9';},
      (t:ReturnType<typeof fixture>)=>{t.data_import_rows[0].payload.sourceSha256='b'.repeat(64);},
      (t:ReturnType<typeof fixture>)=>{t.data_import_batches[0].template_version='unreviewed';},
      (t:ReturnType<typeof fixture>)=>{t.data_import_batches[0].status='validated';},
    ]){const tables=fixture();change(tables);expect(buildHistoryIdentityIndex({tables}).entities).toEqual([]);}
  });
});
