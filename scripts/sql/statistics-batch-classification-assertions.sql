-- 本机事务验证：复用现有身份，覆盖用途变更、别称及畸形历史字段，退出后回滚。
create function pg_temp.assert_statistics_batch(candidates jsonb) returns void
language plpgsql security invoker as $$
declare expected text[];actual text[];
begin
  select coalesce(array_agg(r.id order by r.id),'{}') into expected
  from jsonb_to_recordset(candidates) r(id text,student_id uuid,lead_id uuid,staff_ids uuid[],source_id text,staff_labels jsonb)
  where public.statistics_identity_included(r.student_id,r.lead_id)
    and not exists(select 1 from unnest(r.staff_ids) s where not public.statistics_identity_included(null,null,s))
    and public.statistics_source_included(r.source_id,jsonb_build_object('staff',r.staff_labels));
  select coalesce(array_agg(id order by id),'{}') into actual from public.statistics_included_candidates_v2(candidates) id;
  if actual is distinct from expected then raise exception 'BATCH_CLASSIFICATION_DIFFERS_FROM_SCALAR';end if;
end;$$;

do $$ declare candidates jsonb;source_id text;original jsonb;variant jsonb;person uuid;student uuid;lead uuid;begin
  select jsonb_agg(candidate) into candidates from (
    select jsonb_build_object('id','student:'||id,'student_id',id) candidate from public.students
    union all select jsonb_build_object('id','lead:'||id,'lead_id',id) from public.leads
    union all select jsonb_build_object('id','staff:'||id,'staff_ids',array[id,null::uuid]) from public.profiles
    union all select jsonb_build_object('id','source:'||id,'source_id',id) from public.history_import_records
    union all select jsonb_build_object('id','labels:'||id,'staff_labels',jsonb_build_object('a',display_name,'b',staff_aliases[1])) from public.profiles
    union all select jsonb_build_object('id','empty')
    union all select jsonb_build_object('id','missing','source_id','statistics-missing-source')
    union all select jsonb_build_object('id','malformed-labels:'||value::text,'staff_labels',value)
      from (values('null'::jsonb),('[]'::jsonb),('3'::jsonb),('"测试"'::jsonb),('{"a":null,"b":3,"c":{},"d":[]}'::jsonb)) v(value)
  ) all_candidates;
  perform pg_temp.assert_statistics_batch(candidates);
  perform pg_temp.assert_statistics_batch('[]');

  select id,record_data into source_id,original from public.history_import_records order by id limit 1;
  if source_id is null then raise exception 'EXISTING_LOCAL_HISTORY_REQUIRED';end if;
  for variant in select value from (values
    ('null'::jsonb),('{}'::jsonb),('[]'::jsonb),('[null,4,"text"]'::jsonb),
    ('[{"fieldName":"学生姓名","text":"回归测试学生"}]'::jsonb),
    ('[{"fieldName":"学科老师","text":"测试员工"}]'::jsonb),
    ('[{"fieldName":"确认人员","text":null},{"fieldName":"学服老师","text":{"name":"测试"}}]'::jsonb),
    ('[{"fieldName":"跟进人","text":"  分类别称  "}]'::jsonb)
  ) cases(value) loop
    update public.history_import_records set record_data=jsonb_set(original,'{cells}',variant) where id=source_id;
    perform pg_temp.assert_statistics_batch(jsonb_build_array(jsonb_build_object('id','existing-source','source_id',source_id)));
  end loop;
  update public.history_import_records set record_data=original where id=source_id;

  select id into person from public.profiles where role='staff' order by id limit 1;
  select id into student from public.students order by id limit 1;
  select id into lead from public.leads order by id limit 1;
  update public.profiles set display_name='分类员工',staff_aliases=array['分类别称',' 保留空格 '],purpose='test' where id=person;
  update public.students set user_id=person,purpose='production',name='分类学员' where id=student;
  update public.leads set owner_id=person,student_id=student,purpose='production' where id=lead;
  candidates:=jsonb_build_array(jsonb_build_object('id','student','student_id',student),
    jsonb_build_object('id','lead','lead_id',lead),jsonb_build_object('id','staff','staff_ids',array[person]),
    jsonb_build_object('id','alias','staff_labels',jsonb_build_object('contacts','  分类别称  ')),
    jsonb_build_object('id','untrimmed-alias','staff_labels',jsonb_build_object('contacts','保留空格')));
  perform pg_temp.assert_statistics_batch(candidates);
  update public.profiles set purpose='production' where id=person;
  perform pg_temp.assert_statistics_batch(candidates);
  update public.students set purpose='test' where id=student;
  perform pg_temp.assert_statistics_batch(candidates);

  if exists(select 1 from pg_proc where oid='public.statistics_included_candidates_v2(jsonb)'::regprocedure
    and (not prosecdef or provolatile<>'s' or proconfig<>array['search_path=public, pg_temp']
      or has_function_privilege('anon',oid,'EXECUTE') or not has_function_privilege('authenticated',oid,'EXECUTE')))
    then raise exception 'CLASSIFIER_SECURITY_CONTRACT_CHANGED';end if;
  if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind='v' and relname like 'statistics_%'
    and (not coalesce(reloptions @> array['security_invoker=true'],false) or has_table_privilege('anon',oid,'SELECT')))
    then raise exception 'STATISTICS_VIEW_SECURITY_CHANGED';end if;
end;$$;
