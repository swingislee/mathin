-- 默认范围、来源与岗位分离、历史待报提示，以及跨页 A 级意向；只在隔离开发库事务回滚。
begin;
set local statement_timeout='60s';
create function pg_temp.refined_worklist(subjects text[], batch uuid, stage text default 'awaiting_first_contact',
  scope text default 'default', interest text default '', channel text default '', facets boolean default false, filters jsonb default '{}') returns jsonb
language sql as $$
  select public.school_communication_workbench_page(stage,scope,'','all','',1,20,'','all',subjects,batch,
    jsonb_build_object('version',2,'filters',filters,'sort',null),'zh','{}',facets,false,interest,channel);
$$;
do $check$
declare actor uuid; outsider uuid; fixture_role uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); lid uuid; second_group uuid;
  keys text[]:='{}'; ids uuid[]:='{}'; result jsonb; item jsonb; label text:='名单角色事务 '||gen_random_uuid(); i integer;
  history_id text; evidence jsonb;
begin
  select id into actor from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required order by id limit 1;
  select id into outsider from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required and id<>actor order by id limit 1;
  if actor is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_STAFF_REQUIRED'; end if;
  delete from public.staff_role_members where user_id=actor;
  update public.school_business_group_members set removed_at=now() where user_id in (actor,outsider);
  insert into public.staff_roles(id,key,name) values(fixture_role,'worklist_roles_fixture_'||fixture_role,label);
  insert into public.role_permissions(role_id,perm_key) values(fixture_role,'student.view.all'),(fixture_role,'student.view.assigned'),(fixture_role,'followup.view'),(fixture_role,'followup.write');
  insert into public.staff_role_members(user_id,role_id) values(actor,fixture_role);
  insert into public.data_import_batches(id,import_kind,template_version,idempotency_key,input_hash,input_fingerprint,status,
    total_rows,valid_rows,inserted_rows,created_by,completed_at,batch_label)
    values(batch,'leads','test',batch::text,repeat('a',64),repeat('a',32),'completed',27,27,27,actor,now(),label);
  for i in 1..27 loop
    -- 名单读取排除 purpose=test；只在本回滚事务中创建可进入正式名单查询的临时对象。
    insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by)
      values(label||' '||lpad(i::text,3,'0'),public.normalize_lead_name(label||i),'1560014'||lpad(i::text,4,'0'),'1560014'||lpad(i::text,4,'0'),
        case when i=26 then 12 when i=27 then 11 else 1 end,case when i=27 then outsider else actor end,case when i=27 then outsider else actor end) returning id into lid;
    keys:=array_append(keys,'lead:'||lid); ids:=array_append(ids,lid);
    insert into public.lead_source_records(lead_id,batch_id,row_no,source_system,batch_label,source_row,submitted_at,promoter,location_text,raw_interest_text,remark)
      values(lid,batch,i,'xiaoditui',label,i+1,'2026-10-12 04:00:00+00','事务推广兼职','事务采集地点','事务获取信息','事务来源备注');
    if i<=3 then
      history_id:=label||':'||i;
      insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,
        source_data,record_data,match_status,match_data,entity_data,lead_id,search_text,imported_at)
      values(history_id,repeat('b',64),label,'row-'||i,repeat('b',64),
        '{"format":"feishu-base","filename":"worklist-roles-fixture.json"}',
        jsonb_build_object('tableId',label,'sourceRecordId','row-'||i,'cells',case when i=3 then
          '[{"fieldName":"26秋报名模式","text":"待报"},{"fieldName":"确认人员","text":"事务推广兼职"}]'::jsonb else '[]'::jsonb end),
        'matched','{}','{}',lid,'worklist roles fixture',now());
      insert into public.school_source_worklist_entries(logical_key,source_record_id,lead_id,kind,group_label,subgroup_label,group_rank,source_rank,context)
      values(history_id,history_id,lid,case i when 1 then 'acquisition' when 2 then 'assessment' else 'service' end,
        case i when 1 then '二组' when 2 then '事务测评老师' else '事务授课老师' end,'事务推广兼职',i,i,'[]');
    end if;
  end loop;
  update public.leads set owner_id=null where id=ids[3];
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  result:=pg_temp.refined_worklist(keys,batch);
  if result->>'scope'<>'mine' or (result->>'count')::integer<>26 then raise exception 'NON_LEADER_DEFAULT_MUST_BE_MINE_EVEN_WITH_GLOBAL_VIEW: scope=%, count=%, admin=%',result->>'scope',result->>'count',public.is_admin(actor); end if;
  if exists(select 1 from jsonb_array_elements(result->'groups') g where g->>'key' not in ('一组','二组','三组','未分组')) then raise exception 'SOURCE_OR_STAFF_LEAKED_INTO_GROUPS'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'groups') g where g->>'key'='二组') then raise exception 'ACQUISITION_GROUP_LOST'; end if;
  result:=pg_temp.refined_worklist(array[keys[3]],batch);
  item:=result->'rows'->0;
  if item is null or item->'worklist'->>'attention'='' or item->'worklist'->>'subgroup'<>'' then raise exception 'HISTORICAL_PENDING_FIRST_CONTACT_ATTENTION_MISSING'; end if;
  if item->>'ownerName'<>'' or item->>'ownerId' is not null then raise exception 'PROMOTER_USED_AS_ASSIGNED_SUPPORT'; end if;
  if not exists(select 1 from jsonb_array_elements(item->'worklist'->'context') c where c->>'label'='获取地点' and c->>'value'='事务采集地点')
    or not exists(select 1 from jsonb_array_elements(item->'worklist'->'context') c where c->>'label'='获取信息' and c->>'value'='事务获取信息') then raise exception 'SOURCE_FIELDS_LOST_WHEN_OLD_POSITION_EXISTS'; end if;
  result:=pg_temp.refined_worklist(keys,batch,channel=>'小地推');
  if (result->>'count')::integer<>26 then raise exception 'CHANNEL_FILTER_BROKEN'; end if;
  select id into second_group from public.school_business_groups where name='二组' and archived_at is null;
  insert into public.school_business_group_members(group_id,user_id,is_lead) values(second_group,actor,true),(second_group,outsider,false);
  result:=pg_temp.refined_worklist(keys,batch);
  if result->>'scope'<>'group' or (result->>'count')::integer<>27 then raise exception 'LEADER_DEFAULT_MUST_INCLUDE_GROUP'; end if;
  update public.school_business_group_members set removed_at=now() where group_id=second_group and user_id in (actor,outsider);
  delete from public.role_permissions where role_id=fixture_role and perm_key='student.view.all';
  for i in 4..27 loop
    insert into public.lead_communications(lead_id,channel,outcome,note,interest_level,recorded_by,owner_id_at_contact,occurred_at)
      values(ids[i],'phone','connected','事务沟通',case when i>=26 then 'A' else 'B' end,case when i=27 then outsider else actor end,case when i=27 then outsider else actor end,now());
  end loop;
  result:=pg_temp.refined_worklist(keys,batch,stage=>'awaiting_assessment',scope=>'all',interest=>'A',facets=>true);
  if (result->>'count')::integer<>1 or result->'rows'->0->>'leadId'<>ids[26]::text then raise exception 'HIGH_INTEREST_FILTER_MUST_RUN_BEFORE_PAGING_AND_RESPECT_SCOPE'; end if;
  if result->'rows'->0->'worklist'->>'subgroup'<>(select display_name from public.profiles where id=actor) then raise exception 'COMMUNICATION_SUBGROUP_MUST_BE_SUPPORT_OWNER'; end if;
  if exists(select 1 from jsonb_array_elements(result->'facets'->'grade'->'options') o where o->>'value'='11') then raise exception 'HIGH_INTEREST_FACET_SCOPE_LEAK'; end if;
  evidence:='[{"type":"interest","value":"A","priority":100,"certainty":"confirmed","date":"2026-10-12","field":"source"},
    {"type":"interest","value":"B","priority":400,"certainty":"confirmed","date":"2026-10-11","field":"manual"}]';
  if public.school_worklist_interest(evidence)<>'B' then raise exception 'MANUAL_FACT_MUST_OVERRIDE_SOURCE_A'; end if;
  evidence:='[{"type":"interest","value":"A","priority":100,"certainty":"confirmed","date":"2026-10-12","field":"source1"},
    {"type":"interest","value":"B","priority":100,"certainty":"confirmed","date":"2026-10-12","field":"source2"}]';
  if public.school_worklist_interest(evidence)='A' then raise exception 'CONFLICT_MUST_NOT_BE_HIGH_INTEREST'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin perform pg_temp.refined_worklist(keys,batch); raise exception 'ANONYMOUS_READ_ALLOWED';
    exception when others then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
end $check$;
rollback;
