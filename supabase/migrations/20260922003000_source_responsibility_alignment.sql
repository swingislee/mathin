-- 学服归属、联系进度和阶段老师分别来自其业务事实；历史参与经历继续保留。
create function public.school_source_support_label(p_record jsonb) returns text
language sql immutable set search_path=public,pg_temp as $$
  select btrim(c->>'text') from jsonb_array_elements(coalesce(p_record->'cells','[]'::jsonb)) c
    where c->>'fieldName'=any(array['学服老师','主线服务老师','报名服务老师','非在读-学服','确认人员'])
      and nullif(btrim(c->>'text'),'') is not null
    order by array_position(array['学服老师','主线服务老师','报名服务老师','非在读-学服','确认人员'],c->>'fieldName') limit 1;
$$;
create function public.school_source_support_id(p_source_id text) returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
  select case when count(*)=1 then (array_agg(p.id))[1] end from public.profiles p
    where p.role in ('staff','admin') and p.is_active and p.account_status='active' and exists(
      select 1 from public.history_import_records h where h.id=p_source_id and h.source_data->>'format'='feishu-base'
        and (btrim(p.display_name)=public.school_source_support_label(h.record_data)
          or public.school_source_support_label(h.record_data)=any(p.staff_aliases)));
$$;
create function public.capture_imported_lead_owner() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.owner_id is null and new.source_record_id is not null then
    new.owner_id:=public.school_source_support_id(new.source_record_id);
  end if;
  return new;
end;
$$;

create trigger imported_lead_owner before insert or update of source_record_id on public.leads
  for each row execute function public.capture_imported_lead_owner();

-- 只纠正未联系状态；保留作废、培育、意向确认、已转档等已办理值。
create function public.refresh_imported_lead_contact_status(p_lead_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.leads l set status='contacted' where l.id=p_lead_id and l.status in ('unassigned','uncontacted') and (
    exists(select 1 from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions v where v.source='contact' and v.event_id=c.id order by v.revision_no desc limit 1
    ) revision on true where c.lead_id=l.id and coalesce(revision.effective_patch->>'outcome',c.outcome) in ('connected','declined'))
    or exists(select 1 from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
      where (r.lead_id=l.id or l.student_id is not null and r.student_id=l.student_id)
        and r.status='attended' and a.deleted_at is null));
end;
$$;
create function public.capture_imported_lead_progress() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.source_record_id is not null and new.lead_id is not null then
    perform public.refresh_imported_lead_contact_status(new.lead_id);
  end if;
  return new;
end;
$$;
create trigger imported_contact_progress after insert or update of outcome,lead_id,source_record_id on public.lead_communications
  for each row execute function public.capture_imported_lead_progress();
create trigger imported_visit_progress after insert or update of status,lead_id,source_record_id on public.activity_registrations
  for each row execute function public.capture_imported_lead_progress();
revoke all on function public.school_source_support_label(jsonb),public.school_source_support_id(text),
  public.capture_imported_lead_owner(),public.refresh_imported_lead_contact_status(uuid),public.capture_imported_lead_progress()
  from public,anon,authenticated,service_role;

-- 按学服当前归属分组；原始组别与历史参与记录仍用于来源追溯和既有访问权限。
do $roles$
declare signature text; definition text; updated text; prior text; replacement text;
begin
  foreach signature in array array['school_collaboration_projection(uuid,uuid,uuid)','school_list_collaboration(jsonb,uuid)'] loop
    definition:=pg_get_functiondef(('public.'||signature)::regprocedure);
    updated:=replace(definition,'coalesce(r.business_role,p.business_role) as business_role','p.business_role as business_role');
    if updated=definition then raise exception 'COLLABORATION_ROLE_DEFINITION_CHANGED: %',signature; end if;
    if signature like 'school_list_%' then
      prior:=substring(updated from '  \), group_ids as materialized \([\s\S]*?  \), actor_groups as materialized \(');
      replacement:=$sql$  ), group_ids as materialized (
    select s.key,m.group_id from subjects s left join public.students st on st.id=s.student_id
      left join public.leads l on l.id=s.lead_id join public.school_business_group_members m
        on m.user_id=coalesce(st.assigned_to,l.owner_id) and m.removed_at is null
  ), actor_groups as materialized ($sql$;
    else
      prior:=substring(updated from '  \), group_ids as materialized \([\s\S]*?  \), groups as materialized \(');
      replacement:=$sql$  ), group_ids as materialized (
    select m.group_id from public.school_business_group_members m where m.removed_at is null
      and m.user_id=coalesce((select assigned_to from public.students where id=(select sid from subject)),
        (select owner_id from public.leads where id=p_lead_id))
  ), groups as materialized ($sql$;
    end if;
    if prior is null then raise exception 'COLLABORATION_GROUP_DEFINITION_CHANGED: %',signature; end if;
    execute replace(updated,prior,replacement);
  end loop;

  definition:=pg_get_functiondef('public.refresh_school_source_collaboration()'::regprocedure);
  updated:=replace(definition,'coalesce(r.business_role,case when l.field','(case when l.field');
  if updated=definition then raise exception 'SOURCE_COLLABORATION_DEFINITION_CHANGED'; end if;
  execute updated;

  -- 列筛选与当前学服、当前阶段老师一致，历史参与人可在详情中查看。
  definition:=pg_get_functiondef('public.student_list_field(jsonb,text,jsonb,uuid,text)'::regprocedure);
  prior:=substring(definition from '      values:=\(select jsonb_agg\(p->>''userId''\)[\s\S]*?end if;');
  if prior is null then raise exception 'STUDENT_OWNER_FIELD_DEFINITION_CHANGED'; end if;
  execute replace(definition,prior,'');
end;
$roles$;

create or replace function public.school_list_apply_collaboration(p_row jsonb,p_projection jsonb)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  select p_row||(p_projection-'supportNames'-'assessmentTeacherNames')||jsonb_build_object(
    'ownerName',coalesce(p_row->>'ownerName',''),'teacherName',coalesce(p_row->>'teacherName',''));
$$;
create or replace function public.school_collaboration_row(p_row jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if p_row is null then return null; end if;
  return public.school_list_apply_collaboration(p_row,
    public.school_collaboration_projection((p_row->>'studentId')::uuid,(p_row->>'leadId')::uuid,auth.uid()));
end;
$$;

-- 来源署名尚无账号时也能显示，账号归属与权限继续由 owner_id 决定。
do $label$
declare definition text; marker text:='''leadId'',l.id,''sources'''; replacement text;
begin
  definition:=pg_get_functiondef('public.read_base_lead_acquisition(uuid[])'::regprocedure);
  if position(marker in definition)=0 then raise exception 'BASE_SUPPORT_LABEL_CONTRACT_CHANGED'; end if;
  replacement:=$sql$'leadId',l.id,'supportLabel',coalesce((select string_agg(distinct public.school_source_support_label(h.record_data),'、' order by public.school_source_support_label(h.record_data))
    from refs r join public.history_import_records h on h.id=r.id where r.lead_id=l.id and h.source_data->>'format'='feishu-base'),''),'sources'$sql$;
  execute replace(definition,marker,replacement);
end;
$label$;

alter function public.school_source_support_label(jsonb) owner to postgres;
alter function public.school_source_support_id(text) owner to postgres;
alter function public.capture_imported_lead_owner() owner to postgres;
alter function public.refresh_imported_lead_contact_status(uuid) owner to postgres;
alter function public.capture_imported_lead_progress() owner to postgres;
