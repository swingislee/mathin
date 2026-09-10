-- 复用固定开发身份；所有合成业务记录随 savepoint 回滚。
savepoint school_record_review_contract;
do $test$
declare admin_id uuid; teacher uuid; child uuid; sid uuid:=gen_random_uuid(); duplicate uuid:=gen_random_uuid();
  hidden uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); linked uuid:=gen_random_uuid();
  short_phone uuid:=gen_random_uuid(); source_prefix text:='__record_review__'||gen_random_uuid(); label text:='review-'||gen_random_uuid();
  result jsonb; page_two jsonb; err text; normalized text; total_before bigint; cells jsonb;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into teacher from auth.users where email='test-teacher@mathin.local';
  select id into child from auth.users where email='test-student@mathin.local';
  if num_nonnulls(admin_id,teacher,child)<>3 then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  if public.has_perm(teacher,'student.view.all') then raise exception 'SCOPED_TEACHER_REQUIRED'; end if;
  if public.school_identity_name('Ａ b　Ｃ')<>'abc' or public.school_identity_phone('+86 138-0000-1234')<>'13800001234'
    or public.school_identity_phone('0086 13800001234')<>'13800001234'
    or public.school_identity_phone('123456')<>'' or public.school_identity_phone('')<>'' then raise exception 'IDENTITY_NORMALIZATION'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role postgres';
  insert into public.students(id,name,phone,parent_phone,assigned_to,created_by,bind_code) values
    (sid,label,'13800001234','',teacher,admin_id,public.generate_student_bind_code()),
    (duplicate,label,'','+86 138-0000-1234',teacher,admin_id,public.generate_student_bind_code()),
    (hidden,label,'13800001234','',admin_id,admin_id,public.generate_student_bind_code()),
    (sibling,label||'-sibling','13800001234','',teacher,admin_id,public.generate_student_bind_code());
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by,note) values
    (lead,upper(label),upper(label),'0086 13800001234','008613800001234','uncontacted',teacher,admin_id,'Preserve each original record'),
    (linked,label,label,'13800001234','13800001234','uncontacted',teacher,admin_id,''),
    (short_phone,label,label,'123456','123456','uncontacted',teacher,admin_id,'');
  update public.leads set student_id=sid,identity_confirmed_by=admin_id,identity_confirmed_at=now() where id=linked;
  cells:='[{"fieldId":"date","fieldName":"获取日期","kind":"context","type":"DateTime","text":"2024/09/10"},
    {"fieldId":"location","fieldName":"获客区位","kind":"context","type":"Text","text":"原表地点"},
    {"fieldId":"outreach","fieldName":"触达内容","kind":"context","type":"Text","text":"原文第一行\n原文第二行"},
    {"fieldId":"future","fieldName":"以后新增字段","kind":"context","type":"Formula","text":"保留公式显示值"},
    {"fieldId":"empty","fieldName":"空项","kind":"context","type":"Text","text":" "},
    {"fieldId":"system","fieldName":"系统字段","kind":"system","type":"Text","text":"system"}]';
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text,lead_id,entity_data)
    select source_prefix||'-'||n,repeat('a',64),'review',source_prefix||'-'||n,repeat('b',64),'{"format":"feishu-base","filename":"original.base"}',
      jsonb_build_object('hasContent',true,'tableName','原表资料','dateLabel','2024-09-10','cells',cells), 'matched','{}','review',lead,'{}'
      from generate_series(1,12) n;
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text,student_id,entity_data)
    values(source_prefix||'-student',repeat('a',64),'review',source_prefix||'-student',repeat('b',64),'{"format":"feishu-base","filename":"student.base"}',
      jsonb_build_object('hasContent',true,'tableName','学生原表','cells',cells),'matched','{}','review',sid,'{}');
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text,lead_id,entity_data)
    values(source_prefix||'-shared',repeat('a',64),'review',source_prefix||'-shared',repeat('b',64),'{"format":"feishu-base"}',
      jsonb_build_object('hasContent',true,'cells',cells||'[{"fieldName":"满班人数","text":"30"}]'::jsonb),'matched','{}','review',lead,'{}'),
    (source_prefix||'-conflict',repeat('a',64),'review',source_prefix||'-conflict',repeat('b',64),'{"format":"feishu-base"}',
      jsonb_build_object('hasContent',true,'cells',cells),'matched','{}','review',lead,'{}');
  insert into public.history_import_associations(record_id,student_id,version,context,confirmed_by)
    values(source_prefix||'-conflict',hidden,1,'student_profile',admin_id);
  select count(*) into total_before from public.history_import_associations;
  execute 'reset role';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  result:=public.read_school_record_hints(jsonb_build_array(jsonb_build_object('studentId',sid,'leadId',null),jsonb_build_object('studentId',null,'leadId',lead),
    jsonb_build_object('studentId',sibling,'leadId',null),jsonb_build_object('studentId',hidden,'leadId',null),jsonb_build_object('studentId',null,'leadId',short_phone)));
  if jsonb_array_length(result)<>4 or result->0->>'possibleDuplicateCount'<>'2' or result->1->>'possibleDuplicateCount'<>'2'
    or result->2->>'possibleDuplicateCount'<>'0' or result->3->>'possibleDuplicateCount'<>'0' then raise exception 'DUPLICATE_SCOPE_OR_SIBLING_FILTER'; end if;
  result:=public.read_school_record_source_context(null,lead,1);
  page_two:=public.read_school_record_source_context(null,lead,2);
  if result->>'sourceCount'<>'12' or jsonb_array_length(result->'sources')<>10 or jsonb_array_length(page_two->'sources')<>2
    or exists(select 1 from jsonb_array_elements(result->'sources') a join jsonb_array_elements(page_two->'sources') b on a->>'id'=b->>'id')
    then raise exception 'SOURCE_PAGINATION_OR_CONFLICT_SCOPE'; end if;
  if exists(select 1 from jsonb_array_elements(result->'sources') r where jsonb_array_length(r->'cells')<>4
    or r->'cells'->0->>'name'<>'获取日期' or r->'cells'->0->>'text'<>'2024/09/10'
    or r->'cells'->2->>'text'<>E'原文第一行\n原文第二行' or r->'cells'->3->>'name'<>'以后新增字段') then raise exception 'SOURCE_FIELD_LOSS'; end if;
  if jsonb_array_length(result->'candidates')<>2 or exists(select 1 from jsonb_array_elements(result->'candidates') c where c->>'phone'='')
    then raise exception 'CANDIDATE_IDENTITY_OR_PHONE_FALLBACK'; end if;
  result:=public.read_school_record_source_context(sid,null,1);
  if result->>'sourceCount'<>'1' or jsonb_array_length(result->'candidates')<>2 then raise exception 'STUDENT_SOURCE_LINK'; end if;
  result:=public.read_school_record_source_context(null,linked,1);
  if result->>'sourceCount'<>'1' or jsonb_array_length(result->'candidates')<>2 then raise exception 'LINKED_LEAD_CANONICAL_IDENTITY'; end if;
  begin perform public.read_school_record_source_context(hidden,null,1); raise exception 'HIDDEN_SOURCE_EXPOSED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.read_school_record_source_context(sid,lead,1); raise exception 'MISMATCHED_SUBJECT';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.read_school_record_source_context(sid,null,0); raise exception 'INVALID_PAGE';
    exception when others then get stacked diagnostics err=message_text; if err<>'VALIDATION' then raise; end if; end;
  begin perform public.read_school_record_hints((select jsonb_agg('{}'::jsonb) from generate_series(1,101))); raise exception 'OVERSIZED_BATCH';
    exception when others then get stacked diagnostics err=message_text; if err<>'VALIDATION' then raise; end if; end;
  begin perform * from public.school_duplicate_record_candidates(hidden,null); raise exception 'PRIVATE_CANDIDATE_HELPER';
    exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select count(*) from public.history_import_associations)<>total_before or (select student_id from public.leads where id=lead) is not null
    or (select note from public.leads where id=lead)<>'Preserve each original record' then raise exception 'READ_CHANGED_IDENTITY_OR_SOURCE'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',child,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin perform public.read_school_record_hints('[]'); raise exception 'NONSTAFF_HINTS';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.read_school_record_source_context(sid,null,1); raise exception 'NONSTAFF_SOURCE';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  begin perform public.read_school_record_hints('[]'); raise exception 'ANONYMOUS_HINTS';
    exception when others then get stacked diagnostics err=message_text; if err<>'UNAUTHENTICATED' then raise; end if; end;
  execute 'reset role';
end;
$test$;
rollback to savepoint school_record_review_contract;
release savepoint school_record_review_contract;
