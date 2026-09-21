-- 仅供隔离开发库事务内回滚验证；不用于生产核查。
insert into public.history_import_records (
  id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text,imported_at
)
select 'zz-acquisition-check-'||id,repeat('a',64),id,source_key,repeat('b',64),
  jsonb_build_object('format','feishu-base','id',source_id,'filename',filename,'snapshotDate',snapshot_date),
  jsonb_build_object('tableId',table_id,'tableName','任意改名后的获客表','cells',jsonb_build_array(
    jsonb_build_object('fieldName','家长电话','text','fictional'),
    jsonb_build_object('fieldName','获取日期','text',business_date),
    jsonb_build_object('fieldName','来源记录元数据','text','not projected'))),
  'unmatched','{}','isolated rollback fixture',imported_at::timestamptz
from (
  select 'page-'||lpad(n::text,4,'0') id,'fixture-page-'||n source_key,'renamed.base' filename,'2050-01-03' snapshot_date,
    '2050-01-02' business_date,'2050-01-03T00:00:00Z' imported_at,
    'feishu-base:28a6f6af56504cab716f01eead37d73b5098d0830ed4b02b55c06dc93e135dc6' source_id,'tblzwPK2XgJa14EC' table_id
  from generate_series(1,1001) n
  union all
  select id,source_key,filename,snapshot_date,business_date,imported_at,
    case when id='unrelated-base' then 'feishu-base:unrelated' else 'feishu-base:28a6f6af56504cab716f01eead37d73b5098d0830ed4b02b55c06dc93e135dc6' end,
    case when id='unrelated-table' then 'unrelated-table' else 'tblzwPK2XgJa14EC' end
  from (values
    ('version-old','fixture-version','2050-01-01.base',null,'2050-01-01','2050-01-04T00:00:00Z'),
    ('version-current','fixture-version','任意文件名.base','2050-01-03','2050-01-03','2050-01-03T00:00:00Z'),
    ('unchanged','fixture-unchanged','2050-01-01.base',null,'2050-01-01','2050-01-01T00:00:00Z'),
    ('unrelated-base','fixture-version','2050-01-09.base',null,'2050-01-09','2050-01-09T00:00:00Z'),
    ('unrelated-table','fixture-version','2050-01-09.base',null,'2050-01-09','2050-01-09T00:00:00Z')
  ) v(id,source_key,filename,snapshot_date,business_date,imported_at)
) fixtures;
